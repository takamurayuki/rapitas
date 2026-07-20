/**
 * SimpleLogEntry / SimpleLogEntryList — beacon visibility tests
 *
 * The pulsing "progress" beacon exists to explain why nothing is showing
 * right now (e.g. "思考中…"); it must appear ONLY on the last rendered entry,
 * never on an older progress entry buried in history — otherwise stale
 * history reads as still-active work.
 */
import { describe, test, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SimpleLogEntry, SimpleLogEntryList } from '../simple-log-entry';
import type { UserFriendlyLogEntry } from '../../../utils/log-pattern-rules';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/markdown/MarkdownView', () => ({
  MarkdownView: () => null,
}));

const PROGRESS_ENTRY: UserFriendlyLogEntry = {
  category: 'progress',
  message: '思考中…',
  iconName: 'Loader',
};

const INFO_ENTRY: UserFriendlyLogEntry = {
  category: 'info',
  message: 'ファイルを編集しました',
  iconName: 'FileEdit',
};

function beaconCount(container: HTMLElement): number {
  return container.querySelectorAll('.animate-pulse').length;
}

describe('SimpleLogEntry — beacon gating', () => {
  test('shows the beacon when a progress entry IS the last entry', () => {
    const { container } = render(<SimpleLogEntry entry={PROGRESS_ENTRY} index={0} isLastEntry />);
    expect(beaconCount(container)).toBe(1);
  });

  test('hides the beacon when a progress entry is NOT the last entry', () => {
    const { container } = render(
      <SimpleLogEntry entry={PROGRESS_ENTRY} index={0} isLastEntry={false} />,
    );
    expect(beaconCount(container)).toBe(0);
  });

  test('defaults to no beacon when isLastEntry is omitted', () => {
    const { container } = render(<SimpleLogEntry entry={PROGRESS_ENTRY} index={0} />);
    expect(beaconCount(container)).toBe(0);
  });

  test('never shows a beacon for a non-progress entry, even when last', () => {
    const { container } = render(<SimpleLogEntry entry={INFO_ENTRY} index={0} isLastEntry />);
    expect(beaconCount(container)).toBe(0);
  });
});

describe('SimpleLogEntryList — only the last entry can beacon', () => {
  test('a trailing progress entry beacons; an earlier one does not', () => {
    const { container } = render(
      <SimpleLogEntryList entries={[PROGRESS_ENTRY, INFO_ENTRY, PROGRESS_ENTRY]} />,
    );
    // Only the LAST entry (index 2, also 'progress') should beacon — the
    // first PROGRESS_ENTRY at index 0 is stale history once index 1/2 exist.
    expect(beaconCount(container)).toBe(1);
  });

  test('no beacon at all when the last entry is not a progress entry', () => {
    const { container } = render(<SimpleLogEntryList entries={[PROGRESS_ENTRY, INFO_ENTRY]} />);
    expect(beaconCount(container)).toBe(0);
  });
});
