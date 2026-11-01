//! csp
//!
//! The app's Content-Security-Policy is data in tauri.conf.json, so nothing in
//! the Rust build would notice it drifting away from the origins the pages
//! actually fetch. This is that check.
//!
//! It bites in packaged builds and only there, which is why it can rot
//! unnoticed: the dev page is served by Next.js and carries Next's own
//! headers, while a bundled page is served by Tauri from `tauri.localhost`
//! with this policy attached. A `connect-src` that does not admit the backend
//! blocks every API call and every SSE stream in the shipped app — and passes
//! all of CI, which builds the bundle but never loads it.
//!
//! So the origin is not restated here. It is read from
//! `rapitas-desktop/scripts/build-all.js`, which bakes
//! NEXT_PUBLIC_API_BASE_URL into the bundle: that literal IS what the shipped
//! page fetches, and `release.rs` starts the sidecar on its port. Change
//! either side and this goes red.

/// Every Tauri config that declares a policy of its own.
///
/// `tauri.build.conf.json` and `tauri.watch.conf.json` are absent on purpose:
/// they are merged OVER this base and define no `app.security`, so the base
/// policy is what a packaged build ships.
const CONFIGS: [(&str, &str); 2] = [
    ("tauri.conf.json", include_str!("../tauri.conf.json")),
    ("tauri.ci.conf.json", include_str!("../tauri.ci.conf.json")),
];

const BUILD_ALL_JS: &str = include_str!("../../scripts/build-all.js");

/// The API origin `build-all.js` bakes into the bundle.
///
/// @returns Scheme, host and port the shipped page fetches. / 配布版が叩くオリジン
fn baked_api_origin() -> String {
    let key = "NEXT_PUBLIC_API_BASE_URL: '";
    let at = BUILD_ALL_JS
        .find(key)
        .expect("build-all.js bakes NEXT_PUBLIC_API_BASE_URL");
    let rest = &BUILD_ALL_JS[at + key.len()..];
    let url = &rest[..rest.find('\'').expect("the literal is closed")];
    url.trim_end_matches('/').to_string()
}

/// The `connect-src` tokens of one config's policy.
///
/// @param config - Raw tauri.conf.json text. / 設定ファイルの内容
/// @returns The directive's source list. / connect-src のソース一覧
fn connect_src(config: &str) -> Vec<String> {
    let parsed: serde_json::Value = serde_json::from_str(config).expect("config parses");
    let csp = parsed["app"]["security"]["csp"]
        .as_str()
        .expect("app.security.csp is a string");
    csp.split(';')
        .map(str::trim)
        .find_map(|d| d.strip_prefix("connect-src "))
        .expect("the policy has a connect-src")
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

/// Whether one `connect-src` token admits `origin`.
///
/// Only the two forms this policy uses are understood — an exact origin and a
/// host with a wildcard port. Anything else is treated as not matching, so an
/// unrecognised token can never make this check pass by accident.
///
/// @param token - One source from the directive. / ソース1件
/// @param origin - Scheme, host and port to reach. / 到達したいオリジン
/// @returns Whether the token allows it. / 許可されるか
fn token_admits(token: &str, origin: &str) -> bool {
    if token == origin {
        return true;
    }
    match token.strip_suffix(":*") {
        Some(host) => origin
            .strip_prefix(host)
            .is_some_and(|p| p.starts_with(':')),
        None => false,
    }
}

fn admits(config: &str, origin: &str) -> bool {
    connect_src(config).iter().any(|t| token_admits(t, origin))
}

#[test]
fn every_policy_admits_the_api_origin_the_bundle_is_built_with() {
    let origin = baked_api_origin();
    for (name, config) in CONFIGS {
        assert!(
            admits(config, &origin),
            "{name}'s connect-src does not admit {origin}, which is the origin \
             build-all.js bakes into the bundle — every API call and SSE stream \
             in a packaged build would be blocked. Tokens: {:?}",
            connect_src(config)
        );
    }
}

#[test]
fn the_two_policies_stay_identical() {
    // A second copy of a policy is the same hazard as a second copy of a URL
    // (#1278): the one nobody is looking at is the one that drifts.
    let [(_, base), (ci_name, ci)] = CONFIGS;
    assert_eq!(
        connect_src(base),
        connect_src(ci),
        "{ci_name} has drifted from the base policy"
    );
}

#[test]
fn the_check_can_fail() {
    // Without this, a matcher that said yes to everything would look like a
    // passing gate. See docs/lessons/gates-that-do-not-measure.md.
    assert!(token_admits("http://127.0.0.1:*", "http://127.0.0.1:3001"));
    assert!(token_admits(
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3001"
    ));
    assert!(!token_admits("http://localhost:*", "http://127.0.0.1:3001"));
    assert!(!token_admits("'self'", "http://127.0.0.1:3001"));
    assert!(!token_admits("https:", "http://127.0.0.1:3001"));
    // A wildcard port must not swallow a longer host.
    assert!(!token_admits(
        "http://127.0.0.1:*",
        "http://127.0.0.1.evil:80"
    ));
}

#[test]
fn the_inputs_were_actually_read() {
    // Every assertion above is vacuous if the extraction silently found
    // nothing, so measure the measurement.
    let origin = baked_api_origin();
    assert!(origin.starts_with("http://"), "{origin}");
    assert!(origin.matches(':').count() == 2, "needs a port: {origin}");
    for (name, config) in CONFIGS {
        assert!(connect_src(config).len() > 3, "{name}");
    }
}
