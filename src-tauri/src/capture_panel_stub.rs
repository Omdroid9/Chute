//! Non-macOS stub: the capture bar is an ordinary window and focuses by
//! activating the app.

use tauri::{AppHandle, WebviewWindow};

pub fn install(_window: &WebviewWindow) -> bool {
  false
}

pub fn focus(_window: &WebviewWindow) -> bool {
  false
}

pub fn restore(_app: &AppHandle) {}
