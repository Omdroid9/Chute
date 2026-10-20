//! Find a capture again in the Apple app it landed in, using the id Chute kept
//! when it was created (see `capture_links`).
//!
//! Scripts take their values as argv, never interpolated. Everything runs off
//! the main thread: AppleScript can take a second, and a sync command would
//! freeze the UI meanwhile.

#[cfg(target_os = "macos")]
fn run_osascript(script: &str, args: &[String]) -> Result<String, String> {
  use std::io::Write;
  use std::process::{Command, Stdio};

  let mut child = Command::new("osascript")
    .arg("-")
    .args(args)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("Could not launch osascript: {error}"))?;
  child
    .stdin
    .take()
    .ok_or_else(|| "Could not write AppleScript to osascript".to_string())?
    .write_all(script.as_bytes())
    .map_err(|error| format!("Could not send AppleScript: {error}"))?;
  let output = child
    .wait_with_output()
    .map_err(|error| format!("osascript did not complete: {error}"))?;
  if !output.status.success() {
    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
  }
  Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// `show` by id can fail if the item was deleted; the app still comes forward.
#[cfg(target_os = "macos")]
const SHOW_REMINDER: &str = r#"on run argv
  tell application "Reminders"
    activate
    if (item 1 of argv) is not "" then
      try
        show reminder id (item 1 of argv)
      end try
    end if
  end tell
end run"#;

#[cfg(target_os = "macos")]
const SHOW_NOTE: &str = r#"on run argv
  tell application "Notes"
    activate
    if (item 1 of argv) is not "" then
      try
        show note id (item 1 of argv)
      end try
    end if
  end tell
end run"#;

// Calendar events are found by day, not uid: `whose` lookups are the scripting
// pattern that crashes Calendar on macOS 26 (see create_apple_calendar_event).
#[cfg(target_os = "macos")]
const SHOW_CALENDAR_DAY: &str = r#"on run argv
  tell application "Calendar"
    activate
    if (count of argv) is greater than 2 then
      set targetDay to current date
      set day of targetDay to 1
      set year of targetDay to (item 1 of argv) as integer
      set month of targetDay to (item 2 of argv) as integer
      set day of targetDay to (item 3 of argv) as integer
      switch view to day view
      view calendar at targetDay
    end if
  end tell
end run"#;

/// Bring the item forward in its Apple app. `destination` is a capture link
/// destination ("reminders", "apple_notes", "apple_calendar"); `date` is a
/// local ISO datetime, used for Calendar.
#[tauri::command]
pub async fn open_in_apple_app(
  destination: String,
  external_id: String,
  date: Option<String>,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let (script, args): (&str, Vec<String>) = match destination.as_str() {
      "reminders" => (SHOW_REMINDER, vec![external_id]),
      "apple_notes" => (SHOW_NOTE, vec![external_id]),
      "apple_calendar" => {
        let day = date
          .as_deref()
          .and_then(|value| value.split('T').next())
          .map(|day| day.split('-').map(str::to_string).collect::<Vec<_>>())
          .filter(|parts| parts.len() == 3 && parts.iter().all(|part| part.parse::<u32>().is_ok()))
          .unwrap_or_default();
        (SHOW_CALENDAR_DAY, day)
      }
      other => return Err(format!("Not an Apple app destination: {other}")),
    };
    tauri::async_runtime::spawn_blocking(move || run_osascript(script, &args).map(|_| ()))
      .await
      .map_err(|error| error.to_string())?
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (destination, external_id, date);
    Err("Apple apps are only available on macOS.".to_string())
  }
}

/// System Settings → Privacy & Security → Automation, where Chute's access to
/// Reminders, Notes and Calendar is switched on.
#[tauri::command]
pub fn open_automation_settings() -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let modern =
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation";
    if open::that(modern).is_ok() {
      return Ok(());
    }
    let legacy = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";
    open::that(legacy).map_err(|error| error.to_string())
  }
  #[cfg(not(target_os = "macos"))]
  {
    Err("Automation settings are only available on macOS.".to_string())
  }
}
