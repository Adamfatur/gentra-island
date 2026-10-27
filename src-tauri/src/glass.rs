//! Glass behind the island's droplets.
//!
//! CSS blur can't see the desktop through a transparent window, so the glass
//! is drawn by AppKit behind the webview: one view per droplet. On macOS 26
//! and later that is Liquid Glass (NSGlassEffectView), inside a container
//! that lets droplets close together flow into each other. Before that, it is
//! the system blur (NSVisualEffectView) with rounded corners. Elsewhere there
//! is no glass and the page fills its droplets itself.
//!
//! The page reports each droplet's rectangle and stays transparent there.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// A droplet, in the window's logical pixels from its top-left corner.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Shape {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub r: f64,
    /// Red, green, blue, alpha in 0 to 1. None: the system's own glass color.
    #[serde(default)]
    pub tint: Option<[f64; 4]>,
}

/// Which glass this system draws, so the page knows whether to fill droplets itself.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// Liquid Glass, macOS 26 and later.
    Liquid,
    /// The system blur, older macOS.
    Blur,
    /// No glass: Windows, Linux.
    None,
}

/// Droplets, the 1.0 island, while it's built: on with GENTRA_DROPLETS=1
/// (or localStorage gentra:droplets = 1 in the page).
#[tauri::command]
pub fn droplets_enabled() -> bool {
    std::env::var_os("GENTRA_DROPLETS").is_some()
}

/// A frame-rate probe for testing smoothness: on with GENTRA_FPS=1.
#[tauri::command]
pub fn fps_probe() -> bool {
    std::env::var_os("GENTRA_FPS").is_some()
}

/// Frames in the last second, and the slowest frame in it (ms).
#[tauri::command]
pub fn fps_log(fps: u32, worst: f64) {
    eprintln!("fps {fps} worst {worst:.1}");
}

#[tauri::command]
pub fn glass_kind() -> Kind {
    platform::kind()
}

/// Places glass behind these droplets, replacing the last set. With `ms`, the
/// glass moves to its new place over that long, on the same curve as the
/// page's CSS (cubic-bezier 0.2, 0.9, 0.25, 1), so both arrive together.
#[tauri::command]
pub fn set_glass(app: AppHandle, shapes: Vec<Shape>, ms: Option<u32>) -> Kind {
    let kind = platform::kind();
    if kind != Kind::None {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || platform::apply(&handle, kind, &shapes, ms.unwrap_or(0)));
    }
    kind
}

/// A window frame for a shape: AppKit counts y from the bottom unless the view is flipped.
pub fn to_frame(s: &Shape, height: f64, flipped: bool) -> (f64, f64, f64, f64) {
    let y = if flipped { s.y } else { height - s.y - s.h };
    (s.x, y, s.w, s.h)
}

