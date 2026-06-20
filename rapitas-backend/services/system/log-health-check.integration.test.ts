/**
 * log-health-check.integration.test
 *
 * runLogHealthCheck の統合テスト。検証対象の 3 つの設計保証:
 *   1. 件数合算 — global + theme の filed が正確に合算される
 *   2. 全ターゲット処理 — 複数テーマが全て処理される（並列化保証）
 *   3. since クランプ (mtime) — 昨日の mtime ファイルは readFileSync されない
 *   4. since クランプ (entry time) — 今日 mtime でも time が昨日のエントリは除外される
 *   5. ターゲットなし — getHealthCheckTargets が [] のとき global のみ集計
 *
 * Strategy: mock.module で 5 依存（fs / logger / database / concern-backlog-service /
 * theme-backlog-override-service）をスタブ化し runLogHealthCheck を直接 await する。
 * ソースコード（log-health-check.ts 等）への変更は一切なし。
 *
 * NOTE: mock.module の宣言は `await import('./log-health-check')` より前に置く必要がある。
 * log-health-check.ts は top-level import で依存を解決するため、後置だと実モジュールが
 * 先に解決されモックが発火しない（innovation-session.test.ts:38-63 準拠）。
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── 定数 ────────────────────────────────────────────────────────────────────

const BACKEND_LOG_PATH = '/fake/logs/backend.log';
const THEME_A_DIR = '/fake/theme-a/logs';
const THEME_B_DIR = '/fake/theme-b/logs';
const THEME_C_DIR = '/fake/theme-c/logs';

/** noop ロガー: createLogger が返すオブジェクトのスタブ */
const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// ─── since 計算（ソースの startOfTodayMs と同一ロジック） ───────────────────

/** 今日 00:00:00.000 の epoch ms。ソースの startOfTodayMs() と同一計算。 */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ─── Pino NDJSON ヘルパ ──────────────────────────────────────────────────────

/**
 * Pino 形式の NDJSON 行を 1 行生成する。
 *
 * @param level - pino 数値レベル（warn=40 / error=50）
 * @param msg - ログメッセージ
 * @param name - ロガー名
 * @param time - epoch ms。省略時は今日の 1 時間後（since クランプを通過させる）
 * @returns NDJSON 文字列（改行なし）
 */
function pinoLine(level: number, msg: string, name: string, time?: number): string {
  const since = startOfTodayMs();
  return JSON.stringify({ level, msg, name, time: time ?? since + 3_600_000 });
}

// ─── モック宣言（await import より前に配置すること） ─────────────────────────

const mockReadFileSync = mock((_path: unknown, _enc: unknown): string => '');
const mockReaddirSync = mock((_path: unknown): string[] => []);
const mockStatSync = mock((_path: unknown) => ({
  isFile: (): boolean => false,
  mtimeMs: 0 as number,
}));
const mockExistsSync = mock((_path: unknown): boolean => false);
const mockUnlinkSync = mock((_path: unknown): void => {});

mock.module('fs', () => ({
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
}));

mock.module('../../config/logger', () => ({
  createLogger: () => noopLog,
  getBackendLogFilePath: () => BACKEND_LOG_PATH,
}));

const mockThemeFindMany = mock(() => Promise.resolve([] as { id: number; name: string }[]));

mock.module('../../config/database', () => ({
  prisma: {
    theme: { findMany: mockThemeFindMany },
  },
}));

const mockSubmitConcern = mock(() => Promise.resolve(undefined));
const mockResolveDefaultThemeId = mock((): Promise<number | null> => Promise.resolve(1));

mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: mockSubmitConcern,
  resolveDefaultThemeId: mockResolveDefaultThemeId,
}));

const mockGetHealthCheckTargets = mock(
  (): Promise<{ themeId: number; logDir: string; logFormat: 'pino' | 'json' | 'text' }[]> =>
    Promise.resolve([]),
);

mock.module('../scheduling/theme-backlog-override-service', () => ({
  getHealthCheckTargets: mockGetHealthCheckTargets,
}));

// ─── 対象モジュールの動的 import（モック宣言の後でなければならない）────────

const { runLogHealthCheck } = await import('./log-health-check');

// ─── テストスイート ──────────────────────────────────────────────────────────

