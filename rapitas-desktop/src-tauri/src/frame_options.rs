//! frame_options
//!
//! The `X-Frame-Options: DENY` the bundled app's responses carry, and the
//! config facts that make it reach them. Tauri-free so its tests run on a
//! machine that cannot build the app; `main_window` installs it.
//!
//! NOTE: the CSP's `frame-ancestors 'none'` (tauri.conf.json) is what the
//! engines actually enforce — it takes precedence over X-Frame-Options where
//! both are present. The header is the fallback for an engine that does not
//! implement frame-ancestors (nav60 §3.3 asks for both).

use tauri::http::{header::X_FRAME_OPTIONS, HeaderMap, HeaderValue};

/// Label of the main window, as declared in tauri.conf.json.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Forbid framing the response in any document.
///
/// Applied to every app response, not only HTML: the header has no effect on
/// a non-document, and deciding "is this a document" here would be one more
/// thing to get wrong.
///
/// # Arguments
/// * `headers` - The response headers to update / 更新する応答ヘッダー
pub fn deny_framing(headers: &mut HeaderMap) {
    headers.insert(X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deny_framing_sets_deny_and_replaces_a_weaker_value() {
        let mut headers = HeaderMap::new();
        deny_framing(&mut headers);
        assert_eq!(headers.get(X_FRAME_OPTIONS).unwrap(), "DENY");

        headers.insert(X_FRAME_OPTIONS, HeaderValue::from_static("SAMEORIGIN"));
        deny_framing(&mut headers);
        assert_eq!(headers.get_all(X_FRAME_OPTIONS).iter().count(), 1);
        assert_eq!(headers.get(X_FRAME_OPTIONS).unwrap(), "DENY");
    }

    /// The shipped config, read from the file rather than restated.
    fn conf() -> serde_json::Value {
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json parses")
    }

    #[test]
    fn the_main_window_is_left_to_build_and_still_declared() {
        // Declared and auto-created, the window would never get the
        // resource hook; missing, `build` would have nothing to build from.
        let windows = conf()["app"]["windows"].as_array().cloned().unwrap();
        let main: Vec<_> = windows
            .iter()
            .filter(|w| w["label"] == MAIN_WINDOW_LABEL)
            .collect();
        assert_eq!(main.len(), 1, "exactly one main window entry");
        assert_eq!(main[0]["create"], false, "main must be built in setup");
    }

    #[test]
    fn the_csp_still_refuses_every_frame_ancestor() {
        let csp = conf()["app"]["security"]["csp"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(csp.contains("frame-ancestors 'none'"), "{csp}");
    }
}
