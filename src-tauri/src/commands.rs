use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::{default_hotkey, tray_tooltip, window, AppState, TRAY_ID};

#[tauri::command]
pub fn show_capture_window(app: tauri::AppHandle) -> Result<(), String> {
  window::show_capture_window(&app)
}

#[tauri::command]
pub fn hide_capture_window(app: tauri::AppHandle) -> Result<(), String> {
  window::hide_capture_window(&app)
}

#[tauri::command]
pub fn show_onboarding_window(app: tauri::AppHandle) -> Result<(), String> {
  window::show_onboarding_window(&app)
}

#[tauri::command]
pub fn resize_capture_window(app: tauri::AppHandle, height: f64) -> Result<(), String> {
  window::resize_capture_window(&app, height)
}

#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
  window::quit_app(&app);
}

#[tauri::command]
pub fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
  window::open_settings_window(&app)
}

#[tauri::command]
pub fn open_history_window(app: tauri::AppHandle) -> Result<(), String> {
  window::show_history_window(&app)
}

#[tauri::command]
pub fn show_library_window(app: tauri::AppHandle) -> Result<(), String> {
  window::show_library_window(&app)
}

#[tauri::command]
pub fn hide_library_window(app: tauri::AppHandle) -> Result<(), String> {
  window::hide_library_window(&app)
}

#[tauri::command]
pub fn get_default_hotkey() -> String {
  default_hotkey().to_string()
}

#[tauri::command]
pub fn get_active_hotkey(state: State<'_, AppState>) -> Result<String, String> {
  state
    .hotkey
    .lock()
    .map(|value| value.clone())
    .map_err(|_| "Unable to read active hotkey".to_string())
}

#[tauri::command]
pub fn set_capture_hotkey(
  app: tauri::AppHandle,
  state: State<'_, AppState>,
  hotkey: String,
) -> Result<(), String> {
  let normalized = hotkey.trim();
  if normalized.is_empty() {
    return Err("Hotkey cannot be empty".to_string());
  }

  let parsed_shortcut: Shortcut = normalized
    .parse()
    .map_err(|_| "Invalid hotkey format. Example: Ctrl+Shift+Space".to_string())?;

  // Only unregister the previous capture shortcut. The library shortcut
  // is owned by a separate slot in AppState and must survive a rebind.
  let previous_capture = state
    .hotkey
    .lock()
    .ok()
    .map(|guard| guard.clone())
    .and_then(|s| s.parse::<Shortcut>().ok());
  if let Some(previous) = previous_capture {
    let _ = app.global_shortcut().unregister(previous);
  }

  if let Err(error) = app.global_shortcut().register(parsed_shortcut) {
    // Never leave the app with zero capture shortcuts after a failed update.
    if let Ok(fallback) = default_hotkey().parse::<Shortcut>() {
      let _ = app.global_shortcut().register(fallback);
      if let Ok(mut value) = state.hotkey.lock() {
        *value = default_hotkey().to_string();
      }
    }
    return Err(error.to_string());
  }

  let mut value = state
    .hotkey
    .lock()
    .map_err(|_| "Unable to update hotkey".to_string())?;
  *value = normalized.to_string();

  Ok(())
}

#[tauri::command]
pub fn update_tray_tooltip(
  app: tauri::AppHandle,
  captures_today: u32,
  last_sync: String,
) -> Result<(), String> {
  let tooltip = tray_tooltip(captures_today, &last_sync);
  if let Some(tray) = app.tray_by_id(TRAY_ID) {
    tray
      .set_tooltip(Some(tooltip))
      .map_err(|error| error.to_string())?;
  }
  Ok(())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
  let trimmed = url.trim();
  if trimmed.is_empty() {
    return Err("URL cannot be empty".to_string());
  }

  open::that(trimmed).map_err(|error| error.to_string())?;
  Ok(())
}

/// Parse a local ISO datetime string ("2026-06-15T14:00:00") into components.
/// Returns None if the string is malformed; the caller falls back to no due date.
#[cfg(target_os = "macos")]
fn parse_local_iso(s: &str) -> Option<(i32, u32, u32, u32, u32, u32)> {
  let (date_part, time_part) = s.split_once('T')?;
  let mut d = date_part.split('-');
  let year: i32 = d.next()?.parse().ok()?;
  let month: u32 = d.next()?.parse().ok()?;
  let day: u32 = d.next()?.parse().ok()?;
  let mut t = time_part.split(':');
  let hour: u32 = t.next()?.parse().ok()?;
  let minute: u32 = t.next()?.parse().ok()?;
  let second: u32 = t.next().and_then(|value| value.parse().ok()).unwrap_or(0);
  Some((year, month, day, hour, minute, second))
}

