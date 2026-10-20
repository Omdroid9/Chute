//! macOS push-to-talk: hold Right ⌘ to record, release to transcribe.
//!
//! We deliberately do **not** use `CGEventTap` for the beta. Ad-hoc signed
//! Tauri builds (and Launch Services `open App.app`) routinely get a NULL tap
//! even when Input Monitoring is toggled on — TCC is tied to code identity and
//! re-signing breaks it every rebuild.
//!
//! Instead we poll `CGEventSourceKeyState` for keycode 54 (Right Command) on
//! the **main thread**. Reading HID key state from a background thread often
//! returns false under Hardened Runtime; main-queue polls are reliable and
//! still need no Input Monitoring grant. Left ⌘ stays free.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::voice;

/// Right Command (ANSI). Left Command is 0x37 (55).
const KEYCODE_RIGHT_COMMAND: u16 = 0x36;
const K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: u32 = 1;
const K_CG_EVENT_SOURCE_STATE_COMBINED_SESSION_STATE: u32 = 0;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static POLL_STARTED: AtomicBool = AtomicBool::new(false);
static POLL_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static RIGHT_CMD_DOWN: AtomicBool = AtomicBool::new(false);
static TAP_READY: AtomicBool = AtomicBool::new(false);

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
  fn CGEventSourceKeyState(state_id: u32, key_code: u16) -> bool;
}

fn emit_ptt_status(app: &AppHandle) {
  let _ = app.emit("chute://voice-ptt-status", json!({ "status": status() }));
}

fn right_command_is_down() -> bool {
  // Safety: reads current key state; no event tap / TCC required.
  unsafe {
    CGEventSourceKeyState(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE, KEYCODE_RIGHT_COMMAND)
      || CGEventSourceKeyState(
        K_CG_EVENT_SOURCE_STATE_COMBINED_SESSION_STATE,
        KEYCODE_RIGHT_COMMAND,
      )
  }
}

fn poll_once(app: &AppHandle) {
  let is_down = right_command_is_down();
  let was_down = RIGHT_CMD_DOWN.swap(is_down, Ordering::SeqCst);
  if is_down == was_down {
    return;
  }

  eprintln!(
    "[voice] Right ⌘ {} (main-thread poll)",
    if is_down { "down" } else { "up" }
  );

  // Keep the AppKit/main queue free — mic TCC + cpal setup can block.
  let app = app.clone();
  thread::spawn(move || {
    if is_down {
      voice::ptt_pressed(&app);
    } else {
      voice::ptt_released(&app);
    }
  });
}

/// Start the Right ⌘ poller. Call once from setup.
pub fn start(app: &AppHandle) {
  let _ = APP_HANDLE.set(app.clone());
  if POLL_STARTED.swap(true, Ordering::SeqCst) {
    emit_ptt_status(app);
    return;
  }

  let app = app.clone();
  let spawn = thread::Builder::new()
    .name("chute-ptt-poll".into())
    .spawn(move || {
      TAP_READY.store(true, Ordering::SeqCst);
      eprintln!(
        "[voice] Right ⌘ PTT poller ready (main-thread CGEventSourceKeyState, no Input Monitoring)"
      );
      emit_ptt_status(&app);

      loop {
        if !POLL_IN_FLIGHT.swap(true, Ordering::SeqCst) {
          let tick_app = app.clone();
          let tick_handle = app.clone();
          if tick_handle
            .run_on_main_thread(move || {
              poll_once(&tick_app);
              POLL_IN_FLIGHT.store(false, Ordering::SeqCst);
            })
            .is_err()
          {
            POLL_IN_FLIGHT.store(false, Ordering::SeqCst);
          }
        }
        thread::sleep(Duration::from_millis(25));
      }
    });

  if let Err(err) = spawn {
    POLL_STARTED.store(false, Ordering::SeqCst);
    TAP_READY.store(false, Ordering::SeqCst);
    eprintln!("[voice] failed to spawn PTT poller: {err}");
  }

  if let Some(handle) = APP_HANDLE.get() {
    emit_ptt_status(handle);
  }
}

/// Always `"ready"` once the poller thread is up — no Input Monitoring needed.
pub fn status() -> String {
  if TAP_READY.load(Ordering::SeqCst) {
    "ready".to_string()
  } else {
    "unavailable".to_string()
  }
}

#[tauri::command]
pub fn voice_ptt_status() -> String {
  status()
}

/// Kept for Settings UI compatibility; opens Input Monitoring in case we
/// revisit CGEventTap after Developer ID signing.
#[tauri::command]
pub fn open_input_monitoring_settings() -> Result<(), String> {
  let modern =
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent";
  if open::that(modern).is_ok() {
    return Ok(());
  }
  let legacy = "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";
  open::that(legacy).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_retry_ptt_tap(app: AppHandle) -> Result<String, String> {
  let _ = APP_HANDLE.set(app.clone());
  if !TAP_READY.load(Ordering::SeqCst) {
    POLL_STARTED.store(false, Ordering::SeqCst);
    start(&app);
    thread::sleep(Duration::from_millis(100));
  }
  emit_ptt_status(&app);
  Ok(status())
}
