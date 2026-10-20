use tauri::{
  Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, Position, Size, WebviewWindow, WindowEvent,
};

use crate::{AppState, MainView};

const CAPTURE_WINDOW_LABEL: &str = "main";
const LIBRARY_WINDOW_LABEL: &str = "library";
const CAPTURE_WIDTH: f64 = 640.0;
// The capture overlay opens compact (input only) and grows once the user
// types and the contextual controls appear. Spotlight-scale, not app-scale.
pub const CAPTURE_HEIGHT_COMPACT: f64 = 250.0;
// Upper bound for content-driven growth (the webview asks for the height it
// needs — expanded baseline and growth both come from the frontend): long
// multi-line captures get more room so the caret line never gets pinched.
pub const CAPTURE_HEIGHT_MAX: f64 = 760.0;
const HISTORY_WIDTH: f64 = 760.0;
const HISTORY_HEIGHT: f64 = 640.0;
const SETTINGS_WIDTH: f64 = 480.0;
const SETTINGS_HEIGHT: f64 = 640.0;

pub fn configure_capture_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(CAPTURE_WINDOW_LABEL)
    .ok_or_else(|| "Capture window was not found".to_string())?;

  // `transparent: true` alone stopped clearing the native window background on
  // macOS 26 — the default light-gray NSWindow backing shows around the shell.
  // Force a fully transparent background explicitly.
  let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));

  // macOS draws its drop shadow from the window's *rectangular* frame, so on a
  // transparent frameless window it bleeds past the shell's rounded corners as
  // faint square edges. The CSS shadow already follows the rounded shape.
  let _ = window.set_shadow(false);

  let clone = window.clone();
  window.on_window_event(move |event| {
    match event {
      // Frameless capture overlay: Alt+F4 / close should dismiss, not kill the tray app.
      WindowEvent::CloseRequested { api, .. } => {
        api.prevent_close();
        let _ = clone.hide();
      }
      WindowEvent::Focused(false) => {
        let app = clone.app_handle();
        let (should_hide, suppress_hide) = {
          let state = app.state::<AppState>();
          let should_hide = state
            .main_view
            .lock()
            .map(|mode| *mode == MainView::Capture)
            .unwrap_or(true);
          let suppress_hide = state
            .capture_raise_guard
            .lock()
            .ok()
            .and_then(|guard| *guard)
            .is_some_and(|raised_at| raised_at.elapsed() < std::time::Duration::from_millis(600));
          (should_hide, suppress_hide)
        };

        if should_hide && !suppress_hide {
          let _ = clone.hide();
        }
      }
      _ => {}
    }
  });

  window.hide().map_err(|error| error.to_string())?;
  Ok(())
}

pub fn show_capture_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(CAPTURE_WINDOW_LABEL)
    .ok_or_else(|| "Capture window was not found".to_string())?;

  set_main_view(app, MainView::Capture)?;
  window
    .set_title("Chute")
    .map_err(|error| error.to_string())?;
  window
    .set_resizable(false)
    .map_err(|error| error.to_string())?;
  window
    .set_always_on_top(true)
    .map_err(|error| error.to_string())?;
  window
    .set_skip_taskbar(true)
    .map_err(|error| error.to_string())?;
  window
    .set_size(Size::Logical(LogicalSize::new(
      CAPTURE_WIDTH,
      CAPTURE_HEIGHT_COMPACT,
    )))
    .map_err(|error| error.to_string())?;

  position_capture_window(&window)?;
  window.unminimize().map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;

  {
    let state = app.state::<AppState>();
    if let Ok(mut guard) = state.capture_raise_guard.lock() {
      *guard = Some(std::time::Instant::now());
    };
  }

  window
    .emit("chute://show-capture", ())
    .map_err(|error| error.to_string())?;

  // Warm Microphone TCC on the main thread so the first Right ⌘ hold
  // does not depend on pressing the mic button first.
  #[cfg(target_os = "macos")]
  crate::mic_permission::preflight_microphone_access(app);

  Ok(())
}

