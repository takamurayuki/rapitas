//! link_webview tests
//!
//! Labels, rectangles, URL validation, and the capability audit that keeps
//! every in-app browser webview outside all capabilities (nav60 §5.2).

use super::*;

#[test]
fn rejects_non_http_schemes() {
    // The view lives inside the app window, so these are escalation sinks.
    for url in [
        "javascript:alert(1)",
        "file:///C:/Windows/System32/drivers/etc/hosts",
        "data:text/html,<script>alert(1)</script>",
        "tauri://localhost",
        "",
    ] {
        assert!(validate_url(url).is_err(), "{url} should be rejected");
    }
}

#[test]
fn rejects_the_app_and_the_backend() {
    for url in [
        "http://127.0.0.1:3000/",
        "http://localhost:3000/tasks",
        "http://127.0.0.1:3001/tasks/1/execute",
        "http://localhost:3001",
        "http://[::1]:3001/",
        "http://127.1:3001/",
        "http://tauri.localhost/",
        "https://tauri.localhost/",
    ] {
        assert!(validate_url(url).is_err(), "{url} should be rejected");
    }
}

#[test]
fn accepts_web_urls_and_other_local_servers() {
    for url in [
        "http://example.com",
        "https://github.com/owner/repo/issues/1",
        "http://localhost:5173/",
    ] {
        assert!(validate_url(url).is_ok(), "{url} should be accepted");
    }
}

#[test]
fn sanitizes_degenerate_rectangles() {
    let b = Bounds {
        x: -10.0,
        y: -1.0,
        width: 0.0,
        height: -5.0,
    }
    .sanitized();
    assert_eq!((b.x, b.y), (0.0, 0.0));
    assert!(b.width >= 1.0 && b.height >= 1.0);
}

#[test]
fn keeps_valid_rectangles_unchanged() {
    let b = Bounds {
        x: 320.0,
        y: 48.0,
        width: 600.0,
        height: 800.0,
    }
    .sanitized();
    assert_eq!((b.x, b.y, b.width, b.height), (320.0, 48.0, 600.0, 800.0));
}

#[test]
fn builds_a_label_per_tab() {
    assert_eq!(label_for("t1").unwrap(), "link-view-t1");
    assert_ne!(label_for("t1").unwrap(), label_for("t2").unwrap());
}

#[test]
fn rejects_tab_ids_that_are_not_plain_tokens() {
    let too_long = "x".repeat(33);
    for id in ["", "a b", "../x", "t1\n", "t1/../t2", too_long.as_str()] {
        assert!(label_for(id).is_err(), "{id:?} should be rejected");
    }
}

#[test]
fn recognises_link_view_callers_only() {
    assert!(is_link_view_label("link-view-t1"));
    assert!(is_link_view_label(CLEAR_DATA_LABEL));
    for label in [
        "main",
        "quick-capture",
        "notification-toast",
        "pomodoro-float",
        "today-todo",
    ] {
        assert!(!is_link_view_label(label), "{label}");
    }
}

/// Whether a capability `windows` / `webviews` pattern matches a label.
///
/// Tauri matches these as globs; the only wildcard this repo could plausibly
/// use is `*`, so a pattern with `*` is treated as matching anything with the
/// same literal prefix/suffix — conservative for an audit.
fn pattern_matches(pattern: &str, label: &str) -> bool {
    match pattern.split_once('*') {
        None => pattern == label,
        Some((head, tail)) => {
            label.len() >= head.len() + tail.len()
                && label.starts_with(head)
                && label.ends_with(tail)
        }
    }
}

/// Every capability (source files and the generated schema) by identifier,
/// with its `windows` and `webviews` patterns.
fn capability_patterns() -> Vec<(String, Vec<String>)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut out = Vec::new();
    let mut push = |id: String, cap: &serde_json::Value| {
        let mut patterns = Vec::new();
        for key in ["windows", "webviews"] {
            if let Some(list) = cap[key].as_array() {
                patterns.extend(list.iter().filter_map(|v| v.as_str().map(str::to_string)));
            }
        }
        out.push((id, patterns));
    };
    for entry in std::fs::read_dir(root.join("capabilities")).expect("capabilities dir") {
        let path = entry.expect("dir entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let cap: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read")).expect("json");
        push(path.display().to_string(), &cap);
    }
    let gen: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("gen/schemas/capabilities.json")).expect("gen schema"),
    )
    .expect("gen json");
    for (id, cap) in gen.as_object().expect("object") {
        push(format!("gen:{id}"), cap);
    }
    out
}

