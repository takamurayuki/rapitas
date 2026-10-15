/**
 * known-chains.fixture
 *
 * Version-controlled golden failure chains used to check the estimator
 * (there is no post-mortem model in the schema). Each chain lists raw log
 * lines in order and the expected parent index of each line.
 */

/** One golden line. `parent` is the index of the expected parent, or null for a root. */
export interface KnownChainEvent {
  text: string;
  /** Seconds after the chain start. */
  offsetSec: number;
  parent: number | null;
}

/** A known failure chain. */
export interface KnownChain {
  id: string;
  label: string;
  /** Keywords searched in DecisionLog text for post-mortem cross-checking. */
  keywords: string[];
  events: KnownChainEvent[];
}

export const KNOWN_CHAINS: readonly KnownChain[] = [
  {
    id: 'branch_conflict_push_rejected_retry_stopped',
    label: 'ブランチ競合 → push 拒否 → 再試行停止',
    keywords: ['競合', 'conflict', 'push rejected', 'non-fast-forward'],
    events: [
      {
        text: 'ERROR merge conflict in feature/t100-sample while rebasing',
        offsetSec: 0,
        parent: null,
      },
      {
        text: 'ERROR git push rejected for feature/t100-sample (non-fast-forward)',
        offsetSec: 20,
        parent: 0,
      },
      { text: 'WARN retry limit reached after 3 attempts, giving up', offsetSec: 60, parent: 1 },
    ],
  },
  {
    id: 'ci_failed_repair_exhausted',
    label: 'CI 失敗 → 修復上限到達',
    keywords: ['ci repair', 'ci failed', '修復'],
    events: [
      { text: 'ERROR CI checks failed for task 200', offsetSec: 0, parent: null },
      { text: 'WARN ci repair limit exhausted for task 200', offsetSec: 90, parent: 0 },
    ],
  },
];
