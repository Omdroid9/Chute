//! Non-macOS stub: Right ⌘ push-to-talk is macOS-only. Mic button still works.

use tauri::AppHandle;

pub fn start(_app: &AppHandle) {}

pub fn status() -> String {
  "unavailable".to_string()
}

#[tauri::command]
pub fn voice_ptt_status() -> String {
  status()
}

#[tauri::command]
pub fn open_input_monitoring_settings() -> Result<(), String> {
  Err("Input Monitoring is only available on macOS.".to_string())
}

#[tauri::command]
pub fn voice_retry_ptt_tap(_app: AppHandle) -> Result<String, String> {
  Ok(status())
}