/// Create a reminder in macOS Reminders.app via AppleScript.
/// Values are passed as argv, never interpolated into the script.
/// When `due_date` is a local ISO string ("2026-06-15T14:00:00") the reminder
/// gets a due date; otherwise it is created without one.
#[tauri::command]
pub fn create_apple_reminder(
  list: String,
  title: String,
  body: String,
  due_date: Option<String>,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let list = {
      let trimmed = list.trim();
      if trimmed.is_empty() { "Chute".to_string() } else { trimmed.to_string() }
    };

    let parsed_due = due_date
      .as_deref()
      .and_then(|s| parse_local_iso(s));

    let script = r#"on run argv
  set listName to item 1 of argv
  set reminderTitle to item 2 of argv
  set reminderBody to item 3 of argv
  set hasDue to item 4 of argv
  tell application "Reminders"
    launch
    -- Find the list by looping and holding a direct object reference. Probing
    -- `exists list <name>` / `list <name>` by-name specifier crashes the
    -- Reminders scripting bridge on macOS 26 (NSExistsCommand / NSWhoseSpecifier).
    set theList to missing value
    repeat with aList in every list
      if (name of aList) is listName then
        set theList to aList
        exit repeat
      end if
    end repeat
    if theList is missing value then
      set theList to (make new list with properties {name:listName})
    end if
    if hasDue is "true" then
      set yr to (item 5 of argv) as integer
      set mo to (item 6 of argv) as integer
      set dy to (item 7 of argv) as integer
      set hr to (item 8 of argv) as integer
      set mn to (item 9 of argv) as integer
      set sc to (item 10 of argv) as integer
      set dueDate to current date
      set year of dueDate to yr
      set month of dueDate to mo
      set day of dueDate to dy
      set hours of dueDate to hr
      set minutes of dueDate to mn
      set seconds of dueDate to sc
      tell theList to make new reminder with properties {name:reminderTitle, body:reminderBody, due date:dueDate}
    else
      tell theList to make new reminder with properties {name:reminderTitle, body:reminderBody}
    end if
  end tell
end run"#;

    // Launch Reminders in the background first (no focus steal) so the script
    // never races a cold/stale app and fails with -600/-609.
    let _ = Command::new("open")
      .args(["-g", "-j", "-a", "Reminders"])
      .status();

    let mut cmd = Command::new("osascript");
    cmd
      .arg("-")
      .arg(&list)
      .arg(&title)
      .arg(&body)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

    if let Some((year, month, day, hour, minute, second)) = parsed_due {
      cmd
        .arg("true")
        .arg(year.to_string())
        .arg(month.to_string())
        .arg(day.to_string())
        .arg(hour.to_string())
        .arg(minute.to_string())
        .arg(second.to_string());
    } else {
      cmd.arg("false");
    }

    let mut child = cmd
      .spawn()
      .map_err(|e| format!("Could not launch osascript: {e}"))?;

    {
      let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not write AppleScript to osascript".to_string())?;
      stdin
        .write_all(script.as_bytes())
        .map_err(|e| format!("Could not send AppleScript: {e}"))?;
    }

    let output = child
      .wait_with_output()
      .map_err(|e| format!("osascript did not complete: {e}"))?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      let message = stderr.trim();
      let detail = if message.is_empty() {
        "Apple Reminders automation failed. Grant Chute permission to control Reminders in System Settings > Privacy & Security > Automation.".to_string()
      } else {
        message.to_string()
      };
      return Err(detail);
    }

    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (list, title, body, due_date);
    Err("Apple Reminders is only available on macOS.".to_string())
  }
}

