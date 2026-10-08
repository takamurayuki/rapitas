//! dev_server_wait
//!
//! Debug-only recovery for the main window being navigated to the dev server
//! before that server exists. Owns only the retry: it never starts, stops or
//! supervises the dev server (that is rapitas-desktop/scripts/dev.js).
//!
//! Why it exists. `dev.js` spawns `pnpm run dev` and returns straight away —
//! the backend gets `waitForBackendReady`, the frontend gets no equivalent — so
//! the window is created and navigated while Next.js is still coming up.
//! Measured on the 2026-10-07 01:38 restart, from process start times:
//!
//!     01:38:26  bun          (backend)
//!     01:38:37  msedgewebview2   <- window created and navigated
//!     01:38:38  node         (Next dev server tree)
//!
//! The webview therefore reached `http://localhost:3000` about a second before
//! the dev server process even existed, got ERR_CONNECTION_REFUSED, and showed
//! Chromium's own "can't be reached" page — which never retries on its own.
//! Next's first compile peaks around 5 GB and runs for minutes (see dev.js's
//! watchdog notes), so the window can sit on that error page for a long time.
//!
//! A TCP connect is the right readiness signal, not an HTTP request: once the
//! port is bound, a navigation during the first compile simply waits for it
//! rather than failing, which is the behaviour we want.

use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// Where the dev server listens; matches `devUrl` in tauri.conf.json.
const DEV_SERVER_ADDR: &str = "127.0.0.1:3000";
const DEV_SERVER_URL: &str = "http://localhost:3000";
/// Per-probe connect timeout. Short — the target is loopback.
const PROBE_TIMEOUT: Duration = Duration::from_millis(300);
/// Gap between probes while waiting.
const PROBE_INTERVAL: Duration = Duration::from_millis(500);
/// Give up after this long rather than retry forever on a genuinely dead setup.
const MAX_WAIT: Duration = Duration::from_secs(300);

/// Whether something is accepting connections at `addr`.
///
/// A bound port is enough: Next.js binds before it finishes compiling, and a
/// navigation that lands mid-compile waits instead of erroring.
///
/// @param addr - Address to probe. / 接続先
/// @param timeout - Per-attempt connect timeout. / 1回あたりの接続タイムアウト
/// @returns true when the port accepted a connection. / 接続できたか
pub fn is_listening(addr: SocketAddr, timeout: Duration) -> bool {
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

/// Reload the main window once the dev server starts answering, but only when
/// it was NOT answering at startup.
///
/// Doing nothing in the healthy case is the point: a window that loaded fine
/// must never be reloaded out from under the user.
///
/// @param app - Handle used to find the main window. / メインウィンドウ取得用ハンドル
#[cfg(debug_assertions)]
pub fn reload_main_window_when_dev_server_ready(app: &tauri::AppHandle) {
    let Ok(addr) = DEV_SERVER_ADDR.parse::<SocketAddr>() else {
        return;
    };
    if is_listening(addr, PROBE_TIMEOUT) {
        // The window's own navigation will have succeeded; leave it alone.
        return;
    }
    println!("[DevServer] {DEV_SERVER_ADDR} not up yet — will reload the window once it is");

    let app = app.clone();
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        while started.elapsed() < MAX_WAIT {
            std::thread::sleep(PROBE_INTERVAL);
            if !is_listening(addr, PROBE_TIMEOUT) {
                continue;
            }
            // Re-navigate rather than eval a reload: the window is sitting on
            // Chromium's error page, which is not our document and may not run
            // injected script.
            match tauri::Manager::get_webview_window(&app, "main") {
                Some(window) => {
                    let waited = started.elapsed().as_secs_f32();
                    match DEV_SERVER_URL.parse() {
                        Ok(url) => {
                            let _ = window.navigate(url);
                            println!("[DevServer] ready after {waited:.1}s — reloaded the window");
                        }
                        Err(e) => eprintln!("[DevServer] dev URL is not parseable: {e}"),
                    }
                }
                None => eprintln!("[DevServer] ready, but the main window is gone"),
            }
            return;
        }
        eprintln!(
            "[DevServer] {DEV_SERVER_ADDR} never came up within {}s — leaving the window as it is",
            MAX_WAIT.as_secs()
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn reports_a_bound_port_as_listening() {
        // Port 0 lets the OS pick a free one, so the test cannot collide with
        // a real dev server on 3000.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        assert!(is_listening(addr, Duration::from_millis(500)));
    }

    #[test]
    fn reports_a_closed_port_as_not_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        drop(listener);
        assert!(!is_listening(addr, Duration::from_millis(500)));
    }

    #[test]
    fn the_configured_address_parses() {
        // A typo here would silently disable the whole retry.
        assert!(DEV_SERVER_ADDR.parse::<SocketAddr>().is_ok());
    }
}
