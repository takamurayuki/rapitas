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
//!
//! A frontend recycled UNDER a live window needs the same recovery. dev.js's
//! `restartFrontend` does that whenever a backend restart finds HEAD has moved
//! (`frontendNextCacheIsStale`, i.e. after a `git pull`), and the window then
//! outlives the server it was pointed at. Until 2026-10-19 this module was
//! armed only from `setup` and returned early when :3000 was already up, so it
//! covered a cold launch and nothing else; the note here said one manual
//! reload clears it, and left it alone.
//!
//! That held while a pull meant someone was at the keyboard. It stopped
//! holding once the loop pulls and restarts unattended (`restartOnAutoRunDry`
//! plus the automated primary sync): on 2026-10-19 a window sat dead for about
//! forty minutes with nobody to reload it, and the first anyone knew of it was
//! a bug report. So this is now the standing watcher that note described — it
//! re-navigates on each confirmed :3000 down→up transition, and does nothing
//! at all while the server stays up. See docs/RUNBOOK.md §12.

use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// Where the dev server listens; matches `devUrl` in tauri.conf.json.
const DEV_SERVER_ADDR: &str = "127.0.0.1:3000";
const DEV_SERVER_URL: &str = "http://localhost:3000";
/// Per-probe connect timeout. Short — the target is loopback.
const PROBE_TIMEOUT: Duration = Duration::from_millis(300);
/// Gap between probes while waiting.
const PROBE_INTERVAL: Duration = Duration::from_millis(500);
/// Say so once if the dev server stays away this long. The watch keeps
/// running: the setup can be dead now and alive in a minute, which is the
/// whole point of watching rather than waiting.
const SILENCE_BEFORE_COMPLAINING: Duration = Duration::from_secs(300);

/// Consecutive refused probes before the dev server counts as gone.
///
/// One refused connect under load is not the server going away, and acting
/// on one would reload a window that was working.
const DOWN_PROBES_TO_CONFIRM: u8 = 3;

/// Whether :3000 is up, across probes, and when that means reloading.
///
/// Split out from the polling loop because the decision is the part worth
/// testing: reload on a confirmed down→up transition, never otherwise.
pub struct DevServerWatch {
    up: bool,
    consecutive_down: u8,
}

impl DevServerWatch {
    /// Start watching from whatever the port is doing right now.
    ///
    /// @param initially_listening - Whether :3000 answers at this moment. / 現在の状態
    /// @returns A watch primed with that state. / その状態で初期化した監視
    pub fn new(initially_listening: bool) -> Self {
        Self {
            up: initially_listening,
            consecutive_down: 0,
        }
    }

    /// Record one probe and say whether the window should be re-navigated.
    ///
    /// @param listening - What the probe found. / 今回の観測結果
    /// @returns true on a confirmed down→up transition. / 復帰したなら true
    pub fn observe(&mut self, listening: bool) -> bool {
        if listening {
            self.consecutive_down = 0;
            if self.up {
                return false;
            }
            self.up = true;
            return true;
        }
        if self.up {
            self.consecutive_down = self.consecutive_down.saturating_add(1);
            if self.consecutive_down >= DOWN_PROBES_TO_CONFIRM {
                self.up = false;
            }
        }
        false
    }
}

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