/// Create a note in the macOS Notes app via AppleScript, with no external
/// helper process. Values are passed as `osascript` arguments (argv) rather
/// than interpolated into the script, so note content cannot break out of the
/// script or inject AppleScript.
#[tauri::command]
pub fn create_apple_note(folder: String, title: String, body: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let folder = {
      let trimmed = folder.trim();
      if trimmed.is_empty() {
        "Chute".to_string()
      } else {
        trimmed.to_string()
      }
    };

    // argv: 1 = folder, 2 = title, 3 = body (HTML). Notes already treats the
    // first body line as the note title, so do not prepend a duplicate heading.
    let script = r#"on run argv
  set folderName to item 1 of argv
  set noteBody to item 3 of argv
  tell application "Notes"
    launch
    tell default account
      -- Loop for the folder and keep a direct reference; the by-name
      -- `exists folder <name>` specifier is the pattern that crashes the
      -- Reminders/Notes scripting bridge on macOS 26.
      set theFolder to missing value
      repeat with aFolder in every folder
        if (name of aFolder) is folderName then
          set theFolder to aFolder
          exit repeat
        end if
      end repeat
      if theFolder is missing value then
        set theFolder to (make new folder with properties {name:folderName})
      end if
      tell theFolder to make new note with properties {body:noteBody}
    end tell
  end tell
end run"#;

    // Launch Notes in the background first so the script never races a cold app.
    let _ = Command::new("open").args(["-g", "-j", "-a", "Notes"]).status();

    let mut child = Command::new("osascript")
      .arg("-")
      .arg(&folder)
      .arg(&title)
      .arg(&body)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|error| format!("Could not launch osascript: {error}"))?;

    {
      let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not write AppleScript to osascript".to_string())?;
      stdin
        .write_all(script.as_bytes())
        .map_err(|error| format!("Could not send AppleScript: {error}"))?;
    }

    let output = child
      .wait_with_output()
      .map_err(|error| format!("osascript did not complete: {error}"))?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      let message = stderr.trim();
      let detail = if message.is_empty() {
        "Apple Notes automation failed. Grant Chute permission to control Notes in System Settings > Privacy & Security > Automation.".to_string()
      } else {
        message.to_string()
      };
      return Err(detail);
    }

    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (folder, title, body);
    Err("Apple Notes is only available on macOS.".to_string())
  }
}

/// Create an event in macOS Calendar.app via AppleScript. `start` and `end`
/// are local ISO strings ("2026-06-15T09:00:00"). An empty `calendar` targets
/// the first writable calendar (the user's default); a name creates it if
/// missing. `alarm_minutes` adds a display alarm that many minutes before the
/// start. Values are passed as argv, never interpolated into the script.
#[tauri::command]
pub fn create_apple_calendar_event(
  calendar: String,
  title: String,
  notes: String,
  start: String,
  end: String,
  alarm_minutes: Option<i64>,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let start_parts =
      parse_local_iso(&start).ok_or_else(|| "Event start time was invalid.".to_string())?;
    let end_parts =
      parse_local_iso(&end).ok_or_else(|| "Event end time was invalid.".to_string())?;

    let script = r#"on run argv
  set calName to item 1 of argv
  set evtSummary to item 2 of argv
  set evtBody to item 3 of argv
  set alarmMin to item 4 of argv
  set startDate to current date
  set year of startDate to (item 5 of argv) as integer
  set month of startDate to (item 6 of argv) as integer
  set day of startDate to (item 7 of argv) as integer
  set hours of startDate to (item 8 of argv) as integer
  set minutes of startDate to (item 9 of argv) as integer
  set seconds of startDate to (item 10 of argv) as integer
  set endDate to current date
  set year of endDate to (item 11 of argv) as integer
  set month of endDate to (item 12 of argv) as integer
  set day of endDate to (item 13 of argv) as integer
  set hours of endDate to (item 14 of argv) as integer
  set minutes of endDate to (item 15 of argv) as integer
  set seconds of endDate to (item 16 of argv) as integer
  tell application "Calendar"
    launch
    -- Resolve the calendar by looping and holding a direct reference. The
    -- by-name `exists calendar <name>` / `calendar <name>` and `whose`
    -- specifiers are the scripting pattern that crashes on macOS 26.
    set targetCal to missing value
    if calName is "" then
      repeat with aCal in every calendar
        if (writable of aCal) is true then
          set targetCal to aCal
          exit repeat
        end if
      end repeat
    else
      repeat with aCal in every calendar
        if (name of aCal) is calName then
          set targetCal to aCal
          exit repeat
        end if
      end repeat
      if targetCal is missing value then
        set targetCal to (make new calendar with properties {name:calName})
      end if
    end if
    tell targetCal
      set newEvent to make new event with properties {summary:evtSummary, start date:startDate, end date:endDate, description:evtBody}
      if alarmMin is not "" then
        tell newEvent to make new display alarm at end of display alarms with properties {trigger interval:-(alarmMin as integer)}
      end if
    end tell
  end tell
end run"#;

    let alarm_arg = alarm_minutes
      .map(|m| m.to_string())
      .unwrap_or_default();

    // Calendar.app must be running before it will accept new events, otherwise
    // AppleScript fails with -600 ("Application isn't running"). Launch it in
    // the background first — `-g` keeps focus where it is, `-j` keeps it hidden
    // — so a cold start never races the script below.
    let _ = Command::new("open")
      .args(["-g", "-j", "-a", "Calendar"])
      .status();

    let mut cmd = Command::new("osascript");
    cmd
      .arg("-")
      .arg(calendar.trim())
      .arg(&title)
      .arg(&notes)
      .arg(alarm_arg)
      .arg(start_parts.0.to_string())
      .arg(start_parts.1.to_string())
      .arg(start_parts.2.to_string())
      .arg(start_parts.3.to_string())
      .arg(start_parts.4.to_string())
      .arg(start_parts.5.to_string())
      .arg(end_parts.0.to_string())
      .arg(end_parts.1.to_string())
      .arg(end_parts.2.to_string())
      .arg(end_parts.3.to_string())
      .arg(end_parts.4.to_string())
      .arg(end_parts.5.to_string())
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

    let mut child = cmd
      .spawn()
      .map_err(|e| format!("Could not launch osascript: {e}"))?;

    {
      let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not write AppleScript to osascript".to_string())?;
      stdin
        .write_all(script.as_bytes())
        .map_err(|e| format!("Could not send AppleScript: {e}"))?;
    }

    let output = child
      .wait_with_output()
      .map_err(|e| format!("osascript did not complete: {e}"))?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      let message = stderr.trim();
      let detail = if message.is_empty() {
        "Apple Calendar automation failed. Grant Chute permission to control Calendar in System Settings > Privacy & Security > Automation.".to_string()
      } else {
        message.to_string()
      };
      return Err(detail);
    }

    Ok(())
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (calendar, title, notes, start, end, alarm_minutes);
    Err("Apple Calendar is only available on macOS.".to_string())
  }
}

