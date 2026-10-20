//! "Landed": the notch panel that shows where today's captures went.
//!
//! The window is a fixed transparent canvas pinned to the top-centre of the
//! screen under the pointer. On a MacBook it is centred on the notch; on a
//! screen without one the frontend draws a small parachute tab instead.
//!
//! Three things make it safe to leave on screen all day:
//! - **It never takes focus.** The window refuses key/main status (Tauri's
//!   `focusable(false)`) and is marked as preventing app activation, the same
//!   switch a non-activating `NSPanel` flips, so clicking it never pulls focus
//!   away from the app being typed in. (Re-classing Tao's window as an
//!   NSPanel breaks AppKit's KVO bookkeeping and crashes on dealloc.)
//! - **It is click-through.** The canvas ignores the mouse everywhere except
//!   the "hot rect" the frontend sets for its current shape. A main-thread
//!   poller (same pattern as `ptt_tap`) flips `ignoresMouseEvents` as the
//!   pointer crosses that rect.
//! - **Hover comes from the poller, not WebKit.** A non-key window gets no
//!   DOM hover events, so pointer state is pushed to the webview as events.

#![cfg(target_os = "macos")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use objc2::runtime::NSObjectProtocol;
use objc2::{msg_send, sel, MainThreadMarker};
use objc2_app_kit::{NSEvent, NSScreen, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "landed";

/// Room for the open panel plus its shadow. Everything outside the hot rect
/// is click-through, so a generous canvas costs nothing.
const CANVAS_WIDTH: f64 = 440.0;
const CANVAS_HEIGHT: f64 = 340.0;
/// Virtual notch drawn on screens without a real one.
const TAB_WIDTH: f64 = 46.0;
const TAB_HEIGHT: f64 = 14.0;
/// "Near" radius for the tab's approach state (y is weighted, as the tab is
/// wide and short).
const NEAR_RADIUS: f64 = 120.0;
const POLL_MS: u64 = 30;
/// Re-read screen geometry this often (in ticks) to catch resolution changes.
const GEOMETRY_REFRESH_TICKS: u32 = 64;
const KEYCODE_ESCAPE: u16 = 0x35;
const K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: u32 = 1;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
  fn CGEventSourceKeyState(state_id: u32, key_code: u16) -> bool;
}

#[derive(Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

impl Rect {
  fn contains(&self, x: f64, y: f64) -> bool {
    x >= self.x && x <= self.x + self.width && y >= self.y && y <= self.y + self.height
  }
}

/// Everything the frontend needs to draw, in canvas points (top-left origin).
#[derive(Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
  pub width: f64,
  pub height: f64,
  /// The real notch, or the tab's resting rect on screens without one.
  pub notch: Rect,
  pub has_notch: bool,
}

