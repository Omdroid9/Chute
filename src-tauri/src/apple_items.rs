//! Find a capture again in the Apple app it landed in, using the id Chute kept
//! when it was created (see `capture_links`): open it there, or add to it.
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

// Additions go to the same item: a line in a reminder's or event's notes, a
// block at the end of a note. Errors carry AppleScript's number so -1743
// (no Automation permission) reads as such in Landed.
#[cfg(target_os = "macos")]
const APPEND_TO_REMINDER: &str = r#"on run argv
  tell application "Reminders"
    set theReminder to reminder id (item 1 of argv)
    set oldBody to body of theReminder
    if oldBody is missing value then set oldBody to ""
    if oldBody is "" then
      set body of theReminder to (item 2 of argv)
    else
      set body of theReminder to oldBody & linefeed & (item 2 of argv)
    end if
  end tell
  return "ok"
end run"#;

#[cfg(target_os = "macos")]
const APPEND_TO_NOTE: &str = r#"on run argv
  tell application "Notes"
    set theNote to note id (item 1 of argv)
    set body of theNote to (body of theNote) & (item 2 of argv)
  end tell
  return "ok"
end run"#;

// The event is addressed by id (its uid): first in the calendar Chute writes
// to (named, else first writable), then in each other calendar. A by-id
// lookup that misses just errors, unlike `whose`, which can crash Calendar.
#[cfg(target_os = "macos")]
const APPEND_TO_EVENT: &str = r#"on addTo(theCal, eventUid, addition)
  tell application "Calendar"
    try
      set oldNotes to description of (event id eventUid of theCal)
    on error errMsg number errNum
      if errNum is -1743 then error errMsg number errNum
      return false
    end try
    if oldNotes is missing value then set oldNotes to ""
    if oldNotes is "" then
      set description of (event id eventUid of theCal) to addition
    else
      set description of (event id eventUid of theCal) to oldNotes & linefeed & addition
    end if
  end tell
  return true
end addTo

on run argv
  set eventUid to item 1 of argv
  set addition to item 2 of argv
  set calName to item 3 of argv
  tell application "Calendar"
    set allCals to every calendar
    set preferred to missing value
    repeat with aCal in allCals
      if calName is "" then
        if (writable of aCal) is true then
          set preferred to contents of aCal
          exit repeat
        end if
      else if (name of aCal) is calName then
        set preferred to contents of aCal
        exit repeat
      end if
    end repeat
  end tell
  if preferred is not missing value then
    if my addTo(preferred, eventUid, addition) then return "ok"
  end if
  repeat with aCal in allCals
    if my addTo(contents of aCal, eventUid, addition) then return "ok"
  end repeat
  error "Couldn't find the event in Calendar."
end run"#;

#[cfg(target_os = "macos")]
async fn run_append(script: &'static str, args: Vec<String>) -> Result<(), String> {
  if args.first().map_or(true, |id| id.trim().is_empty()) {
    return Err("No item to add to.".to_string());
  }
  let started = std::time::Instant::now();
  let result = tauri::async_runtime::spawn_blocking(move || run_osascript(script, &args).map(|_| ()))
    .await
    .map_err(|error| error.to_string())?;
  eprintln!(
    "[apple] append: {} ms, {}",
    started.elapsed().as_millis(),
    if result.is_ok() { "ok" } else { "failed" }
  );
  result
}

/// Add a line to a reminder's notes.
#[tauri::command]
pub async fn append_to_reminder(id: String, text: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    run_append(APPEND_TO_REMINDER, vec![id, text]).await
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (id, text);
    Err("Apple Reminders is only available on macOS.".to_string())
  }
}

/// Add HTML (already escaped by the caller) to the end of a note.
#[tauri::command]
pub async fn append_to_apple_note(id: String, html: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    run_append(APPEND_TO_NOTE, vec![id, html]).await
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (id, html);
    Err("Apple Notes is only available on macOS.".to_string())
  }
}

/// Add a line to a Calendar event's notes. `calendar` is the calendar Chute
/// writes to ("" = first writable), searched first.
#[tauri::command]
pub async fn append_to_calendar_event(uid: String, text: String, calendar: Option<String>) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    // Calendar refuses scripting until it's running (-600); start it hidden.
    let _ = std::process::Command::new("open")
      .args(["-g", "-j", "-a", "Calendar"])
      .status();
    run_append(APPEND_TO_EVENT, vec![uid, text, calendar.unwrap_or_default()]).await
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (uid, text, calendar);
    Err("Apple Calendar is only available on macOS.".to_string())
  }
}