describe('runLogHealthCheck 統合テスト', () => {
  const since = startOfTodayMs();
  /** 今日 1 時間後の mtime（since クランプを通過する） */
  const TODAY_MTIME = since + 3_600_000;
  /** 昨日 1 時間前の mtime（since クランプで除外される） */
  const YESTERDAY_MTIME = since - 3_600_000;

  /**
   * 各テストを独立した状態にするための共通リセット。
   * - 全モックの呼び出し履歴をクリア
   * - デフォルト戻り値を設定（各テストで上書き可能）
   */
  beforeEach(() => {
    mockReadFileSync.mockClear();
    mockReaddirSync.mockClear();
    mockStatSync.mockClear();
    mockExistsSync.mockClear();
    mockUnlinkSync.mockClear();
    mockThemeFindMany.mockClear();
    mockSubmitConcern.mockClear();
    mockResolveDefaultThemeId.mockClear();
    mockGetHealthCheckTargets.mockClear();

    // デフォルト: ターゲットなし・起票なし
    mockResolveDefaultThemeId.mockReturnValue(Promise.resolve(1 as number | null));
    mockGetHealthCheckTargets.mockReturnValue(Promise.resolve([]));
    mockThemeFindMany.mockReturnValue(Promise.resolve([]));
    mockSubmitConcern.mockReturnValue(Promise.resolve(undefined));
    mockReadFileSync.mockReturnValue('');

    // existsSync: 既知パスのみ true（backend log + 3 テーマ log dir）
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = p as string;
      return (
        path === BACKEND_LOG_PATH ||
        path === THEME_A_DIR ||
        path === THEME_B_DIR ||
        path === THEME_C_DIR
      );
    });

    // readdirSync: テーマ log dir → ['app.log']、prune dir 等 → []
    // NOTE: prune dir は join(BACKEND_LOG_PATH, '..') で計算される。定数と一致しないため
    // [] が返り unlinkSync は発火しない。
    mockReaddirSync.mockImplementation((p: unknown) => {
      const path = p as string;
      if (path === THEME_A_DIR || path === THEME_B_DIR || path === THEME_C_DIR) {
        return ['app.log'];
      }
      return [];
    });

    // statSync: **/app.log は今日 mtime のファイルとして扱う
    mockStatSync.mockImplementation((p: unknown) => {
      const path = p as string;
      const isAppLog = path.endsWith('app.log');
      return {
        isFile: () => isAppLog,
        mtimeMs: isAppLog ? TODAY_MTIME : 0,
      };
    });
  });

  // ── Test 1: 件数合算 ──────────────────────────────────────────────────────

  it('件数合算: global 2 件 + テーマ A 1 件 = 戻り値 3', async () => {
    // グローバルログ: 2 つの distinct エラー
    const globalContent = [
      pinoLine(50, 'Database connection failed', 'db'),
      pinoLine(50, 'Task execution failed', 'task'),
    ].join('\n');

    // テーマ A ログ: 1 つのエラー
    const themeAContent = pinoLine(50, 'Project build failed', 'builder');

    mockReadFileSync.mockImplementation((p: unknown, _enc: unknown) => {
      const path = p as string;
      if (path === BACKEND_LOG_PATH) return globalContent;
      if (path.endsWith('app.log')) return themeAContent;
      return '';
    });

    mockGetHealthCheckTargets.mockReturnValue(
      Promise.resolve([{ themeId: 10, logDir: THEME_A_DIR, logFormat: 'pino' as const }]),
    );
    mockThemeFindMany.mockReturnValue(Promise.resolve([{ id: 10, name: 'ProjectA' }]));

    const result = await runLogHealthCheck();

    expect(result).toBe(3);
    // submitConcern が 3 回（global 2 + テーマ A 1）呼ばれること
    expect(mockSubmitConcern).toHaveBeenCalledTimes(3);
  });

  // ── Test 2: 全ターゲット処理（並列化保証） ────────────────────────────────

  it('全ターゲット処理: 3 テーマが全て処理される', async () => {
    mockReadFileSync.mockImplementation((p: unknown, _enc: unknown) => {
      const path = p as string;
      if (path === BACKEND_LOG_PATH) return ''; // global は 0 件
      // 各テーマの app.log にそれぞれ 1 件のエラー
      if (path.includes('theme-a')) return pinoLine(50, 'theme-a error', 'svc');
      if (path.includes('theme-b')) return pinoLine(50, 'theme-b error', 'svc');
      if (path.includes('theme-c')) return pinoLine(50, 'theme-c error', 'svc');
      return '';
    });

    mockGetHealthCheckTargets.mockReturnValue(
      Promise.resolve([
        { themeId: 1, logDir: THEME_A_DIR, logFormat: 'pino' as const },
        { themeId: 2, logDir: THEME_B_DIR, logFormat: 'pino' as const },
        { themeId: 3, logDir: THEME_C_DIR, logFormat: 'pino' as const },
      ]),
    );
    mockThemeFindMany.mockReturnValue(
      Promise.resolve([
        { id: 1, name: 'ThemeA' },
        { id: 2, name: 'ThemeB' },
        { id: 3, name: 'ThemeC' },
      ]),
    );

    const result = await runLogHealthCheck();

    // 3 テーマ × 1 件 = 3 件（global 0 件）
    expect(result).toBe(3);

    // 各 themeId が submitConcern に渡されていること（全テーマが処理された証拠）
    const calls = mockSubmitConcern.mock.calls as Array<[{ themeId?: number }]>;
    const filedThemeIds = new Set(calls.map((c) => c[0].themeId));
    expect(filedThemeIds.has(1)).toBe(true);
    expect(filedThemeIds.has(2)).toBe(true);
    expect(filedThemeIds.has(3)).toBe(true);
  });

  // ── Test 3: since クランプ (mtime) ────────────────────────────────────────

  it('since クランプ (mtime): 昨日の mtime ファイルは readFileSync されない', async () => {
    // NOTE: 昨日 mtime → readThemeEntries の `st.mtimeMs < since` 条件が発火しスキップ
    mockStatSync.mockImplementation((p: unknown) => {
      const path = p as string;
      const isAppLog = path.endsWith('app.log');
      return {
        isFile: () => isAppLog,
        mtimeMs: isAppLog ? YESTERDAY_MTIME : 0,
      };
    });

    mockGetHealthCheckTargets.mockReturnValue(
      Promise.resolve([{ themeId: 10, logDir: THEME_A_DIR, logFormat: 'pino' as const }]),
    );
    mockThemeFindMany.mockReturnValue(Promise.resolve([{ id: 10, name: 'ProjectA' }]));
    // グローバルも空文字列（デフォルト）

    await runLogHealthCheck();

    // 昨日 mtime の app.log は readFileSync が呼ばれていないこと
    const readPaths = (mockReadFileSync.mock.calls as Array<[string, string]>).map((c) => c[0]);
    expect(readPaths.some((p) => p.endsWith('app.log'))).toBe(false);
  });

  // ── Test 4: since クランプ (entry time) ──────────────────────────────────

  it('since クランプ (entry time): 今日 mtime でも time が昨日のエントリは件数 0', async () => {
    // 今日の mtime だが entry の time フィールドが昨日
    // NOTE: parseLogEntries(...).filter(e => e.time === undefined || e.time >= since) で除外
    const YESTERDAY_ENTRY_TIME = since - 3_600_000;
    const staleEntry = pinoLine(50, 'Stale error from yesterday', 'db', YESTERDAY_ENTRY_TIME);

    mockReadFileSync.mockImplementation((p: unknown, _enc: unknown) => {
      const path = p as string;
      if (path === BACKEND_LOG_PATH) return '';
      if (path.endsWith('app.log')) return staleEntry;
      return '';
    });

    mockGetHealthCheckTargets.mockReturnValue(
      Promise.resolve([{ themeId: 10, logDir: THEME_A_DIR, logFormat: 'pino' as const }]),
    );
    mockThemeFindMany.mockReturnValue(Promise.resolve([{ id: 10, name: 'ProjectA' }]));

    const result = await runLogHealthCheck();

    // entry time が昨日 → フィルタで除外 → 懸念 0 件
    expect(result).toBe(0);
    expect(mockSubmitConcern).not.toHaveBeenCalled();
  });

  // ── Test 5: ターゲットなし ────────────────────────────────────────────────

  it('ターゲットなし: getHealthCheckTargets が [] のとき global のみ集計', async () => {
    mockReadFileSync.mockImplementation((p: unknown, _enc: unknown) => {
      const path = p as string;
      if (path === BACKEND_LOG_PATH) return pinoLine(50, 'Backend startup error', 'system');
      return '';
    });

    // getHealthCheckTargets はデフォルト [] （beforeEach で設定済み）

    const result = await runLogHealthCheck();

    // global 1 件のみ
    expect(result).toBe(1);
    // テーマループに入らないため prisma.theme.findMany は呼ばれない
    expect(mockThemeFindMany).not.toHaveBeenCalled();
  });

  // ── 補助: prune 副作用なし ────────────────────────────────────────────────

  it('prune 副作用: unlinkSync は全ケースで呼ばれない', async () => {
    // readdirSync の prune dir（join(BACKEND_LOG_PATH, '..')）は [] を返す（beforeEach 設定）
    // backend-YYYY-MM-DD.log にマッチするファイルが存在しないため unlinkSync は発火しない
    await runLogHealthCheck();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});
