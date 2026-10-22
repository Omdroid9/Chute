//! Non-macOS stub: Chute's floating windows are ordinary windows elsewhere.

use tauri::{AppHandle, WebviewWindow};

pub fn install_capture(_window: &WebviewWindow) -> bool {
  false
}

pub fn install_overlay(_window: &WebviewWindow) -> bool {
  false
}

pub fn focus(_window: &WebviewWindow) -> bool {
  false
}

pub fn restore_all(_app: &AppHandle) {}
