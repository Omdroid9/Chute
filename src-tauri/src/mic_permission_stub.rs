//! Non-macOS stub.

#![cfg(not(target_os = "macos"))]

use tauri::AppHandle;

pub fn ensure_microphone_access(_app: &AppHandle) -> Result<(), String> {
  Ok(())
}

pub fn preflight_microphone_access(_app: &AppHandle) {}

#[tauri::command]
pub fn open_microphone_settings() -> Result<(), String> {
  Err("Microphone settings are only available on macOS.".to_string())
}
