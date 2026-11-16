//! link_webview::burst
//!
//! Caps how many new-tab requests (`target=_blank`, `window.open`) one tab
//! may make in a sliding window, so a page calling `window.open` in a loop
//! cannot flood the tab strip. Pure std, clock injected for tests.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Requests allowed per tab within [`BURST_WINDOW`].
pub const BURST_MAX: usize = 5;
/// The sliding window for [`BURST_MAX`].
pub const BURST_WINDOW: Duration = Duration::from_secs(10);

/// A sliding-window counter of accepted requests.
pub struct BurstLimiter {
    max: usize,
    window: Duration,
    accepted: VecDeque<Instant>,
}

impl Default for BurstLimiter {
    fn default() -> Self {
        Self::new(BURST_MAX, BURST_WINDOW)
    }
}

impl BurstLimiter {
    /// A limiter allowing `max` requests per `window`.
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            accepted: VecDeque::new(),
        }
    }

    /// Whether a request at `now` is within the limit; records it if so.
    ///
    /// # Arguments
    /// * `now` - When the request arrived / 要求の時刻
    ///
    /// Returns false for a request over the limit, which is dropped. / 上限超過なら false
    pub fn try_accept(&mut self, now: Instant) -> bool {
        while let Some(&oldest) = self.accepted.front() {
            if now.duration_since(oldest) >= self.window {
                self.accepted.pop_front();
            } else {
                break;
            }
        }
        if self.accepted.len() >= self.max {
            return false;
        }
        self.accepted.push_back(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_five_in_ten_seconds_and_drops_the_sixth() {
        let mut l = BurstLimiter::default();
        let t0 = Instant::now();
        for i in 0..5 {
            assert!(l.try_accept(t0 + Duration::from_millis(i * 100)), "#{i}");
        }
        assert!(!l.try_accept(t0 + Duration::from_secs(1)));
    }

    #[test]
    fn frees_a_slot_once_the_oldest_leaves_the_window() {
        let mut l = BurstLimiter::default();
        let t0 = Instant::now();
        for _ in 0..5 {
            assert!(l.try_accept(t0));
        }
        assert!(!l.try_accept(t0 + Duration::from_millis(9_999)));
        assert!(l.try_accept(t0 + Duration::from_secs(10)));
    }
}
