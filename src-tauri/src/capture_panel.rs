//! The capture bar as a Spotlight-style panel.
//!
//! Showing an ordinary window from the global hotkey needs Chute to become the
//! active app, and current macOS treats that as a request it may refuse: the
//! bar appears but typing keeps going to the previous app. A non-activating
//! `NSPanel` can take the keyboard without activating Chute at all (how
//! Spotlight and Raycast work), so the caret always lands in the bar and the
//! previous app gets the keyboard back when the bar hides.
//!
//! Tao only creates `NSWindow`s, so the capture window's class is swapped to
//! an `NSPanel` subclass at startup. AppKit's KVO bookkeeping is tied to the
//! original class (a KVO subclass of `TaoWindow`), so the original class must
//! be put back before the window is torn down, or dealloc throws.

#![cfg(target_os = "macos")]

use std::sync::atomic::{AtomicUsize, Ordering};

use objc2::runtime::{AnyClass, AnyObject, NSObjectProtocol};
use objc2::{define_class, msg_send, sel, ClassType, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSPanel, NSWindow, NSWindowStyleMask};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::window::CAPTURE_WINDOW_LABEL;

define_class!(
  // SAFETY: NSPanel has no subclassing requirements, and this class adds no
  // ivars or Drop, so it can stand in for an NSWindow-sized instance (checked
  // in `install`).
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

/// The window's class before the swap; 0 while no swap is in place.
static ORIGINAL_CLASS: AtomicUsize = AtomicUsize::new(0);

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

/// Turn the capture window into a non-activating panel. Main thread only.
/// Returns false (leaving an ordinary window) if the swap isn't safe.
pub fn install(window: &WebviewWindow) -> bool {
  if MainThreadMarker::new().is_none() {
    eprintln!("[capture] panel install must run on the main thread");
    return false;
  }
  if ORIGINAL_CLASS.load(Ordering::SeqCst) != 0 {
    return true;
  }
  let Some(ns_window) = ns_window(window) else {
    return false;
  };
  let object = as_object(ns_window);
  let current: &AnyClass = object.class();
  let target: &AnyClass = CapturePanel::class();
  if current.instance_size() < target.instance_size() {
    eprintln!(
      "[capture] keeping a plain window: {} is {} bytes, {} needs {}",
      current.name().to_string_lossy(),
      current.instance_size(),
      target.name().to_string_lossy(),
      target.instance_size()
    );
    return false;
  }

  ORIGINAL_CLASS.store(current as *const AnyClass as usize, Ordering::SeqCst);
  // Safety: CapturePanel is an NSWindow subclass with no ivars of its own and
  // the instance is large enough (checked above). The original class is put
  // back by `restore` before the window is destroyed.
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

/// Give the capture bar the keyboard without activating Chute. Returns false
/// if the window isn't a panel, so the caller can fall back to activation.
pub fn focus(window: &WebviewWindow) -> bool {
  if ORIGINAL_CLASS.load(Ordering::SeqCst) == 0 {
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

/// Put the capture window's original class back. Call before destroying it.
pub fn restore(app: &AppHandle) {
  if MainThreadMarker::new().is_none() {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || restore(&handle));
    return;
  }
  let original = ORIGINAL_CLASS.swap(0, Ordering::SeqCst);
  if original == 0 {
    return;
  }
  let Some(window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) else {
    return;
  };
  let Some(ns_window) = ns_window(&window) else {
    return;
  };
  // Safety: `original` is the class this instance had before `install`, and
  // classes live for the whole process.
  unsafe {
    let original = &*(original as *const AnyClass);
    AnyObject::set_class(as_object(ns_window), original);
  }
}