/// The mockup's shapes, moving between two layouts every two seconds, so the
/// glass can be judged by eye and its cost measured. Only with GENTRA_GLASS_TEST
/// set: "native" animates natively, "frames" sends 60 updates a second, anything
/// else leaves the shapes still.
pub fn test_on_start(app: &AppHandle) {
    let Some(mode) = std::env::var_os("GENTRA_GLASS_TEST").map(|m| m.to_string_lossy().into_owned()) else { return };
    let tint = Some([0.06, 0.08, 0.2, 0.18]);
    let shape = |x: f64, y: f64, w: f64, h: f64, r: f64| Shape { x, y, w, h, r, tint };
    let a = vec![shape(150.0, 90.0, 150.0, 150.0, 75.0), shape(308.0, 90.0, 150.0, 150.0, 75.0), shape(500.0, 90.0, 150.0, 150.0, 75.0), shape(150.0, 260.0, 400.0, 84.0, 42.0)];
    let b = vec![shape(300.0, 40.0, 160.0, 40.0, 20.0), shape(330.0, 40.0, 100.0, 40.0, 20.0), shape(340.0, 40.0, 80.0, 40.0, 20.0), shape(250.0, 40.0, 260.0, 40.0, 20.0)];
    eprintln!("gentra-island: glass test ({mode}), kind {:?}", set_glass(app.clone(), a.clone(), None));
    if mode != "native" && mode != "frames" {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut open = true;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let (from, to) = if open { (&a, &b) } else { (&b, &a) };
            open = !open;
            if mode == "native" {
                set_glass(app.clone(), to.clone(), Some(360));
            } else {
                // 360 ms at 60 frames a second, eased like the CSS curve.
                for i in 1..=22 {
                    let t = ease(i as f64 / 22.0);
                    let mid = from.iter().zip(to).map(|(f, g)| Shape { x: lerp(f.x, g.x, t), y: lerp(f.y, g.y, t), w: lerp(f.w, g.w, t), h: lerp(f.h, g.h, t), r: lerp(f.r, g.r, t), tint }).collect();
                    set_glass(app.clone(), mid, None);
                    std::thread::sleep(std::time::Duration::from_millis(16));
                }
            }
        }
    });
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Close to cubic-bezier(0.2, 0.9, 0.25, 1): fast out, gentle landing.
fn ease(t: f64) -> f64 {
    1.0 - (1.0 - t).powi(3)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{msg_send, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSAnimationContext, NSAutoresizingMaskOptions, NSColor, NSGlassEffectContainerView, NSGlassEffectView, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState,
        NSVisualEffectView, NSWindow, NSWindowOrderingMode,
    };
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use objc2_quartz_core::CAMediaTimingFunction;
    use tauri::Manager;

    use super::{Kind, Shape};

    /// How close two droplets get before their glass flows together.
    const MERGE: f64 = 14.0;

    struct Glass {
        root: Retained<NSView>,
        views: Vec<Retained<NSView>>,
    }

    thread_local! {
        static GLASS: RefCell<Option<Glass>> = const { RefCell::new(None) };
    }

    /// NSGlassEffectView arrived in macOS 26; asking for a missing class would crash.
    /// GENTRA_GLASS_FALLBACK forces the older blur, to try it on a new Mac.
    pub fn kind() -> Kind {
        if AnyClass::get(c"NSGlassEffectView").is_some() && std::env::var_os("GENTRA_GLASS_FALLBACK").is_none() {
            Kind::Liquid
        } else {
            Kind::Blur
        }
    }

    fn color(tint: [f64; 4]) -> Retained<NSColor> {
        NSColor::colorWithSRGBRed_green_blue_alpha(tint[0], tint[1], tint[2], tint[3])
    }

    fn make(mtm: MainThreadMarker, kind: Kind) -> Retained<NSView> {
        let zero = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0));
        if kind == Kind::Liquid {
            return Retained::into_super(NSGlassEffectView::initWithFrame(NSGlassEffectView::alloc(mtm), zero));
        }
        let blur = NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), zero);
        blur.setMaterial(NSVisualEffectMaterial::HUDWindow);
        blur.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        blur.setState(NSVisualEffectState::Active);
        blur.setWantsLayer(true);
        Retained::into_super(blur)
    }

    fn style(view: &NSView, kind: Kind, s: &Shape) {
        if kind == Kind::Liquid {
            let tint = s.tint.map(color);
            // SAFETY: the view is an NSGlassEffectView; both setters exist on it.
            unsafe {
                let _: () = msg_send![view, setCornerRadius: s.r];
                let _: () = msg_send![view, setTintColor: tint.as_deref()];
            }
        } else if let Some(layer) = view.layer() {
            layer.setCornerRadius(s.r);
            layer.setMasksToBounds(true);
        }
    }

    pub fn apply(app: &tauri::AppHandle, kind: Kind, shapes: &[Shape], ms: u32) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(win) = app.get_webview_window(crate::window::LABEL) else { return };
        let Ok(ptr) = win.ns_window() else { return };
        // SAFETY: Tauri hands us the live NSWindow pointer for this window.
        let ns: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
        let Some(content) = ns.contentView() else { return };
        let fill = NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable;
        GLASS.with(|cell| {
            let mut cell = cell.borrow_mut();
            let glass = cell.get_or_insert_with(|| {
                let bounds = content.bounds();
                let root = NSView::initWithFrame(NSView::alloc(mtm), bounds);
                root.setAutoresizingMask(fill);
                let holder: Retained<NSView> = if kind == Kind::Liquid {
                    let container = NSGlassEffectContainerView::initWithFrame(NSGlassEffectContainerView::alloc(mtm), bounds);
                    container.setSpacing(MERGE);
                    container.setAutoresizingMask(fill);
                    container.setContentView(Some(&root));
                    Retained::into_super(container)
                } else {
                    root.clone()
                };
                // Below the webview, which stays transparent over each droplet.
                content.addSubview_positioned_relativeTo(&holder, NSWindowOrderingMode::Below, None);
                Glass { root, views: Vec::new() }
            });
            while glass.views.len() < shapes.len() {
                let view = make(mtm, kind);
                glass.root.addSubview(&view);
                glass.views.push(view);
            }
            while glass.views.len() > shapes.len() {
                if let Some(view) = glass.views.pop() {
                    view.removeFromSuperview();
                }
            }
            let height = glass.root.bounds().size.height;
            let flipped = glass.root.isFlipped();
            if ms > 0 {
                NSAnimationContext::beginGrouping();
                let ctx = NSAnimationContext::currentContext();
                ctx.setDuration(ms as f64 / 1000.0);
                ctx.setAllowsImplicitAnimation(true);
                ctx.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(0.2, 0.9, 0.25, 1.0)));
            }
            for (view, s) in glass.views.iter().zip(shapes) {
                let (x, y, w, h) = super::to_frame(s, height, flipped);
                let frame = NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));
                if ms > 0 {
                    // SAFETY: every NSView has an animator proxy that answers setFrame:.
                    unsafe {
                        let proxy: *mut AnyObject = msg_send![&**view, animator];
                        let _: () = msg_send![proxy, setFrame: frame];
                    }
                } else {
                    view.setFrame(frame);
                }
                style(view, kind, s);
            }
            if ms > 0 {
                NSAnimationContext::endGrouping();
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{Kind, Shape};

    pub fn kind() -> Kind {
        Kind::None
    }

    pub fn apply(_app: &tauri::AppHandle, _kind: Kind, _shapes: &[Shape], _ms: u32) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_count_from_the_bottom_unless_flipped() {
        let s = Shape { x: 10.0, y: 20.0, w: 100.0, h: 40.0, r: 20.0, tint: None };
        assert_eq!(to_frame(&s, 520.0, false), (10.0, 460.0, 100.0, 40.0));
        assert_eq!(to_frame(&s, 520.0, true), (10.0, 20.0, 100.0, 40.0));
    }

    #[test]
    fn shapes_arrive_from_the_page_with_or_without_a_tint() {
        let s: Vec<Shape> = serde_json::from_str(r#"[{"x":1,"y":2,"w":3,"h":4,"r":2},{"x":1,"y":2,"w":3,"h":4,"r":2,"tint":[0,0,0,0.3]}]"#).unwrap();
        assert_eq!(s[0].tint, None);
        assert_eq!(s[1].tint, Some([0.0, 0.0, 0.0, 0.3]));
        assert_eq!(serde_json::to_string(&Kind::Liquid).unwrap(), "\"liquid\"");
    }

    #[test]
    fn the_test_curve_lands_gently() {
        assert_eq!(ease(0.0), 0.0);
        assert_eq!(ease(1.0), 1.0);
        assert!(ease(0.5) > 0.8);
    }
}