// Done and Snooze from Landed change the reminder by id, like additions.
#[cfg(target_os = "macos")]
const SET_REMINDER_COMPLETED: &str = r#"on run argv
  tell application "Reminders"
    set completed of (reminder id (item 1 of argv)) to ((item 2 of argv) is "true")
  end tell
  return "ok"
end run"#;

// Snoozing means "remind me later", so a snoozed reminder is never left done.
// An alert set in Reminders moves too, or it would still go off at the old time.
#[cfg(target_os = "macos")]
const SNOOZE_REMINDER: &str = r#"on run argv
  set dueDate to my makeDate((item 2 of argv) as integer, (item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer, (item 6 of argv) as integer, (item 7 of argv) as integer)
  tell application "Reminders"
    set theReminder to reminder id (item 1 of argv)
    set due date of theReminder to dueDate
    set completed of theReminder to false
    try
      if remind me date of theReminder is not missing value then set remind me date of theReminder to dueDate
    end try
  end tell
  return "ok"
end run"#;

#[cfg(target_os = "macos")]
async fn run_on_reminder(what: &'static str, script: String, args: Vec<String>) -> Result<(), String> {
  if args.first().map_or(true, |id| id.trim().is_empty()) {
    return Err("No reminder to change.".to_string());
  }
  let started = std::time::Instant::now();
  let result = tauri::async_runtime::spawn_blocking(move || {
    // Reminders refuses scripting until it's running (-600); start it hidden.
    let _ = std::process::Command::new("open")
      .args(["-g", "-j", "-a", "Reminders"])
      .status();
    run_osascript(&script, &args).map(|_| ())
  })
  .await
  .map_err(|error| error.to_string())?;
  eprintln!(
    "[apple] reminder {what}: {} ms, {}",
    started.elapsed().as_millis(),
    if result.is_ok() { "ok" } else { "failed" }
  );
  result
}

/// Mark a reminder done in Reminders, or not done again (Undo).
#[tauri::command]
pub async fn set_reminder_completed(id: String, completed: bool) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    run_on_reminder(
      if completed { "done" } else { "undone" },
      SET_REMINDER_COMPLETED.to_string(),
      vec![id, completed.to_string()],
    )
    .await
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (id, completed);
    Err("Apple Reminders is only available on macOS.".to_string())
  }
}

/// Move a reminder's due date to `due`, a local ISO datetime.
#[tauri::command]
pub async fn snooze_reminder(id: String, due: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let mut args = vec![id];
    args.extend(date_args(&due)?);
    run_on_reminder("snoozed", format!("{DATE_HANDLER}\n{SNOOZE_REMINDER}"), args).await
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (id, due);
    Err("Apple Reminders is only available on macOS.".to_string())
  }
}

// Moving an event from Landed: same by-id search as additions, then the start
// moves and the end follows, keeping its length. The end moves first when the
// event moves later (and the start first when earlier), so it never ends
// before it starts in between.
#[cfg(target_os = "macos")]
const MOVE_EVENT: &str = r#"on moveIn(theCal, eventUid, newStart)
  tell application "Calendar"
    try
      set oldStart to start date of (event id eventUid of theCal)
    on error errMsg number errNum
      if errNum is -1743 then error errMsg number errNum
      return false
    end try
    set span to (end date of (event id eventUid of theCal)) - oldStart
    if newStart > oldStart then
      set end date of (event id eventUid of theCal) to newStart + span
      set start date of (event id eventUid of theCal) to newStart
    else
      set start date of (event id eventUid of theCal) to newStart
      set end date of (event id eventUid of theCal) to newStart + span
    end if
  end tell
  return true
end moveIn

