//! link_webview::policy
//!
//! Which URLs the in-app browser refuses to load: anything that is not
//! http(s), and the app's own and the backend's origins in all their loopback
//! spellings. Applied at the entry (`open_link_webview`), on every main-frame
//! navigation, and to `window.open` targets.
//!
//! Pure std on purpose: it is unit-tested without the tauri runtime, and the
//! frontend mirrors it in `utils/browser-url-policy.ts`.
//!
//! NOTE: this blocks DOCUMENT navigations only. A page's fetch/XHR, forms and
//! sub-resources are not seen here; the backend's Origin check
//! (`createCrossSiteGuard`) is what protects it from those (nav60 §5.1-4).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// The Next dev server (`devUrl`) and the origins the backend trusts as the
/// app (`http://localhost:3000`, `http://127.0.0.1:3000` in `CORS_ORIGIN`).
pub const APP_PORT: u16 = 3000;
/// The backend API (`PORT=3001` in release.rs, `API_BASE_URL` in the frontend).
pub const BACKEND_PORT: u16 = 3001;
/// Ports that make a loopback address "the app or the backend".
pub const RESERVED_LOOPBACK_PORTS: [u16; 2] = [APP_PORT, BACKEND_PORT];

/// Why a URL was refused; the frontend shows a band for either.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// Not http(s): `javascript:`, `file:`, `data:`, `tauri:` …
    Scheme,
    /// The app's own origin, the backend, or an origin the backend trusts.
    AppOrigin,
}

/// The parts of a parsed URL the policy needs.
///
/// Taken pre-parsed (from `tauri::Url`, i.e. the WHATWG parser) so that
/// spellings like `http://127.1:3001` or `http://0x7f.1:3001` have already
/// been normalised to `127.0.0.1` before they reach these rules.
pub struct UrlParts<'a> {
    /// Scheme without the colon, lower-case (`http`).
    pub scheme: &'a str,
    /// Host as the URL parser prints it (`[::1]` keeps its brackets).
    pub host: &'a str,
    /// The explicit port, or None when the scheme default applies.
    pub port: Option<u16>,
}

/// Whether a host is a loopback alias: `localhost`, `*.localhost`,
/// 127.0.0.0/8, `::1`, an IPv4-mapped loopback, or the unspecified address.
///
/// `0.0.0.0` / `::` are included because connecting to them reaches the
/// local machine on every desktop OS.
pub fn is_loopback_alias(host: &str) -> bool {
    let h = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    let h = h.trim_end_matches('.');
    if h == "localhost" || h.ends_with(".localhost") {
        return true;
    }
    match h.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => v4.is_loopback() || v4 == Ipv4Addr::UNSPECIFIED,
        Ok(IpAddr::V6(v6)) => {
            v6.is_loopback()
                || v6 == Ipv6Addr::UNSPECIFIED
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|v4| v4.is_loopback() || v4 == Ipv4Addr::UNSPECIFIED)
        }
        Err(_) => false,
    }
}

/// Whether the in-app browser must refuse to load this URL as a document.
///
/// # Arguments
/// * `url` - The parsed target / 判定する URL
///
/// # Errors
/// Returns the `Refusal` reason when the URL may not be shown. / 拒否する理由
pub fn check(url: &UrlParts<'_>) -> Result<(), Refusal> {
    let scheme = url.scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(Refusal::Scheme);
    }
    let host = url.host.to_ascii_lowercase();
    // The production app document (http(s)://tauri.localhost on Windows).
    if host == "tauri.localhost" || host.ends_with(".tauri.localhost") {
        return Err(Refusal::AppOrigin);
    }
    let port = url.port.unwrap_or(if scheme == "https" { 443 } else { 80 });
    if is_loopback_alias(&host) && RESERVED_LOOPBACK_PORTS.contains(&port) {
        return Err(Refusal::AppOrigin);
    }
    Ok(())
}

/// Whether a main-frame navigation may proceed.
///
/// `about:blank` / `about:srcdoc` carry no privileges and pages step through
/// them, so they pass; everything else follows [`check`].
///
/// # Errors
/// Returns the `Refusal` reason for a navigation that must be stopped.
pub fn check_navigation(url: &UrlParts<'_>) -> Result<(), Refusal> {
    if url.scheme.eq_ignore_ascii_case("about") {
        return Ok(());
    }
    check(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts<'a>(scheme: &'a str, host: &'a str, port: Option<u16>) -> UrlParts<'a> {
        UrlParts { scheme, host, port }
    }

    #[test]
    fn refuses_non_web_schemes() {
        for scheme in ["javascript", "file", "data", "tauri", "blob", "ftp"] {
            assert_eq!(
                check(&parts(scheme, "x", None)),
                Err(Refusal::Scheme),
                "{scheme}"
            );
        }
    }

    #[test]
    fn refuses_the_app_and_backend_in_every_loopback_spelling() {
        for (host, port) in [
            ("localhost", 3000),
            ("localhost", 3001),
            ("127.0.0.1", 3000),
            ("127.0.0.1", 3001),
            ("127.0.0.2", 3001),
            ("127.255.255.254", 3000),
            ("[::1]", 3001),
            ("[::ffff:7f00:1]", 3001),
            ("0.0.0.0", 3001),
            ("[::]", 3000),
            ("app.localhost", 3000),
            ("LOCALHOST.", 3001),
        ] {
            assert_eq!(
                check(&parts("http", host, Some(port))),
                Err(Refusal::AppOrigin),
                "{host}:{port}"
            );
        }
    }

    #[test]
    fn refuses_the_packaged_app_document() {
        for scheme in ["http", "https"] {
            assert_eq!(
                check(&parts(scheme, "tauri.localhost", None)),
                Err(Refusal::AppOrigin)
            );
        }
    }

    #[test]
    fn keeps_other_local_dev_servers_open() {
        // Q8: a user's own project on another loopback port stays reachable.
        for (host, port) in [
            ("localhost", Some(5173)),
            ("127.0.0.1", Some(8080)),
            ("localhost", None),
            ("[::1]", Some(4000)),
        ] {
            assert_eq!(check(&parts("http", host, port)), Ok(()), "{host}:{port:?}");
        }
    }

    #[test]
    fn keeps_public_sites_open_on_any_port() {
        for (host, port) in [
            ("github.com", None),
            ("example.com", Some(3000)),
            ("192.168.1.10", Some(3001)),
        ] {
            assert_eq!(check(&parts("https", host, port)), Ok(()), "{host}");
        }
    }

    #[test]
    fn navigation_lets_about_blank_through_but_not_the_app() {
        assert_eq!(check_navigation(&parts("about", "", None)), Ok(()));
        assert_eq!(
            check_navigation(&parts("http", "127.0.0.1", Some(3000))),
            Err(Refusal::AppOrigin)
        );
        assert_eq!(
            check_navigation(&parts("file", "", None)),
            Err(Refusal::Scheme)
        );
    }

    #[test]
    fn recognises_loopback_aliases() {
        for h in [
            "localhost",
            "a.b.localhost",
            "127.0.0.1",
            "[::1]",
            "0.0.0.0",
        ] {
            assert!(is_loopback_alias(h), "{h}");
        }
        for h in [
            "example.com",
            "10.0.0.1",
            "[2001:db8::1]",
            "localhost.example.com",
        ] {
            assert!(!is_loopback_alias(h), "{h}");
        }
    }
}