#[derive(Default)]
struct State {
  /// Cocoa frame of the canvas (bottom-left origin, global coordinates).
  frame: NSRect,
  screen_frame: NSRect,
  geometry: Geometry,
  hot: Rect,
  /// Off until the frontend reads the user's setting (Settings → General).
  enabled: bool,
  /// The frontend is showing more than its resting shape (Esc is watched).
  expanded: bool,
  passthrough: bool,
  last_pointer: Option<(bool, bool, bool, i32, i32)>,
  esc_down: bool,
  tick: u32,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
static POLL_STARTED: AtomicBool = AtomicBool::new(false);
static POLL_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

fn rect_contains_point(rect: NSRect, point: NSPoint) -> bool {
  point.x >= rect.origin.x
    && point.x <= rect.origin.x + rect.size.width
    && point.y >= rect.origin.y
    && point.y <= rect.origin.y + rect.size.height
}

fn same_rect(a: NSRect, b: NSRect) -> bool {
  (a.origin.x - b.origin.x).abs() < 0.5
    && (a.origin.y - b.origin.y).abs() < 0.5
    && (a.size.width - b.size.width).abs() < 0.5
    && (a.size.height - b.size.height).abs() < 0.5
}

/// Notch as (left edge in global x, width, height), if this screen has one.
/// `safeAreaInsets` only exists on macOS 12+, so ask before calling it.
fn notch_of(screen: &NSScreen) -> Option<(f64, f64, f64)> {
  if !screen.respondsToSelector(sel!(safeAreaInsets)) {
    return None;
  }
  let top = screen.safeAreaInsets().top;
  if top <= 0.0 {
    return None;
  }
  let frame = screen.frame();
  let left = screen.auxiliaryTopLeftArea().size.width;
  let right = screen.auxiliaryTopRightArea().size.width;
  let width = frame.size.width - left - right;
  if left <= 0.0 || right <= 0.0 || width <= 0.0 {
    return None;
  }
  Some((frame.origin.x + left, width, top))
}

/// Canvas frame and geometry for a screen.
fn layout_for(screen: &NSScreen) -> (NSRect, NSRect, Geometry) {
  let screen_frame = screen.frame();
  let screen_top = screen_frame.origin.y + screen_frame.size.height;
  let (centre_x, notch_width, notch_height, has_notch) = match notch_of(screen) {
    Some((left, width, height)) => (left + width / 2.0, width, height, true),
    None => (
      screen_frame.origin.x + screen_frame.size.width / 2.0,
      TAB_WIDTH,
      TAB_HEIGHT,
      false,
    ),
  };
  let frame = NSRect::new(
    NSPoint::new((centre_x - CANVAS_WIDTH / 2.0).round(), screen_top - CANVAS_HEIGHT),
    NSSize::new(CANVAS_WIDTH, CANVAS_HEIGHT),
  );
  let notch_x = centre_x - notch_width / 2.0 - frame.origin.x;
  let geometry = Geometry {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    notch: Rect { x: notch_x, y: 0.0, width: notch_width, height: notch_height },
    has_notch,
  };
  (frame, screen_frame, geometry)
}

fn screen_under(mtm: MainThreadMarker, point: NSPoint) -> Option<objc2::rc::Retained<NSScreen>> {
  NSScreen::screens(mtm)
    .iter()
    .find(|screen| rect_contains_point(screen.frame(), point))
}

/// The resting hot rect: the notch (or tab) with a little slack at the sides.
fn resting_hot_rect(geometry: &Geometry) -> Rect {
  let pad = if geometry.has_notch { 6.0 } else { 10.0 };
  Rect {
    x: geometry.notch.x - pad,
    y: 0.0,
    width: geometry.notch.width + pad * 2.0,
    height: geometry.notch.height + if geometry.has_notch { 0.0 } else { 6.0 },
  }
}

fn ns_window_of(app: &AppHandle) -> Option<&'static NSWindow> {
  let window = app.get_webview_window(LABEL)?;
  let ptr = window.ns_window().ok()?;
  if ptr.is_null() {
    return None;
  }
  // Safety: Tauri hands back the live NSWindow; it outlives every main-thread
  // call we make with it (the window is never destroyed while the app runs).
  Some(unsafe { &*(ptr as *const NSWindow) })
}

fn configure(ns_window: &NSWindow) {
  // What NSPanel's non-activating style does under the hood: clicks in this
  // window never activate Chute. Private, so only if this macOS has it.
  if ns_window.respondsToSelector(sel!(_setPreventsActivation:)) {
    // Safety: AppKit's own setter, taking a BOOL; checked to exist above.
    let _: () = unsafe { msg_send![ns_window, _setPreventsActivation: true] };
  } else {
    eprintln!("[landed] _setPreventsActivation: unavailable; clicks may activate Chute");
  }
  // Above the menu bar and its status items, so the shape can cover the notch.
  ns_window.setLevel(NSStatusWindowLevel + 1);
  // Not `Stationary`: the window server trims stationary windows by a few
  // points, which would leave a gap between the shape and the top edge.
  // `Transient` hides it during Mission Control instead.
  ns_window.setCollectionBehavior(
    NSWindowCollectionBehavior::CanJoinAllSpaces
      | NSWindowCollectionBehavior::Transient
      | NSWindowCollectionBehavior::FullScreenAuxiliary
      | NSWindowCollectionBehavior::IgnoresCycle,
  );
  ns_window.setHidesOnDeactivate(false);
  ns_window.setCanHide(false);
  ns_window.setHasShadow(false);
  ns_window.setIgnoresMouseEvents(true);
}

