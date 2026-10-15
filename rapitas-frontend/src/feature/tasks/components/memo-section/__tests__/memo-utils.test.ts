/**
 * memo-utils.test.ts
 *
 * timeAgo の閾値分岐、generateMockTaskActivities の形状、analyzeMemo の
 * 重要度・感情・キーワード・アクション抽出ロジックを検証する。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { timeAgo, generateMockTaskActivities, analyzeMemo } from '../memo-utils';

/** Key-echo translator stub: returns the key (with interpolated `count`, if any). */
const t = (key: string, values?: Record<string, number | string>) =>
  values?.count !== undefined ? `${key}:${values.count}` : key;

describe('timeAgo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1分未満は now を返すこと', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    const d = new Date('2026-01-01T00:00:00Z');
    expect(timeAgo(d, t)).toBe('time.now');
  });

  it('1分以上60分未満は minutesAgo を返すこと', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:30:00Z'));
    const d = new Date('2026-01-01T00:00:00Z');
    expect(timeAgo(d, t)).toBe('time.minutesAgo:30');
  });

  it('1時間以上24時間未満は hoursAgo を返すこと', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T05:00:00Z'));
    const d = new Date('2026-01-01T00:00:00Z');
    expect(timeAgo(d, t)).toBe('time.hoursAgo:5');
  });

  it('1日以上30日未満は daysAgo を返すこと', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T00:00:00Z'));
    const d = new Date('2026-01-01T00:00:00Z');
    expect(timeAgo(d, t)).toBe('time.daysAgo:4');
  });

  it('30日以上は monthsAgo を返すこと', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'));
    const d = new Date('2026-01-01T00:00:00Z');
    expect(timeAgo(d, t)).toBe('time.monthsAgo:3');
  });
});

describe('generateMockTaskActivities', () => {
  it('taskIdに紐づく3件のアクティビティを返すこと', () => {
    const activities = generateMockTaskActivities(42, t);

    expect(activities).toHaveLength(3);
    expect(activities.map((a) => a.id)).toEqual(['42-1', '42-2', '42-3']);
  });

  it('種別ごとに正しいtypeとchangesを持つこと', () => {
    const [statusChange, priorityChange, assignment] = generateMockTaskActivities(1, t);

    expect(statusChange.type).toBe('status_change');
    expect(statusChange.changes).toEqual({ status: { from: 'todo', to: 'in-progress' } });

    expect(priorityChange.type).toBe('priority_change');
    expect(priorityChange.changes).toEqual({ priority: { from: 'medium', to: 'high' } });

    expect(assignment.type).toBe('assignment');
    expect(assignment.changes).toBeUndefined();
  });

  it('タイムスタンプが新しい順（status_change > priority_change > assignment）であること', () => {
    const [statusChange, priorityChange, assignment] = generateMockTaskActivities(1, t);

    expect(new Date(statusChange.timestamp).getTime()).toBeGreaterThan(
      new Date(priorityChange.timestamp).getTime(),
    );
    expect(new Date(priorityChange.timestamp).getTime()).toBeGreaterThan(
      new Date(assignment.timestamp).getTime(),
    );
  });
});

describe('analyzeMemo', () => {
  it('短く中立的な内容は低重要度・中立感情になること', async () => {
    vi.useFakeTimers();
    try {
      const promise = analyzeMemo('これはメモです', t);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(result.importance).toBe('low');
      expect(result.sentiment).toBe('neutral');
    } finally {
      vi.useRealTimers();
    }
  });

  it('課題語と対応語の両方を含む場合は高重要度になること', async () => {
    vi.useFakeTimers();
    try {
      const promise = analyzeMemo('バグを修正する必要がある', t);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(result.importance).toBe('high');
      expect(result.sentiment).toBe('negative');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ポジティブな語を含む場合はsentimentがpositiveになること', async () => {
    vi.useFakeTimers();
    try {
      const promise = analyzeMemo('実装が完了して進捗が良い', t);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(result.sentiment).toBe('positive');
    } finally {
      vi.useRealTimers();
    }
  });

  it('200文字を超える内容は重要度が高になること', async () => {
    vi.useFakeTimers();
    try {
      const longContent = 'あ'.repeat(201);
      const promise = analyzeMemo(longContent, t);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(result.importance).toBe('high');
    } finally {
      vi.useRealTimers();
    }
  });

  it('50文字を超える内容は要約が省略されること', async () => {
    vi.useFakeTimers();
    try {
      const content = 'あ'.repeat(60);
      const promise = analyzeMemo(content, t);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(result.summary.endsWith('...')).toBe(true);
      expect(result.summary.length).toBe(47 + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('箇条書き（・, -, *）からアクションアイテムを抽出すること', async () => {
    vi.useFakeTimers();
    try {
      const content =
        '対応事項:\n・データ移行を確認する\n- テストを実施する\n* リリースノートを書く';
      const promise = analyzeMemo(content, t);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(result.actionItems).toEqual([
        'データ移行を確認する',
        'テストを実施する',
        'リリースノートを書く',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('アクションアイテムは最大3件に制限されること', async () => {
    vi.useFakeTimers();
    try {
      const content = ['・a', '・b', '・c', '・d', '・e'].join('\n');
      const promise = analyzeMemo(content, t);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(result.actionItems).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('キーワードは重複を除き最大5件に制限されること', async () => {
    vi.useFakeTimers();
    try {
      const content = 'テスト テスト 実装 調査 確認 検討 対応 修正';
      const promise = analyzeMemo(content, t);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(result.keywords.length).toBeLessThanOrEqual(5);
      expect(new Set(result.keywords).size).toBe(result.keywords.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it('analyzedAt がISO文字列で設定されること', async () => {
    vi.useFakeTimers();
    try {
      const promise = analyzeMemo('メモ', t);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      expect(() => new Date(result.analyzedAt).toISOString()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