/// Watch the dev server for the app's lifetime and re-navigate the main
/// window whenever it comes back from being down.
///
/// Doing nothing in the healthy case is the point: a window that loaded fine
/// must never be reloaded out from under the user. Only a confirmed down→up
/// transition navigates, so while everything works this costs one loopback
/// connect per probe interval and nothing else.
///
/// @param app - Handle used to find the main window. / メインウィンドウ取得用ハンドル
#[cfg(debug_assertions)]
pub fn watch_dev_server_and_reload(app: &tauri::AppHandle) {
    let Ok(addr) = DEV_SERVER_ADDR.parse::<SocketAddr>() else {
        return;
    };
    let initially_listening = is_listening(addr, PROBE_TIMEOUT);
    if !initially_listening {
        println!("[DevServer] {DEV_SERVER_ADDR} not up yet — will reload the window once it is");
    }

    let app = app.clone();
    std::thread::spawn(move || {
        let mut watch = DevServerWatch::new(initially_listening);
        let mut down_since: Option<std::time::Instant> = None;
        let mut complained = false;
        loop {
            std::thread::sleep(PROBE_INTERVAL);
            let listening = is_listening(addr, PROBE_TIMEOUT);

            if listening {
                down_since = None;
                complained = false;
            } else {
                let since = *down_since.get_or_insert_with(std::time::Instant::now);
                if !complained && since.elapsed() >= SILENCE_BEFORE_COMPLAINING {
                    complained = true;
                    eprintln!(
                        "[DevServer] {DEV_SERVER_ADDR} has been down for {}s — still watching",
                        since.elapsed().as_secs()
                    );
                }
            }

            if !watch.observe(listening) {
                continue;
            }

            // Re-navigate rather than eval a reload: the window may be sitting
            // on Chromium's error page, which is not our document and may not
            // run injected script.
            // `get_webview`, not `get_webview_window`: `navigate` is a webview
            // method, and the WebviewWindow pairing stops resolving once the
            // link pane docks a child webview into "main" (#1070).
            match tauri::Manager::get_webview(&app, "main") {
                Some(window) => match DEV_SERVER_URL.parse() {
                    Ok(url) => {
                        let _ = window.navigate(url);
                        println!("[DevServer] back up — reloaded the window");
                    }
                    Err(e) => eprintln!("[DevServer] dev URL is not parseable: {e}"),
                },
                None => {
                    eprintln!("[DevServer] back up, but the main window is gone");
                    return;
                }
            }
        }
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

    /// Feed a sequence of probe results and collect the reload decisions.
    fn run(initially_listening: bool, probes: &[bool]) -> Vec<bool> {
        let mut watch = DevServerWatch::new(initially_listening);
        probes.iter().map(|p| watch.observe(*p)).collect()
    }

    #[test]
    fn never_reloads_a_window_that_is_working() {
        // The original rule, kept: a window that loaded fine must not be
        // reloaded out from under the user.
        assert_eq!(run(true, &[true; 10]), vec![false; 10]);
    }

    #[test]
    fn reloads_once_when_a_cold_start_finally_comes_up() {
        // The case this module was written for: the window navigated before
        // Next.js existed and is sitting on Chromium's error page.
        assert_eq!(
            run(false, &[false, false, true, true, true]),
            vec![false, false, true, false, false]
        );
    }

    // The reported defect (2026-10-19): dev.js recycled the frontend under a
    // live window after a pull moved HEAD, and nothing brought the window
    // back. It had sat on a loading state for ~40 minutes.
    #[test]
    fn reloads_when_the_frontend_is_recycled_under_a_live_window() {
        let down = [false; DOWN_PROBES_TO_CONFIRM as usize];
        let mut probes = vec![true, true];
        probes.extend_from_slice(&down);
        probes.push(true);
        let decisions = run(true, &probes);
        assert_eq!(decisions.last(), Some(&true), "{decisions:?}");
        assert_eq!(
            decisions[..decisions.len() - 1]
                .iter()
                .filter(|d| **d)
                .count(),
            0
        );
    }

    #[test]
    fn survives_a_second_recycle() {
        let mut probes: Vec<bool> = Vec::new();
        for _ in 0..2 {
            probes.extend(std::iter::repeat_n(false, DOWN_PROBES_TO_CONFIRM as usize));
            probes.push(true);
            probes.push(true);
        }
        assert_eq!(run(true, &probes).iter().filter(|d| **d).count(), 2);
    }

    // A single refused connect under load is not the server going away, and
    // acting on one would reload a perfectly good window.
    #[test]
    fn ignores_probe_flicker_below_the_confirmation_threshold() {
        let mut probes = vec![true];
        probes.extend(std::iter::repeat_n(
            false,
            DOWN_PROBES_TO_CONFIRM as usize - 1,
        ));
        probes.push(true);
        assert_eq!(run(true, &probes), vec![false; probes.len()]);
    }

    #[test]
    fn needs_more_than_one_probe_to_call_it_down() {
        const { assert!(DOWN_PROBES_TO_CONFIRM > 1) };
    }

    #[test]
    fn the_configured_address_parses() {
        // A typo here would silently disable the whole retry.
        assert!(DEV_SERVER_ADDR.parse::<SocketAddr>().is_ok());
    }
}