// ---------------------------------------------------------------------------
// Chute-native timers — countdown timers/pomodoros handled entirely in-app.
// A background thread waits out the duration, then fires a system
// notification + sound and emits `chute://timer-fired`. Tracked in AppState
// so they can be listed and cancelled. In-memory only: a timer does not
// survive an app restart (acceptable for short work-session timers).
// ---------------------------------------------------------------------------

/// A live countdown timer, kept in AppState for listing and cancellation.
pub struct TimerEntry {
  pub label: String,
  pub fire_at_ms: u128,
  pub cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[derive(serde::Serialize)]
pub struct ActiveTimer {
  pub id: String,
  pub label: String,
  pub remaining_seconds: i64,
}

fn epoch_ms() -> u128 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn fire_timer_alert(label: &str) {
  use std::process::Command;
  let title = format!("Chute — {}", label.replace('\\', " ").replace('"', "'"));
  let script =
    format!("display notification \"Time's up\" with title \"{title}\" sound name \"Glass\"");
  let _ = Command::new("osascript").arg("-e").arg(&script).status();
}

#[cfg(not(target_os = "macos"))]
fn fire_timer_alert(_label: &str) {}

/// Start a countdown timer. Returns its id. Fires a notification + sound and
/// emits `chute://timer-fired` (payload: the label) when it elapses.
#[tauri::command]
pub fn start_chute_timer(
  app: tauri::AppHandle,
  state: State<'_, AppState>,
  seconds: u64,
  label: String,
) -> Result<String, String> {
  use std::sync::atomic::{AtomicBool, Ordering};
  use std::sync::Arc;
  use std::time::{Duration, Instant};

  let seconds = seconds.clamp(1, 24 * 3600);
  let id = format!("t{}", epoch_ms());
  let fire_at_ms = epoch_ms() + (seconds as u128) * 1000;
  let cancel = Arc::new(AtomicBool::new(false));

  state.timers.lock().unwrap().insert(
    id.clone(),
    TimerEntry {
      label: label.clone(),
      fire_at_ms,
      cancel: cancel.clone(),
    },
  );

  let id_task = id.clone();
  let app_task = app.clone();
  std::thread::spawn(move || {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
      if cancel.load(Ordering::Relaxed) {
        return;
      }
      std::thread::sleep(Duration::from_millis(400));
    }
    if cancel.load(Ordering::Relaxed) {
      return;
    }
    app_task
      .state::<AppState>()
      .timers
      .lock()
      .unwrap()
      .remove(&id_task);
    fire_timer_alert(&label);
    let _ = app_task.emit("chute://timer-fired", label);
  });

  Ok(id)
}

#[tauri::command]
pub fn cancel_chute_timer(state: State<'_, AppState>, id: String) -> Result<(), String> {
  use std::sync::atomic::Ordering;
  if let Some(entry) = state.timers.lock().unwrap().remove(&id) {
    entry.cancel.store(true, Ordering::Relaxed);
  }
  Ok(())
}

#[tauri::command]
pub fn list_chute_timers(state: State<'_, AppState>) -> Vec<ActiveTimer> {
  let now = epoch_ms();
  let timers = state.timers.lock().unwrap();
  let mut out: Vec<ActiveTimer> = timers
    .iter()
    .map(|(id, e)| ActiveTimer {
      id: id.clone(),
      label: e.label.clone(),
      remaining_seconds: ((e.fire_at_ms as i128 - now as i128) / 1000) as i64,
    })
    .collect();
  out.sort_by_key(|t| t.remaining_seconds);
  out
}
