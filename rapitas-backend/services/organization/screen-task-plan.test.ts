/**
 * screen-task-plan.test
 *
 * Covers the 画面一覧 parser. The cases are the two shapes the live generator
 * actually produces, because a shape this parser rejects costs that project
 * every screen task with no error anywhere — the failure already recorded on
 * `FEATURE_DECLARATION` in requirements-task-plan.ts.
 */
import { describe, test, expect } from 'bun:test';
import { parseScreenTasks } from './screen-task-plan';

/** TempoRaid's shape, read from its docs/requirements.md on 2026-10-17. */
const BULLET = [
  '# 画面一覧',
  '',
  '- ログイン: メール、ゲストボタン。成功するとロビーへ遷移。',
  '- ロビー: 曲読込ドロップゾーン、ルーム作成、コード入力。解析後にルーム待機へ遷移。',
  '- ランキング: 曲別・週間タブ、自己順位。',
  '',
  '# 非機能要件',
  '- 同時接続1万人',
].join('\n');

/** ContextFlow's shape, read from its docs/requirements.md on 2026-10-17. */
const TABLE = [
  '# 画面一覧',
  '',
  '| 画面名 | ルート | 目的 | 主要UI要素 | 遷移 |',
  '|---|---|---|---|---|',
  '| ログイン | /login | SSOログイン | 「会社アカウントでログイン」ボタン | → /tasks/new |',
  '| ソース管理 | /sources | 取り込み対象の設定 | ソース一覧、接続ボタン | → /patterns |',
  '',
  '# 非機能要件',
].join('\n');

describe('parseScreenTasks', () => {
  test('returns nothing when the document declares no 画面一覧', () => {
    expect(parseScreenTasks('# 機能要件\n- [F-01] ログイン')).toEqual([]);
  });

  test('reads the bullet shape, taking the name from before the colon', () => {
    const screens = parseScreenTasks(BULLET);
    expect(screens.map((s) => s.name)).toEqual(['ログイン', 'ロビー', 'ランキング']);
    expect(screens[0].detail).toContain('ゲストボタン');
    expect(screens[0].route).toBeUndefined();
  });

  test('reads the table shape, taking the name and the route from their columns', () => {
    const screens = parseScreenTasks(TABLE);
    expect(screens.map((s) => s.name)).toEqual(['ログイン', 'ソース管理']);
    expect(screens[0].route).toBe('/login');
    expect(screens[0].detail).toContain('会社アカウントでログイン');
  });

  test('drops the table header and separator rather than filing them as screens', () => {
    expect(parseScreenTasks(TABLE).some((s) => s.name === '画面名')).toBe(false);
    expect(parseScreenTasks(TABLE).some((s) => s.name.startsWith('---'))).toBe(false);
  });

  test('stops at the next top-level heading', () => {
    expect(parseScreenTasks(BULLET).some((s) => s.name.includes('同時接続'))).toBe(false);
  });

  test('tolerates a bold wrapper, a full-width colon and a checkbox', () => {
    const doc = [
      '# 画面一覧',
      '- **ログイン**：メール',
      '- [ ] 設定: 音量',
      '- [S-03] ロビー: ドロップゾーン',
    ].join('\n');
    expect(parseScreenTasks(doc).map((s) => s.name)).toEqual(['ログイン', '設定', 'ロビー']);
  });

  test('keeps a screen that has no detail at all', () => {
    expect(parseScreenTasks('# 画面一覧\n- 設定').map((s) => s.name)).toEqual(['設定']);
  });

  test('does not repeat a screen declared twice', () => {
    const doc = '# 画面一覧\n- ログイン: a\n- ログイン: b';
    expect(parseScreenTasks(doc)).toHaveLength(1);
  });

  describe('features reached from each screen', () => {
    // The 画面導線 section is what makes a screen task finishable: it says
    // which features must be startable from the screen once it exists.
    const doc = [
      '# 画面一覧',
      '- ログイン: メール',
      '- ロビー: ドロップゾーン',
      '# 画面導線',
      '- [F-01] ログイン のログインボタンを押す → セッションが作られる',
      '- [F-02] ロビー のドロップゾーンに曲を落とす → 解析が始まる',
      '- [F-03] ロビー のルーム作成を押す → ルームが作られる',
    ].join('\n');

    test('attributes each 画面導線 line to the screen it names', () => {
      const screens = parseScreenTasks(doc);
      expect(screens.find((s) => s.name === 'ログイン')?.featureIds).toEqual(['F-01']);
      expect(screens.find((s) => s.name === 'ロビー')?.featureIds).toEqual(['F-02', 'F-03']);
    });

    test('matches on the route when the 導線 names it instead of the screen', () => {
      const byRoute = [
        '# 画面一覧',
        '| 画面名 | ルート |',
        '|---|---|',
        '| ログイン | /login |',
        '# 画面導線',
        '- [F-01] /login のボタンを押す → 入れる',
      ].join('\n');
      expect(parseScreenTasks(byRoute)[0].featureIds).toEqual(['F-01']);
    });

    test('leaves featureIds empty rather than guessing when no 導線 names the screen', () => {
      expect(parseScreenTasks(BULLET)[0].featureIds).toEqual([]);
    });
  });
});
