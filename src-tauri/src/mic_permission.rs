//! macOS microphone TCC prompt. cpal alone will happily open a silent stream
//! when the user hasn't granted Microphone access — whisper then hallucinates
//! "you" / "thank you" on near-silence. This module forces the real prompt.
//!
//! AVFoundation's permission APIs must run on the main thread; calling them
//! from the PTT worker (or Tokio) often means no dialog and a stuck denial.
//!
//! The prompt only ever comes from using voice (holding the key or the mic
//! button), never from opening the capture bar: asking on every hotkey kept
//! the dialog coming back for anyone who doesn't use voice.

#![cfg(target_os = "macos")]

use std::ffi::CStr;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::{AnyClass, Bool};
use objc2::msg_send;
use objc2_foundation::NSString;
use tauri::AppHandle;

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[link(name = "System", kind = "dylib")]
extern "C" {
  fn pthread_main_np() -> i32;
}

/// What a first-time grant reports instead of recording. Shown as a note, not
/// an error, by the capture bar (src/lib/voice.ts has the same text); it
/// avoids the word "microphone", which makes the bar offer System Settings.
pub const VOICE_NOW_ALLOWED: &str = "Voice is on. Hold the key again to talk.";

/// `AVAuthorizationStatus` values.
const AUTH_NOT_DETERMINED: i64 = 0;
const AUTH_RESTRICTED: i64 = 1;
const AUTH_DENIED: i64 = 2;
const AUTH_AUTHORIZED: i64 = 3;

fn ensure_microphone_access_inner() -> Result<(), String> {
  let name = CStr::from_bytes_with_nul(b"AVCaptureDevice\0").unwrap();
  let Some(av_capture) = AnyClass::get(name) else {
    // Framework missing — let cpal try anyway.
    eprintln!("[voice] AVCaptureDevice class missing; skipping TCC preflight");
    return Ok(());
  };

  // AVMediaTypeAudio == "soun"
  let media_type = NSString::from_str("soun");

  // Safety: calling AVFoundation ObjC APIs.
  let status: i64 =
    unsafe { msg_send![av_capture, authorizationStatusForMediaType: &*media_type] };

  match status {
    AUTH_AUTHORIZED => {
      eprintln!("[voice] microphone TCC: authorized");
      Ok(())
    }
    AUTH_DENIED | AUTH_RESTRICTED => Err(
      "Microphone access is denied. Enable Chute in System Settings → Privacy & Security → Microphone, then try again."
        .to_string(),
    ),
    AUTH_NOT_DETERMINED => {
      eprintln!("[voice] microphone TCC: not determined — requesting…");
      let (tx, rx) = mpsc::channel::<bool>();
      let block = RcBlock::new(move |granted: Bool| {
        let _ = tx.send(bool::from(granted));
      });

      // Safety: async TCC prompt; completion fires on an Apple queue.
      unsafe {
        let _: () = msg_send![
          av_capture,
          requestAccessForMediaType: &*media_type,
          completionHandler: &*block
        ];
      }

      match rx.recv_timeout(Duration::from_secs(120)) {
        // Granted, but don't record on this hold: the key was most likely let
        // go while the dialog was up, and nothing would stop the recording.
        Ok(true) => {
          eprintln!("[voice] microphone TCC: granted");
          Err(VOICE_NOW_ALLOWED.to_string())
        }
        Ok(false) => Err(
          "Microphone permission was denied. Enable Chute in System Settings → Privacy & Security → Microphone."
            .to_string(),
        ),
        Err(_) => Err(
          "Timed out waiting for the microphone permission dialog. Check System Settings → Privacy & Security → Microphone."
            .to_string(),
        ),
      }
    }
    other => {
      eprintln!("[voice] microphone TCC: unknown status {other}");
      Ok(())
    }
  }
}

/// Ensure Microphone TCC is granted. Triggers the system prompt on first use.
/// Always hops to the AppKit main thread when needed so the dialog can appear.
pub fn ensure_microphone_access(app: &AppHandle) -> Result<(), String> {
  if unsafe { pthread_main_np() } != 0 {
    return ensure_microphone_access_inner();
  }

  let (tx, rx) = mpsc::channel();
  app
    .run_on_main_thread(move || {
      let _ = tx.send(ensure_microphone_access_inner());
    })
    .map_err(|e| e.to_string())?;

  match rx.recv_timeout(Duration::from_secs(120)) {
    Ok(result) => result,
    Err(_) => Err(
      "Timed out waiting for the microphone permission dialog. Check System Settings → Privacy & Security → Microphone."
        .to_string(),
    ),
  }
}

/// Opens System Settings → Privacy & Security → Microphone.
pub fn open_microphone_settings_url() -> Result<(), String> {
  let modern =
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone";
  if open::that(modern).is_ok() {
    return Ok(());
  }
  let legacy = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  open::that(legacy).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_microphone_settings() -> Result<(), String> {
  open_microphone_settings_url()
}
