//! link_webview::visibility
//!
//! Orders show/hide commands for the docked webviews. The frontend decides
//! visibility in one place (`applyVisibility`) and stamps every decision with
//! a sequence number that grows across all tabs; this table drops any command
//! older than the last one applied to the same webview.
//!
//! Why: tauri async commands run on separate threads and can arrive out of
//! order, and a completion arriving late cannot un-show a surface the OS has
//! already shown. Comparing the sequence number under one lock — the same
//! lock held while a webview is created and immediately hidden — makes the
//! LAST decision always win.

use std::collections::HashMap;

/// The last sequence number applied per webview label.
///
/// Entries are never removed, closing a webview included: the sequence is
/// global and monotonic, so a stale entry is harmless, and keeping it is what
/// stops an old command that arrives after a re-creation from applying.
#[derive(Default)]
pub struct SequenceTable {
    last: HashMap<String, u64>,
}

impl SequenceTable {
    /// Record `seq` for `label` and say whether the command should be applied.
    ///
    /// # Arguments
    /// * `label` - The webview label / 対象の webview ラベル
    /// * `seq` - The command's sequence number / 命令の連番
    ///
    /// Returns true when `seq` is newer than anything applied before. / 新しければ true
    pub fn admit(&mut self, label: &str, seq: u64) -> bool {
        match self.last.get(label) {
            Some(&applied) if seq <= applied => false,
            _ => {
                self.last.insert(label.to_string(), seq);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_newer_command_applies_and_an_older_one_arriving_later_does_not() {
        let mut t = SequenceTable::default();
        assert!(t.admit("link-view-a", 7));
        assert!(!t.admit("link-view-a", 6), "older seq must not be applied");
        assert!(
            !t.admit("link-view-a", 7),
            "the same seq must not apply twice"
        );
        assert!(t.admit("link-view-a", 8));
    }

    #[test]
    fn a_command_recorded_before_creation_still_outranks_a_late_older_one() {
        // A seq for a label with no webview yet is recorded (without showing
        // anything); an older command delayed past the creation is dropped.
        let mut t = SequenceTable::default();
        assert!(t.admit("link-view-new", 12));
        assert!(!t.admit("link-view-new", 11));
    }

    #[test]
    fn labels_are_ordered_independently_on_one_global_sequence() {
        let mut t = SequenceTable::default();
        assert!(t.admit("link-view-a", 10));
        assert!(t.admit("link-view-b", 3));
        assert!(!t.admit("link-view-a", 9));
    }
}