#[test]
fn no_capability_reaches_an_in_app_browser_webview() {
    // A capability scoped by `windows` covers EVERY webview in that window,
    // child webviews included — `windows: ["main"]` would hand the remote
    // pages in `link-view-*` the main window's permissions.
    let caps = capability_patterns();
    assert!(!caps.is_empty());
    for (id, patterns) in caps {
        for probe in ["link-view-x", "external-x"] {
            assert!(
                !patterns.iter().any(|p| pattern_matches(p, probe)),
                "{id} matches {probe}: {patterns:?}"
            );
        }
    }
}

#[test]
fn the_app_windows_keep_their_capabilities() {
    let caps = capability_patterns();
    for label in [
        "main",
        "quick-capture",
        "notification-toast",
        "pomodoro-float",
        "today-todo",
    ] {
        assert!(
            caps.iter()
                .any(|(_, ps)| ps.iter().any(|p| pattern_matches(p, label))),
            "{label} lost its capability"
        );
    }
}

#[test]
fn the_capability_files_use_webviews_not_windows() {
    // `windows` is what leaks into child webviews; the fix is to scope by
    // webview label. Guard against a later edit reintroducing it.
    for (id, _) in capability_patterns() {
        if id.starts_with("gen:") {
            continue;
        }
        let cap: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&id).expect("read")).expect("json");
        assert!(cap.get("windows").is_none(), "{id} still scopes by windows");
    }
}

#[test]
fn show_and_hide_are_called_only_inside_apply_visible() {
    // nav60 §3.1: every show/hide — the ordered commands, the hide right
    // after creation and the teardown of the clear-data command — goes
    // through `apply_visible`, which can only be called with the sequence
    // lock held. So `.show()` and `.hide()` each appear exactly once.
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/link_webview");
    let (mut shows, mut hides) = (0, 0);
    for name in ["mod.rs", "builder.rs"] {
        let src = std::fs::read_to_string(dir.join(name)).expect("read");
        let code: String = src
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        shows += code.matches(".show()").count();
        hides += code.matches(".hide()").count();
    }
    assert_eq!(shows, 1, "show() must only be called by apply_visible");
    assert_eq!(hides, 1, "hide() must only be called by apply_visible");
}

/// Source of a link_webview file with `//` comment lines removed.
fn code_of(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/link_webview")
        .join(name);
    std::fs::read_to_string(path)
        .expect("read")
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn new_link_views_do_not_take_keyboard_focus() {
    // A tab's webview is created hidden, off-screen at 1x1. With tauri's
    // default `focus: true` it took keyboard focus at that moment, so typing
    // went into a page nobody could see and the app looked frozen until a
    // click moved focus back.
    assert!(
        code_of("builder.rs").contains(".focused(false)"),
        "link views must be built with .focused(false)"
    );
}

#[test]
fn hiding_a_link_view_hands_focus_back_to_the_app() {
    // Hiding only hides the window (wry's set_visible); it does not move
    // focus. If the page had focus, keystrokes kept going to the hidden page.
    let code = code_of("mod.rs");
    let start = code.find("fn apply_visible(").expect("apply_visible");
    let body = &code[start..];
    let body = &body[..body.find("\n}").expect("end of apply_visible")];
    assert!(
        body.contains("focus::reclaim_after_hide("),
        "apply_visible must hand focus back after a hide"
    );
}

#[test]
fn focus_is_reclaimed_only_on_hide_while_the_app_is_in_front() {
    use super::focus::should_reclaim;
    assert!(should_reclaim(false, true));
    // Showing a page leaves focus where the user put it.
    assert!(!should_reclaim(true, true));
    // Another app is in front: taking focus would pull the user out of it.
    assert!(!should_reclaim(false, false));
}
