/**
 * playbook-inject ユニットテスト
 *
 * buildPlaybookContext の注入選択(最大1件・類似度優先)と鮮度gate(実在ファイル→注入、
 * 過半数消失→penalize+非注入、単一欠損→注入継続、workingDirectory未設定→非注入)、
 * および renderPlaybookSection(純関数)を検証する。鮮度検証は実ファイル
 * (一時ディレクトリ)に対する existsSync 実測で行う。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, fatal: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noop,
  logger: noop,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

// HACK(agent): Bun mock型推論の制限 — `as any`

const knowledgeFindMany = mock(() => Promise.resolve([])) as any;
const taskFindUnique = mock(() => Promise.resolve(null)) as any;
mock.module('../../../config/database', () => ({
  prisma: {
    knowledgeEntry: { findMany: knowledgeFindMany },
    task: { findUnique: taskFindUnique },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const penalizeOnFailure = mock(() => Promise.resolve()) as any;
const boostDecayOnAccess = mock(() => Promise.resolve()) as any;
mock.module('../forgetting', () => ({ penalizeOnFailure, boostDecayOnAccess }));

const { buildPlaybookContext, renderPlaybookSection } = await import('./playbook-inject');

// 実在ファイルを持つ一時 workingDirectory を用意(鮮度gateの existsSync 実測用)。
const workDir = mkdtempSync(join(tmpdir(), 'playbook-inject-test-'));
mkdirSync(join(workDir, 'services/settings'), { recursive: true });
writeFileSync(join(workDir, 'services/settings/general.ts'), '// fixture');
writeFileSync(join(workDir, 'services/settings/schema.ts'), '// fixture');

const TASK = {
  title: '設定トグル追加: 設定画面から切り替え',
  description: null as string | null,
};

const playbookEntry = (id: number, title: string, files: string[]) => ({
  id,
  title,
  content: [
    '## 対象ファイル',
    ...files.map((f) => `- \`${f}\``),
    '## 手順',
    '1. schema に1行追加し settings へ同型ミラー',
  ].join('\n'),
});

beforeEach(() => {
  knowledgeFindMany.mockReset();
  knowledgeFindMany.mockResolvedValue([
    playbookEntry(11, '設定トグル追加: 設定画面トグルの追加手順書', [
      'services/settings/general.ts',
      'services/settings/schema.ts',
    ]),
  ]);
  taskFindUnique.mockReset();
  taskFindUnique.mockResolvedValue({ theme: { workingDirectory: workDir } });
  penalizeOnFailure.mockReset();
  penalizeOnFailure.mockResolvedValue(undefined);
});

describe('buildPlaybookContext', () => {
  test('対象ファイルが実在すれば注入され、penalizeされない', async () => {
    const section = await buildPlaybookContext(1, TASK);
    expect(section).toContain('プレイブック');
    expect(section).toContain('設定トグル追加: 設定画面トグルの追加手順書');
    expect(penalizeOnFailure).not.toHaveBeenCalled();
  });

  test('対象ファイルが全消失していればpenalizeして注入しない', async () => {
    knowledgeFindMany.mockResolvedValue([
      playbookEntry(12, '設定トグル追加: 設定画面トグルの追加手順書', [
        'services/settings/deleted-a.ts',
        'services/settings/deleted-b.ts',
      ]),
    ]);
    const section = await buildPlaybookContext(1, TASK);
    expect(section).toBe('');
    expect(penalizeOnFailure).toHaveBeenCalledTimes(1);
    expect(penalizeOnFailure.mock.calls[0][0]).toBe(12);
  });

  test('単一欠損(過半数は現存)では減衰させず注入する', async () => {
    knowledgeFindMany.mockResolvedValue([
      playbookEntry(13, '設定トグル追加: 設定画面トグルの追加手順書', [
        'services/settings/general.ts',
        'services/settings/deleted.ts',
      ]),
    ]);
    const section = await buildPlaybookContext(1, TASK);
    expect(section).not.toBe('');
    expect(penalizeOnFailure).not.toHaveBeenCalled();
  });

  test('workingDirectory未設定なら注入もpenalizeもしない', async () => {
    taskFindUnique.mockResolvedValue({ theme: { workingDirectory: null } });
    const section = await buildPlaybookContext(1, TASK);
    expect(section).toBe('');
    expect(penalizeOnFailure).not.toHaveBeenCalled();
  });

  test('複数候補があっても最大1件(最類似)のみ注入する', async () => {
    knowledgeFindMany.mockResolvedValue([
      playbookEntry(14, '設定トグル追加の手順書', ['services/settings/general.ts']),
      playbookEntry(15, '設定トグル追加: 設定画面トグルの追加手順書', [
        'services/settings/general.ts',
      ]),
    ]);
    const section = await buildPlaybookContext(1, TASK);
    expect(section).toContain('設定トグル追加: 設定画面トグルの追加手順書');
    // 次点の手順書見出しは含まれない(手順書は1件のみ)
    expect(section).not.toContain('## 設定トグル追加の手順書');
  });

  test('類似プレイブックが無ければ空文字(既存セクション結合を壊さない)', async () => {
    knowledgeFindMany.mockResolvedValue([
      playbookEntry(16, 'freee OCR 仕訳取込の手順書', ['services/settings/general.ts']),
    ]);
    const section = await buildPlaybookContext(1, TASK);
    expect(section).toBe('');
  });

  test('DB例外時も空文字に落ちる(fail-open)', async () => {
    knowledgeFindMany.mockRejectedValue(new Error('db down'));
    const section = await buildPlaybookContext(1, TASK);
    expect(section).toBe('');
  });
});

describe('renderPlaybookSection', () => {
  test('タイトル・本文・類似度を含むMarkdown節を返す', () => {
    const section = renderPlaybookSection(
      { id: 1, title: 'テスト手順書', content: '## 対象ファイル\n- `a/b.ts`', similarity: 0.5 },
      'ja',
    );
    expect(section).toContain('# プレイブック');
    expect(section).toContain('テスト手順書');
    expect(section).toContain('類似度 50%');
  });

  test('空入力は空文字', () => {
    expect(renderPlaybookSection(null, 'ja')).toBe('');
    expect(renderPlaybookSection(undefined, 'en')).toBe('');
  });
});