fn place(ns_window: &NSWindow, state: &mut State, screen: &NSScreen) -> bool {
  let (frame, screen_frame, geometry) = layout_for(screen);
  state.screen_frame = screen_frame;
  if same_rect(frame, state.frame) && geometry == state.geometry {
    return false;
  }
  state.frame = frame;
  state.geometry = geometry;
  state.hot = resting_hot_rect(&geometry);
  ns_window.setFrame_display(frame, true);
  true
}

fn emit_geometry(app: &AppHandle, geometry: Geometry) {
  let _ = app.emit_to(LABEL, "landed://geometry", geometry);
}

fn escape_is_down() -> bool {
  // Safety: reads current key state; needs no Input Monitoring grant.
  unsafe { CGEventSourceKeyState(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE, KEYCODE_ESCAPE) }
}

fn poll_once(app: &AppHandle) {
  let Some(mtm) = MainThreadMarker::new() else {
    return;
  };
  let Some(ns_window) = ns_window_of(app) else {
    return;
  };
  let mouse = NSEvent::mouseLocation();
  let buttons = NSEvent::pressedMouseButtons() != 0;

  let mut guard = match STATE.lock() {
    Ok(guard) => guard,
    Err(_) => return,
  };
  let Some(state) = guard.as_mut() else {
    return;
  };
  if !state.enabled {
    return;
  }
  state.tick = state.tick.wrapping_add(1);

  // Follow the pointer to whichever screen it is on, but never yank the
  // panel away while it is open.
  if !state.expanded
    && (!rect_contains_point(state.screen_frame, mouse) || state.tick % GEOMETRY_REFRESH_TICKS == 0)
  {
    if let Some(screen) = screen_under(mtm, mouse) {
      if place(ns_window, state, &screen) {
        emit_geometry(app, state.geometry);
      }
    }
  }

  let local_x = mouse.x - state.frame.origin.x;
  let local_y = state.frame.origin.y + state.frame.size.height - mouse.y;
  let on_screen = rect_contains_point(state.screen_frame, mouse);
  let inside = on_screen && state.hot.contains(local_x, local_y);
  let notch = state.geometry.notch;
  let dx = local_x - (notch.x + notch.width / 2.0);
  let near = on_screen && (dx * dx + (local_y * 1.6) * (local_y * 1.6)).sqrt() < NEAR_RADIUS;

  if inside == state.passthrough {
    ns_window.setIgnoresMouseEvents(!inside);
    state.passthrough = !inside;
  }

  // Positions are only interesting while the pointer is over the shape.
  let (px, py) = if inside { (local_x.round() as i32, local_y.round() as i32) } else { (-1, -1) };
  let pointer = (inside, near, buttons, px, py);
  if state.last_pointer != Some(pointer) {
    state.last_pointer = Some(pointer);
    let _ = app.emit_to(
      LABEL,
      "landed://pointer",
      json!({ "inside": inside, "near": near, "buttons": buttons, "x": px, "y": py }),
    );
  }

  if state.expanded {
    let esc = escape_is_down();
    if esc && !state.esc_down {
      let _ = app.emit_to(LABEL, "landed://escape", ());
    }
    state.esc_down = esc;
  } else {
    state.esc_down = false;
  }
}

