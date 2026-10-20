//! Chute's floating windows as non-activating `NSPanel`s.
//!
//! - **The capture bar** must take the keyboard from the global hotkey.
//!   Activating Chute for that is only a request on current macOS and is
//!   often refused, so the bar appeared while typing stayed in the previous
//!   app. A non-activating panel takes the keyboard without activating Chute
//!   (how Spotlight and Raycast work), and the previous app gets it back when
//!   the bar hides.
//! - **The Landed notch panel** must show over other apps' full-screen and
//!   Split View Spaces. For a regular app, only a non-activating panel with
//!   `fullScreenAuxiliary` is allowed there; an ordinary window silently stays
//!   off screen.
//!
//! Tao only creates `NSWindow`s, so these windows' classes are swapped to
//! `NSPanel` subclasses at startup. AppKit's KVO bookkeeping is tied to the
//! original class (a KVO subclass of `TaoWindow`), so the original classes
//! are put back before the windows are torn down, or dealloc throws.

#![cfg(target_os = "macos")]

use std::collections::HashMap;
use std::sync::Mutex;

use objc2::runtime::{AnyClass, AnyObject, NSObjectProtocol};
use objc2::{define_class, msg_send, sel, ClassType, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSPanel, NSWindow, NSWindowStyleMask};
use tauri::{AppHandle, Manager, WebviewWindow};

define_class!(
  // SAFETY: NSPanel has no subclassing requirements, and this class adds no
  // ivars or Drop, so it can stand in for an NSWindow-sized instance (checked
  // in `swap`).
  #[unsafe(super(NSPanel, NSWindow))]
  #[thread_kind = MainThreadOnly]
  #[name = "ChuteCapturePanel"]
  struct CapturePanel;

  impl CapturePanel {
    // Same as TaoWindow for a focusable window; NSPanel alone would refuse
    // key status for a borderless window.
    #[unsafe(method(canBecomeKeyWindow))]
    fn can_become_key_window(&self) -> bool {
      true
    }

    #[unsafe(method(canBecomeMainWindow))]
    fn can_become_main_window(&self) -> bool {
      true
    }
  }
);

define_class!(
  // SAFETY: as for CapturePanel.
  #[unsafe(super(NSPanel, NSWindow))]
  #[thread_kind = MainThreadOnly]
  #[name = "ChuteOverlayPanel"]
  struct OverlayPanel;

  impl OverlayPanel {
    // Never takes the keyboard or becomes main: clicks just act.
    #[unsafe(method(canBecomeKeyWindow))]
    fn can_become_key_window(&self) -> bool {
      false
    }

    #[unsafe(method(canBecomeMainWindow))]
    fn can_become_main_window(&self) -> bool {
      false
    }
  }
);

/// Each swapped window's original class, by window label.
static ORIGINAL_CLASSES: Mutex<Option<HashMap<String, usize>>> = Mutex::new(None);

fn ns_window(window: &WebviewWindow) -> Option<&NSWindow> {
  let ptr = window.ns_window().ok()?;
  if ptr.is_null() {
    return None;
  }
  // Safety: Tauri hands back the live NSWindow, which outlives this borrow.
  Some(unsafe { &*(ptr as *const NSWindow) })
}

fn as_object(ns_window: &NSWindow) -> &AnyObject {
  // Safety: every NSWindow is an Objective-C object.
  unsafe { &*(ns_window as *const NSWindow as *const AnyObject) }
}

fn is_panel(label: &str) -> bool {
  ORIGINAL_CLASSES
    .lock()
    .ok()
    .and_then(|classes| classes.as_ref().map(|map| map.contains_key(label)))
    .unwrap_or(false)
}

/// Swap `window` to `target` and make it non-activating. Main thread only.
/// Returns false (leaving an ordinary window) if the swap isn't safe.
fn swap(window: &WebviewWindow, target: &AnyClass) -> bool {
  if MainThreadMarker::new().is_none() {
    eprintln!("[panels] swapping {} must run on the main thread", window.label());
    return false;
  }
  if is_panel(window.label()) {
    return true;
  }
  let Some(ns_window) = ns_window(window) else {
    return false;
  };
  let object = as_object(ns_window);
  let current: &AnyClass = object.class();
  if current.instance_size() < target.instance_size() {
    eprintln!(
      "[panels] keeping {} a plain window: {} is {} bytes, {} needs {}",
      window.label(),
      current.name().to_string_lossy(),
      current.instance_size(),
      target.name().to_string_lossy(),
      target.instance_size()
    );
    return false;
  }

  if let Ok(mut classes) = ORIGINAL_CLASSES.lock() {
    classes
      .get_or_insert_with(HashMap::new)
      .insert(window.label().to_string(), current as *const AnyClass as usize);
  }
  // Safety: the target is an NSWindow subclass with no ivars of its own and
  // the instance is large enough (checked above). `restore_all` puts the
  // original class back before the window is destroyed.
  unsafe {
    AnyObject::set_class(object, target);
  }
  ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
  // NSPanel's init normally syncs this from the style mask; after a class
  // swap it has to be set by hand.
  if ns_window.respondsToSelector(sel!(_setPreventsActivation:)) {
    // Safety: AppKit's own BOOL setter, checked to exist above.
    let _: () = unsafe { msg_send![ns_window, _setPreventsActivation: true] };
  }
  ns_window.setHidesOnDeactivate(false);
  true
}

/// The capture bar: a panel that takes the keyboard without activating Chute.
pub fn install_capture(window: &WebviewWindow) -> bool {
  swap(window, CapturePanel::class())
}

/// The Landed notch panel: never takes the keyboard, shows over full-screen
/// and Split View Spaces.
pub fn install_overlay(window: &WebviewWindow) -> bool {
  swap(window, OverlayPanel::class())
}

/// Give the capture bar the keyboard without activating Chute. Returns false
/// if the window isn't a panel, so the caller can fall back to activation.
pub fn focus(window: &WebviewWindow) -> bool {
  if !is_panel(window.label()) {
    return false;
  }
  let target = window.clone();
  window
    .run_on_main_thread(move || {
      if let Some(ns_window) = ns_window(&target) {
        ns_window.makeKeyAndOrderFront(None);
      }
    })
    .is_ok()
}

/// Put every swapped window's original class back. Call before destroying them.
pub fn restore_all(app: &AppHandle) {
  if MainThreadMarker::new().is_none() {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || restore_all(&handle));
    return;
  }
  let originals = ORIGINAL_CLASSES
    .lock()
    .ok()
    .and_then(|mut classes| classes.take())
    .unwrap_or_default();
  for (label, original) in originals {
    let Some(window) = app.get_webview_window(&label) else {
      continue;
    };
    let Some(ns_window) = ns_window(&window) else {
      continue;
    };
    // Safety: `original` is the class this instance had before the swap, and
    // classes live for the whole process.
    unsafe {
      let original = &*(original as *const AnyClass);
      AnyObject::set_class(as_object(ns_window), original);
    }
  }
}