on run argv
  set eventUid to item 1 of argv
  set newStart to my makeDate((item 2 of argv) as integer, (item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer, (item 6 of argv) as integer, (item 7 of argv) as integer)
  set calName to item 8 of argv
  tell application "Calendar"
    set allCals to every calendar
    set preferred to missing value
    repeat with aCal in allCals
      if calName is "" then
        if (writable of aCal) is true then
          set preferred to contents of aCal
          exit repeat
        end if
      else if (name of aCal) is calName then
        set preferred to contents of aCal
        exit repeat
      end if
    end repeat
  end tell
  if preferred is not missing value then
    if my moveIn(preferred, eventUid, newStart) then return "ok"
  end if
  repeat with aCal in allCals
    if my moveIn(contents of aCal, eventUid, newStart) then return "ok"
  end repeat
  error "Couldn't find the event in Calendar."
end run"#;

/// Move a Calendar event to start at `start` (a local ISO datetime), keeping
/// its length. `calendar` is the calendar Chute writes to, searched first.
#[tauri::command]
pub async fn move_calendar_event(uid: String, start: String, calendar: Option<String>) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    if uid.trim().is_empty() {
      return Err("No event to move.".to_string());
    }
    let mut args = vec![uid];
    args.extend(date_args(&start)?);
    args.push(calendar.unwrap_or_default());
    let script = format!("{DATE_HANDLER}\n{MOVE_EVENT}");
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || {
      // Calendar refuses scripting until it's running (-600); start it hidden.
      let _ = std::process::Command::new("open")
        .args(["-g", "-j", "-a", "Calendar"])
        .status();
      run_osascript(&script, &args).map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?;
    eprintln!(
      "[apple] event moved: {} ms, {}",
      started.elapsed().as_millis(),
      if result.is_ok() { "ok" } else { "failed" }
    );
    result
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (uid, start, calendar);
    Err("Apple Calendar is only available on macOS.".to_string())
  }
}

// Finding an item Chute created before it kept ids ("capture_links"): match
// the title (AppleScript compares case-insensitively), skip items already
// matched to other captures, and only consider items made after the capture,
// earliest first, so identical captures map to their items in order. Bulk
// property reads (`name of every reminder`) are one Apple event each; `whose`
// lookups are avoided because they crash these apps on macOS 26.
#[cfg(target_os = "macos")]
const DATE_HANDLER: &str = r#"on makeDate(y, mo, d, h, mi, s)
  set theDate to current date
  set day of theDate to 1
  set year of theDate to y
  set month of theDate to mo
  set day of theDate to d
  set hours of theDate to h
  set minutes of theDate to mi
  set seconds of theDate to s
  return theDate
end makeDate

on pick(theTitles, theIds, theDates, wantTitle, notBefore, excluded)
  set bestId to ""
  set bestDate to missing value
  repeat with i from 1 to count of theTitles
    try
      if (item i of theTitles) is wantTitle then
        set candidate to item i of theIds
        set made to item i of theDates
        if excluded does not contain candidate and made is greater than (notBefore - 120) then
          if bestDate is missing value or made is less than bestDate then
            set bestDate to made
            set bestId to candidate
          end if
        end if
      end if
    end try
  end repeat
  return bestId
end pick
"#;

