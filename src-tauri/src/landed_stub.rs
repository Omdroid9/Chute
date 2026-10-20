//! Non-macOS stub: Landed lives in the MacBook notch, so it is macOS-only.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
  pub width: f64,
  pub height: f64,
  pub notch: Rect,
  pub has_notch: bool,
}

pub fn start(_app: &AppHandle) {}

#[tauri::command]
pub fn landed_geometry() -> Geometry {
  Geometry::default()
}

#[tauri::command]
pub fn landed_set_hot_rect(_x: f64, _y: f64, _width: f64, _height: f64, _expanded: bool) {}

#[tauri::command]
pub fn landed_set_enabled(_app: AppHandle, _enabled: bool) {}

pub fn open_from_tray(_app: &AppHandle) -> bool {
  false
}