fn start_poller(app: &AppHandle) {
  if POLL_STARTED.swap(true, Ordering::SeqCst) {
    return;
  }
  let app = app.clone();
  let spawn = thread::Builder::new().name("chute-landed-poll".into()).spawn(move || loop {
    if !POLL_IN_FLIGHT.swap(true, Ordering::SeqCst) {
      let tick_app = app.clone();
      if app
        .run_on_main_thread(move || {
          poll_once(&tick_app);
          POLL_IN_FLIGHT.store(false, Ordering::SeqCst);
        })
        .is_err()
      {
        POLL_IN_FLIGHT.store(false, Ordering::SeqCst);
      }
    }
    thread::sleep(Duration::from_millis(POLL_MS));
  });
  if let Err(err) = spawn {
    POLL_STARTED.store(false, Ordering::SeqCst);
    eprintln!("[landed] failed to spawn poller: {err}");
  }
}

/// Create the Landed window and start tracking the pointer. Call once from
/// setup (main thread). Nothing shows until `landed_set_enabled(true)`.
pub fn start(app: &AppHandle) {
  let Some(mtm) = MainThreadMarker::new() else {
    eprintln!("[landed] start must run on the main thread");
    return;
  };

  let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
    .title("Landed")
    .inner_size(CANVAS_WIDTH, CANVAS_HEIGHT)
    .decorations(false)
    .transparent(true)
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .accept_first_mouse(true)
    .focusable(false)
    .focused(false)
    .visible(false)
    .build();
  if let Err(err) = built {
    eprintln!("[landed] could not create window: {err}");
    return;
  }

  let Some(ns_window) = ns_window_of(app) else {
    eprintln!("[landed] no native window");
    return;
  };
  configure(ns_window);

  let mut state = State { passthrough: true, ..State::default() };
  let screen = screen_under(mtm, NSEvent::mouseLocation())
    .or_else(|| NSScreen::mainScreen(mtm));
  if let Some(screen) = screen {
    place(ns_window, &mut state, &screen);
  }
  if let Ok(mut guard) = STATE.lock() {
    *guard = Some(state);
  }

  // Stays ordered out until the frontend reads the setting and enables it.
  eprintln!(
    "[landed] ready ({})",
    if landed_geometry().has_notch { "notch" } else { "tab" }
  );
  start_poller(app);
}

#[tauri::command]
pub fn landed_geometry() -> Geometry {
  STATE
    .lock()
    .ok()
    .and_then(|guard| guard.as_ref().map(|state| state.geometry))
    .unwrap_or_default()
}

/// Set the clickable part of the canvas (canvas points, top-left origin).
/// `expanded` is true whenever the shape is bigger than its resting state.
#[tauri::command]
pub fn landed_set_hot_rect(x: f64, y: f64, width: f64, height: f64, expanded: bool) {
  if let Ok(mut guard) = STATE.lock() {
    if let Some(state) = guard.as_mut() {
      state.hot = Rect { x, y, width: width.max(0.0), height: height.max(0.0) };
      state.expanded = expanded;
      // Force a fresh pointer event so the frontend re-evaluates against the
      // new rect.
      state.last_pointer = None;
    }
  }
}

/// Show or hide the panel (Settings → General → Landed).
#[tauri::command]
pub fn landed_set_enabled(app: AppHandle, enabled: bool) {
  let handle = app.clone();
  let _ = app.run_on_main_thread(move || {
    let Some(ns_window) = ns_window_of(&handle) else {
      return;
    };
    if let Ok(mut guard) = STATE.lock() {
      if let Some(state) = guard.as_mut() {
        state.enabled = enabled;
        state.expanded = false;
        state.passthrough = true;
        state.last_pointer = None;
      }
    }
    ns_window.setIgnoresMouseEvents(true);
    if enabled {
      ns_window.orderFrontRegardless();
    } else {
      ns_window.orderOut(None);
    }
  });
}

/// Menu bar icon click: open the panel if it's on. Returns false when it's
/// off, so the caller can open the capture bar instead.
pub fn open_from_tray(app: &AppHandle) -> bool {
  let enabled = STATE
    .lock()
    .ok()
    .and_then(|guard| guard.as_ref().map(|state| state.enabled))
    .unwrap_or(false);
  if enabled {
    let _ = app.emit_to(LABEL, "landed://open", ());
  }
  enabled
}
