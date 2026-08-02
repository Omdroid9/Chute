// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod window;

use std::sync::Mutex;

use tauri::{
  Emitter, Manager, RunEvent,
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const TRAY_ID: &str = "chute-tray";

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MainView {
  Capture,
  History,
  Settings,
}

pub struct AppState {
  pub hotkey: Mutex<String>,
  /// Library hotkey. Tracked separately so rebinding capture doesn't clobber it.
  pub library_hotkey: Mutex<String>,
  pub main_view: Mutex<MainView>,
  /// Suppress focus-loss hide briefly after raising capture (avoids hotkey flash-dismiss).
  pub capture_raise_guard: Mutex<Option<std::time::Instant>>,
  /// Active Chute-native countdown timers, keyed by id.
  pub timers: Mutex<std::collections::HashMap<String, commands::TimerEntry>>,
}

pub fn default_hotkey() -> &'static str {
  if cfg!(target_os = "macos") {
    "CommandOrControl+Shift+Space"
  } else {
    "Ctrl+Shift+Space"
  }
}

pub fn default_library_hotkey() -> &'static str {
  if cfg!(target_os = "macos") {
    "CommandOrControl+Shift+L"
  } else {
    "Ctrl+Shift+L"
  }
}

pub fn tray_tooltip(captures_today: u32, last_sync: &str) -> String {
  format!(
    "Chute - {} captures today - Last sync: {}",
    captures_today, last_sync
  )
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  let new_capture_item = MenuItem::with_id(app, "new_capture", "New Capture", true, None::<&str>)?;
  let library_item = MenuItem::with_id(app, "library", "Open Library", true, None::<&str>)?;
  let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
  let separator = PredefinedMenuItem::separator(app)?;
  let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

  let menu = Menu::with_items(
    app,
    &[&new_capture_item, &library_item, &settings_item, &separator, &quit_item],
  )?;

  let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
    .menu(&menu)
    .show_menu_on_left_click(false)
    .tooltip(tray_tooltip(0, "Never"))
    .on_menu_event(|app, event| match event.id.as_ref() {
      "new_capture" => {
        let _ = window::show_capture_window(app);
      }
      "library" => {
        let _ = window::show_library_window(app);
      }
      "settings" => {
        let _ = window::open_settings_window(app);
      }
      "quit" => {
        window::quit_app(app);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        let _ = window::show_capture_window(&tray.app_handle());
      }
    });

  if let Some(icon) = app.default_window_icon() {
    tray_builder = tray_builder.icon(icon.clone());
  }

  tray_builder.build(app)?;
  Ok(())
}

fn main() {
  let initial_hotkey = default_hotkey().to_string();
  let initial_library_hotkey = default_library_hotkey().to_string();

  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      let _ = app.emit("chute://second-instance", ());
    }))
    .manage(AppState {
      hotkey: Mutex::new(initial_hotkey.clone()),
      library_hotkey: Mutex::new(initial_library_hotkey.clone()),
      main_view: Mutex::new(MainView::Capture),
      capture_raise_guard: Mutex::new(None),
      timers: Mutex::new(std::collections::HashMap::new()),
    })
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
          if event.state() != ShortcutState::Pressed {
            return;
          }
          // Compare by parsing the stored hotkey back into a Shortcut.
          // Handles spelling differences (Ctrl vs Control, CommandOrControl).
          let library_hotkey = app
            .try_state::<AppState>()
            .and_then(|state| state.library_hotkey.lock().ok().map(|guard| guard.clone()))
            .and_then(|s| s.parse::<Shortcut>().ok());
          let is_library = library_hotkey
            .as_ref()
            .map(|lib| lib == shortcut)
            .unwrap_or(false);
          if is_library {
            let _ = window::show_library_window(app);
          } else {
            let _ = window::show_capture_window(app);
          }
        })
        .build(),
    )
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .setup(move |app| {
      build_tray(app.handle())?;
      window::close_legacy_settings_window(app.handle());
      let _ = window::configure_capture_window(app.handle());
      let _ = window::configure_library_window(app.handle());

      // Clear stale registrations left by a crashed or force-killed prior instance.
      let _ = app.global_shortcut().unregister_all();

      let parsed_shortcut: Shortcut = initial_hotkey.parse().expect("default hotkey must parse");
      if let Err(error) = app.global_shortcut().register(parsed_shortcut) {
        eprintln!(
          "Could not register default hotkey '{}': {}. Trying fallback hotkey.",
          initial_hotkey, error
        );

        let fallback_hotkey = if cfg!(target_os = "macos") {
          "CommandOrControl+Alt+Space"
        } else {
          "Ctrl+Alt+Space"
        };

        match fallback_hotkey.parse::<Shortcut>() {
          Ok(fallback_shortcut) => {
            if let Err(fallback_error) = app.global_shortcut().register(fallback_shortcut) {
              eprintln!(
                "Fallback hotkey '{}' also failed to register: {}",
                fallback_hotkey, fallback_error
              );
            } else if let Some(state) = app.try_state::<AppState>() {
              if let Ok(mut current) = state.hotkey.lock() {
                *current = fallback_hotkey.to_string();
              }
            }
          }
          Err(parse_error) => {
            eprintln!(
              "Fallback hotkey '{}' could not be parsed: {}",
              fallback_hotkey, parse_error
            );
          }
        }
      }

      // Library hotkey is best-effort. If the combo is taken, the tray
      // entry still works and capture remains the headline hotkey.
      match initial_library_hotkey.parse::<Shortcut>() {
        Ok(library_shortcut) => {
          if let Err(error) = app.global_shortcut().register(library_shortcut) {
            eprintln!(
              "Library hotkey '{}' could not be registered: {} (tray entry still works)",
              initial_library_hotkey, error
            );
            if let Some(state) = app.try_state::<AppState>() {
              if let Ok(mut current) = state.library_hotkey.lock() {
                current.clear();
              }
            }
          }
        }
        Err(error) => {
          eprintln!(
            "Library hotkey '{}' could not be parsed: {}",
            initial_library_hotkey, error
          );
        }
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::show_capture_window,
      commands::hide_capture_window,
      commands::show_onboarding_window,
      commands::resize_capture_window,
      commands::exit_app,
      commands::open_settings_window,
      commands::open_history_window,
      commands::show_library_window,
      commands::hide_library_window,
      commands::set_capture_hotkey,
      commands::get_default_hotkey,
      commands::get_active_hotkey,
      commands::update_tray_tooltip,
      commands::open_external_url,
      commands::create_apple_note,
      commands::create_apple_reminder,
      commands::create_apple_calendar_event,
      commands::start_chute_timer,
      commands::cancel_chute_timer,
      commands::list_chute_timers
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let RunEvent::ExitRequested { .. } = event {
        for (_, window) in app_handle.webview_windows() {
          let _ = window.destroy();
        }
      }
    });
}