pub fn show_history_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(CAPTURE_WINDOW_LABEL)
    .ok_or_else(|| "Capture window was not found".to_string())?;

  set_main_view(app, MainView::History)?;
  window
    .set_title("Chute")
    .map_err(|error| error.to_string())?;
  window
    .set_resizable(true)
    .map_err(|error| error.to_string())?;
  window
    .set_always_on_top(false)
    .map_err(|error| error.to_string())?;
  window
    .set_skip_taskbar(false)
    .map_err(|error| error.to_string())?;
  window
    .set_size(Size::Logical(LogicalSize::new(HISTORY_WIDTH, HISTORY_HEIGHT)))
    .map_err(|error| error.to_string())?;

  center_on_active_monitor(&window, HISTORY_WIDTH, HISTORY_HEIGHT)?;
  window.unminimize().map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;
  window
    .emit("chute://show-history", ())
    .map_err(|error| error.to_string())?;

  Ok(())
}

pub fn hide_capture_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(CAPTURE_WINDOW_LABEL)
    .ok_or_else(|| "Capture window was not found".to_string())?;

  window.hide().map_err(|error| error.to_string())
}

const ONBOARDING_WIDTH: f64 = 640.0;
const ONBOARDING_HEIGHT: f64 = 720.0;

/// First-run onboarding is a wizard, not a Spotlight bar: give it a tall
/// window dead-center on the active monitor instead of the capture overlay's
/// top-22% compact placement.
pub fn show_onboarding_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(CAPTURE_WINDOW_LABEL)
    .ok_or_else(|| "Capture window was not found".to_string())?;

  window
    .set_size(Size::Logical(LogicalSize::new(ONBOARDING_WIDTH, ONBOARDING_HEIGHT)))
    .map_err(|error| error.to_string())?;
  center_on_active_monitor(&window, ONBOARDING_WIDTH, ONBOARDING_HEIGHT)?;
  window.unminimize().map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;

  Ok(())
}

/// Wire the library window's close button to hide instead of destroy.
/// Closing the library should never kill the tray app.
pub fn configure_library_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(LIBRARY_WINDOW_LABEL)
    .ok_or_else(|| "Library window was not found".to_string())?;

  let clone = window.clone();
  window.on_window_event(move |event| {
    if let WindowEvent::CloseRequested { api, .. } = event {
      api.prevent_close();
      let _ = clone.hide();
    }
  });

  window.hide().map_err(|error| error.to_string())?;
  Ok(())
}

pub fn show_library_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(LIBRARY_WINDOW_LABEL)
    .ok_or_else(|| "Library window was not found".to_string())?;

  window.unminimize().map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;
  window
    .emit("chute://show-library", ())
    .map_err(|error| error.to_string())?;

  Ok(())
}

pub fn hide_library_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(LIBRARY_WINDOW_LABEL)
    .ok_or_else(|| "Library window was not found".to_string())?;

  window.hide().map_err(|error| error.to_string())
}

pub fn show_settings_window(app: &tauri::AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(CAPTURE_WINDOW_LABEL)
    .ok_or_else(|| "Capture window was not found".to_string())?;

  set_main_view(app, MainView::Settings)?;
  window
    .set_title("Chute Settings")
    .map_err(|error| error.to_string())?;
  window
    .set_resizable(true)
    .map_err(|error| error.to_string())?;
  window
    .set_always_on_top(false)
    .map_err(|error| error.to_string())?;
  window
    .set_skip_taskbar(false)
    .map_err(|error| error.to_string())?;
  window
    .set_size(Size::Logical(LogicalSize::new(SETTINGS_WIDTH, SETTINGS_HEIGHT)))
    .map_err(|error| error.to_string())?;

  center_on_active_monitor(&window, SETTINGS_WIDTH, SETTINGS_HEIGHT)?;
  window.unminimize().map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;
  window
    .emit("chute://show-settings", ())
    .map_err(|error| error.to_string())?;

  Ok(())
}

pub fn open_settings_window(app: &tauri::AppHandle) -> Result<(), String> {
  show_settings_window(app)
}

/// Older builds opened settings as a second webview. Destroy any leftover instance.
pub fn close_legacy_settings_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("settings") {
    let _ = window.destroy();
  }
}