#[cfg(target_os = "macos")]
const FIND_REMINDER: &str = r#"on run argv
  set notBefore to my makeDate((item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer, (item 6 of argv) as integer, (item 7 of argv) as integer, (item 8 of argv) as integer)
  tell application "Reminders"
    set theList to missing value
    repeat with aList in every list
      if (name of aList) is (item 2 of argv) then
        set theList to aList
        exit repeat
      end if
    end repeat
    if theList is missing value then return ""
    set theTitles to name of every reminder of theList
    set theIds to id of every reminder of theList
    set theDates to creation date of every reminder of theList
  end tell
  return my pick(theTitles, theIds, theDates, item 1 of argv, notBefore, paragraphs of (item 9 of argv))
end run"#;

#[cfg(target_os = "macos")]
const FIND_NOTE: &str = r#"on run argv
  set notBefore to my makeDate((item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer, (item 6 of argv) as integer, (item 7 of argv) as integer, (item 8 of argv) as integer)
  tell application "Notes"
    set theFolder to missing value
    repeat with aFolder in every folder
      if (name of aFolder) is (item 2 of argv) then
        set theFolder to aFolder
        exit repeat
      end if
    end repeat
    if theFolder is missing value then return ""
    set theTitles to name of every note of theFolder
    set theIds to id of every note of theFolder
    set theDates to creation date of every note of theFolder
  end tell
  return my pick(theTitles, theIds, theDates, item 1 of argv, notBefore, paragraphs of (item 9 of argv))
end run"#;

// Events have no creation date; the modification ("stamp") date stands in.
// Only the calendar Chute writes to is searched (the named one, else the
// first writable one, as create_apple_calendar_event picks), and only titles
// and starts are read in bulk: Calendar is slow to script, so reading every
// property of every event in every calendar took a minute.
#[cfg(target_os = "macos")]
const FIND_EVENT: &str = r#"on run argv
  set notBefore to my makeDate((item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer, (item 6 of argv) as integer, (item 7 of argv) as integer, (item 8 of argv) as integer)
  set startAt to my makeDate((item 10 of argv) as integer, (item 11 of argv) as integer, (item 12 of argv) as integer, (item 13 of argv) as integer, (item 14 of argv) as integer, (item 15 of argv) as integer)
  set wantTitle to item 1 of argv
  set calName to item 2 of argv
  set excluded to paragraphs of (item 9 of argv)
  tell application "Calendar"
    set targetCal to missing value
    repeat with aCal in every calendar
      if calName is "" then
        if (writable of aCal) is true then
          set targetCal to aCal
          exit repeat
        end if
      else if (name of aCal) is calName then
        set targetCal to aCal
        exit repeat
      end if
    end repeat
    if targetCal is missing value then return ""
    set theTitles to summary of every event of targetCal
    set theStarts to start date of every event of targetCal
  end tell
  set bestId to ""
  set bestDate to missing value
  repeat with i from 1 to count of theTitles
    try
      if (item i of theTitles) is wantTitle then
        set offsetSeconds to (item i of theStarts) - startAt
        if offsetSeconds < 60 and offsetSeconds > -60 then
          tell application "Calendar"
            set candidate to uid of event i of targetCal
            set made to stamp date of event i of targetCal
          end tell
          if excluded does not contain candidate and made is greater than (notBefore - 120) then
            if bestDate is missing value or made is less than bestDate then
              set bestDate to made
              set bestId to candidate
            end if
          end if
        end if
      end if
    end try
  end repeat
  return bestId
end run"#;

#[cfg(target_os = "macos")]
fn date_args(value: &str) -> Result<Vec<String>, String> {
  let (year, month, day, hour, minute, second) = crate::commands::parse_local_iso(value)
    .ok_or_else(|| format!("Invalid date: {value}"))?;
  Ok(vec![
    year.to_string(),
    month.to_string(),
    day.to_string(),
    hour.to_string(),
    minute.to_string(),
    second.to_string(),
  ])
}

/// Find the item a capture became when Chute didn't keep its id. `container`
/// is the Reminders list / Notes folder / Calendar name ("" = writable
/// calendars); `not_before` and `start` are local ISO datetimes; `excluded`
/// are ids already matched to other captures. Resolves to "" if nothing fits.
#[tauri::command]
pub async fn find_apple_item(
  destination: String,
  title: String,
  container: String,
  not_before: String,
  start: Option<String>,
  excluded: Vec<String>,
) -> Result<String, String> {
  #[cfg(target_os = "macos")]
  {
    let mut args = vec![title, container];
    args.extend(date_args(&not_before)?);
    args.push(excluded.join("\n"));
    let (script, app) = match destination.as_str() {
      "reminders" => (FIND_REMINDER, "Reminders"),
      "apple_notes" => (FIND_NOTE, "Notes"),
      "apple_calendar" => {
        let start = start.ok_or_else(|| "A Calendar lookup needs the event's start.".to_string())?;
        args.extend(date_args(&start)?);
        (FIND_EVENT, "Calendar")
      }
      other => return Err(format!("Not an Apple app destination: {other}")),
    };
    let full = format!("{DATE_HANDLER}\n{script}");
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || {
      // These apps refuse scripting until they're running (-600); start hidden.
      let _ = std::process::Command::new("open").args(["-g", "-j", "-a", app]).status();
      run_osascript(&full, &args)
    })
    .await
    .map_err(|error| error.to_string())?;
    eprintln!(
      "[apple] find in {app}: {} ms, {}",
      started.elapsed().as_millis(),
      match &result {
        Ok(id) if id.is_empty() => "no match".to_string(),
        Ok(_) => "found".to_string(),
        Err(error) => format!("error: {error}"),
      }
    );
    result
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (destination, title, container, not_before, start, excluded);
    Err("Apple apps are only available on macOS.".to_string())
  }
}
