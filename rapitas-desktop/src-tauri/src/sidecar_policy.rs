//! sidecar_policy
//!
//! Decisions for supervising the backend sidecar (ADR-0010 phase 1): what to
//! do when it exits, and how to read its readiness from `/health`. Pure —
//! `release.rs` owns the process and acts on these answers.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Exit code the backend uses to ask for a restart (dev.js / restart-supervisor.ts contract).
pub const RESTART_EXIT_CODE: i32 = 75;
/// Unrequested exits counted towards giving up.
pub const CRASH_WINDOW: Duration = Duration::from_secs(120);
/// Unrequested exits within `CRASH_WINDOW` after which supervision gives up.
pub const MAX_CRASHES_IN_WINDOW: usize = 5;
/// Longest wait before restarting after a crash.
pub const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// What to do after the backend exited.
#[derive(Debug, PartialEq, Eq)]
pub enum ExitAction {
    /// Start it again after `delay`.
    Restart { delay: Duration },
    /// It keeps dying; stop restarting and tell the person.
    GiveUp,
    /// The app is quitting; leave it down.
    Stop,
}

/// Remembers recent unrequested exits to decide restart vs. give up.
#[derive(Default)]
pub struct RestartPolicy {
    crashes: VecDeque<Instant>,
}

impl RestartPolicy {
    /// Decide what to do about an exit.
    ///
    /// # Arguments
    /// * `code` - Exit code, `None` when killed by a signal / 終了コード（シグナル終了は None）
    /// * `shutting_down` - Whether the app is quitting / アプリ終了中か
    /// * `now` - Current time / 現在時刻
    pub fn on_exit(&mut self, code: Option<i32>, shutting_down: bool, now: Instant) -> ExitAction {
        if shutting_down {
            return ExitAction::Stop;
        }
        if code == Some(RESTART_EXIT_CODE) {
            return ExitAction::Restart {
                delay: Duration::ZERO,
            };
        }
        // NOTE: Exit 0 is treated as a crash on purpose. The backend never
        // exits 0 on its own while the app runs; before ADR-0010 a 0 exit
        // left the app with no backend and nothing on screen (2026-11-07).
        while self
            .crashes
            .front()
            .is_some_and(|t| now.duration_since(*t) > CRASH_WINDOW)
        {
            self.crashes.pop_front();
        }
        self.crashes.push_back(now);
        let count = self.crashes.len();
        if count >= MAX_CRASHES_IN_WINDOW {
            return ExitAction::GiveUp;
        }
        let delay = Duration::from_secs(1u64 << (count - 1).min(5)).min(MAX_BACKOFF);
        ExitAction::Restart { delay }
    }
}

/// The backend's readiness as reported by `GET /health`.
#[derive(Debug, PartialEq, Eq)]
pub struct Readiness {
    /// `ready: true` — warm-up finished, writes are safe.
    pub ready: bool,
    /// The warm-up step still running, for logs.
    pub warmup_stage: Option<String>,
}

/// Read readiness out of a raw HTTP response to `GET /health`.
///
/// # Arguments
/// * `response` - The full HTTP response text / HTTP 応答全体
///
/// Returns `None` for a non-200 response or an unreadable body.
pub fn parse_health_response(response: &str) -> Option<Readiness> {
    let (head, body) = response.split_once("\r\n\r\n")?;
    let status_line = head.lines().next()?;
    if status_line.split_whitespace().nth(1) != Some("200") {
        return None;
    }
    let json: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    Some(Readiness {
        ready: json.get("ready").and_then(|v| v.as_bool()).unwrap_or(false),
        warmup_stage: json
            .get("warmupStage")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(base: Instant, secs: u64) -> Instant {
        base + Duration::from_secs(secs)
    }

    #[test]
    fn a_requested_restart_is_immediate_and_not_counted_as_a_crash() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        for i in 0..10 {
            assert_eq!(
                policy.on_exit(Some(RESTART_EXIT_CODE), false, at(t0, i)),
                ExitAction::Restart {
                    delay: Duration::ZERO
                }
            );
        }
    }

    #[test]
    fn exit_zero_and_crashes_restart_with_growing_backoff() {
        // Exit 0 used to leave the app without a backend until someone noticed.
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        assert_eq!(
            policy.on_exit(Some(0), false, t0),
            ExitAction::Restart {
                delay: Duration::from_secs(1)
            }
        );
        assert_eq!(
            policy.on_exit(Some(1), false, at(t0, 5)),
            ExitAction::Restart {
                delay: Duration::from_secs(2)
            }
        );
        assert_eq!(
            policy.on_exit(None, false, at(t0, 10)),
            ExitAction::Restart {
                delay: Duration::from_secs(4)
            }
        );
    }

    #[test]
    fn gives_up_after_too_many_crashes_in_the_window() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        for i in 0..(MAX_CRASHES_IN_WINDOW as u64 - 1) {
            assert!(matches!(
                policy.on_exit(Some(1), false, at(t0, i)),
                ExitAction::Restart { .. }
            ));
        }
        assert_eq!(
            policy.on_exit(Some(1), false, at(t0, 10)),
            ExitAction::GiveUp
        );
    }

    #[test]
    fn crashes_older_than_the_window_are_forgotten() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        for i in 0..(MAX_CRASHES_IN_WINDOW as u64 - 1) {
            policy.on_exit(Some(1), false, at(t0, i));
        }
        let later = at(t0, CRASH_WINDOW.as_secs() + 10);
        assert_eq!(
            policy.on_exit(Some(1), false, later),
            ExitAction::Restart {
                delay: Duration::from_secs(1)
            }
        );
    }

    #[test]
    fn backoff_is_capped() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        let mut last = ExitAction::Stop;
        for i in 0..(MAX_CRASHES_IN_WINDOW as u64 - 1) {
            // Spread out so they never reach the give-up count inside one window.
            last = policy.on_exit(Some(1), false, at(t0, i * CRASH_WINDOW.as_secs()));
        }
        assert!(matches!(last, ExitAction::Restart { delay } if delay <= MAX_BACKOFF));
    }

    #[test]
    fn nothing_restarts_while_the_app_is_quitting() {
        let mut policy = RestartPolicy::default();
        let now = Instant::now();
        assert_eq!(
            policy.on_exit(Some(RESTART_EXIT_CODE), true, now),
            ExitAction::Stop
        );
        assert_eq!(policy.on_exit(Some(1), true, now), ExitAction::Stop);
    }

    #[test]
    fn reads_ready_and_the_warmup_stage() {
        let warming = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n\
            {\"status\":\"healthy\",\"ready\":false,\"warmupStage\":\"memory-system\"}";
        assert_eq!(
            parse_health_response(warming),
            Some(Readiness {
                ready: false,
                warmup_stage: Some("memory-system".into())
            })
        );
        let ready =
            "HTTP/1.1 200 OK\r\n\r\n{\"status\":\"healthy\",\"ready\":true,\"warmupStage\":null}";
        assert_eq!(
            parse_health_response(ready),
            Some(Readiness {
                ready: true,
                warmup_stage: None
            })
        );
    }

    #[test]
    fn a_failing_or_garbled_health_response_is_not_readiness() {
        assert_eq!(
            parse_health_response("HTTP/1.1 503 Service Unavailable\r\n\r\n{}"),
            None
        );
        assert_eq!(
            parse_health_response("HTTP/1.1 200 OK\r\n\r\nnot json"),
            None
        );
        assert_eq!(parse_health_response(""), None);
    }
}