/// Close every webview, then terminate the process (tray + hotkeys included).
pub fn quit_app(app: &tauri::AppHandle) {
  for (_, window) in app.webview_windows() {
    let _ = window.destroy();
  }
  app.exit(0);
}

/// Resize the capture overlay between its compact and expanded heights.
/// No-ops outside the capture view so History/Settings sizes are never clobbered.
/// The top edge stays fixed, so the window grows downward under the input.
pub fn resize_capture_window(app: &tauri::AppHandle, height: f64) -> Result<(), String> {
  let is_capture_view = {
    let state = app.state::<AppState>();
    state
      .main_view
      .lock()
      .map(|view| *view == MainView::Capture)
      .unwrap_or(false)
  };
  if !is_capture_view {
    return Ok(());
  }

  let window = app
    .get_webview_window(CAPTURE_WINDOW_LABEL)
    .ok_or_else(|| "Capture window was not found".to_string())?;

  let clamped = height.clamp(CAPTURE_HEIGHT_COMPACT, CAPTURE_HEIGHT_MAX);
  window
    .set_size(Size::Logical(LogicalSize::new(CAPTURE_WIDTH, clamped)))
    .map_err(|error| error.to_string())?;

  Ok(())
}

/// Spotlight-style placement: horizontally centered, ~22% from the top of the
/// active monitor, so the compact overlay sits near the user's eye line and
/// growing taller extends downward instead of shifting the whole window.
fn position_capture_window(window: &WebviewWindow) -> Result<(), String> {
  let fallback = window.primary_monitor().map_err(|error| error.to_string())?;
  let monitor = active_monitor_for_cursor(window).or(fallback);

  let Some(monitor) = monitor else {
    return Ok(());
  };

  let scale = monitor.scale_factor();
  let monitor_size = monitor.size();
  let monitor_position = monitor.position();
  let width = (CAPTURE_WIDTH * scale) as i32;

  let x = monitor_position.x + ((monitor_size.width as i32 - width) / 2).max(0);
  let y = monitor_position.y + ((monitor_size.height as f64) * 0.22) as i32;

  window
    .set_position(Position::Physical(PhysicalPosition::new(x, y)))
    .map_err(|error| error.to_string())?;

  Ok(())
}

fn set_main_view(app: &tauri::AppHandle, next: MainView) -> Result<(), String> {
  let state = app.state::<AppState>();
  let mut value = state
    .main_view
    .lock()
    .map_err(|_| "Unable to update main view".to_string())?;
  *value = next;
  Ok(())
}

/// Center using the *target* logical size, not `outer_size()`: right after a
/// `set_size` the queried size can still be the previous view's, which parked
/// the History window low on screen when opened from the compact capture view.
fn center_on_active_monitor(
  window: &WebviewWindow,
  logical_width: f64,
  logical_height: f64,
) -> Result<(), String> {
  let fallback = window.primary_monitor().map_err(|error| error.to_string())?;
  let monitor = active_monitor_for_cursor(window).or(fallback);

  let Some(monitor) = monitor else {
    return Ok(());
  };

  let scale = monitor.scale_factor();
  let monitor_size = monitor.size();
  let monitor_position = monitor.position();
  let width = (logical_width * scale) as i32;
  let height = (logical_height * scale) as i32;

  let x = monitor_position.x + ((monitor_size.width as i32 - width) / 2).max(0);
  let y = monitor_position.y + ((monitor_size.height as i32 - height) / 2).max(0);

  window
    .set_position(Position::Physical(PhysicalPosition::new(x, y)))
    .map_err(|error| error.to_string())?;

  Ok(())
}

fn active_monitor_for_cursor(window: &WebviewWindow) -> Option<Monitor> {
  let cursor_position = window.cursor_position().ok()?;
  let all_monitors = window.available_monitors().ok()?;

  let cursor_x = cursor_position.x as i32;
  let cursor_y = cursor_position.y as i32;

  all_monitors.into_iter().find(|monitor| {
    let origin = monitor.position();
    let size = monitor.size();

    let x_in_bounds = cursor_x >= origin.x && cursor_x < origin.x + size.width as i32;
    let y_in_bounds = cursor_y >= origin.y && cursor_y < origin.y + size.height as i32;

    x_in_bounds && y_in_bounds
  })
}

