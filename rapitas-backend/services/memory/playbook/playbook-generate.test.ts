/**
 * playbook-generate ユニットテスト
 *
 * maybeGeneratePlaybook のオーケストレーション(クラスタ不成立時のAIスキップ、
 * AI呼び出し=1回、パース失敗のfail-open(create未呼出)、dedupヒット時の既存強化、
 * 正常時のKnowledgeEntry作成+キュー投入)と parsePlaybookResult を検証する。
 * NOTE: playbook-generate は動的importされる — mock.module はimport前に確立すること。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, fatal: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noop,
  logger: noop,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

// HACK(agent): Bun mock型推論の制限 — `as any`

const taskFindUnique = mock(() =>
  Promise.resolve({
    title: '設定トグル追加: 自動リトライを設定画面から切り替え可能にする',
    themeId: 7,
  }),
) as any;
const taskFindMany = mock(() => Promise.resolve([])) as any;
const knowledgeCreate = mock(() => Promise.resolve({ id: 501 })) as any;
mock.module('../../../config/database', () => ({
  prisma: {
    task: { findUnique: taskFindUnique, findMany: taskFindMany },
    knowledgeEntry: { create: knowledgeCreate },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const VALID_AI_CONTENT = JSON.stringify({
  title: '設定トグル追加の手順書',
  content: [
    '## 対象ファイル',
    '- `services/settings/general.ts`',
    '- `services/settings/schema.ts`',
    '## 手順',
    '1. schema に1行追加し settings 3ファイルへ同型ミラー',
    '## ハマりどころ',
    '- schema の再生成忘れ',
    '## 検証手順',
    '- bun test services/settings',
  ].join('\n'),
});

const sendAIMessage = mock(() =>
  Promise.resolve({ content: VALID_AI_CONTENT, tokensUsed: 10 }),
) as any;
mock.module('../../../utils/ai-client', () => ({ sendAIMessage }));

const findSemanticDuplicate = mock(() => Promise.resolve(null)) as any;
const findLexicalDuplicate = mock(() => Promise.resolve(null)) as any;
mock.module('../dedup', () => ({ findSemanticDuplicate, findLexicalDuplicate }));

const boostDecayOnAccess = mock(() => Promise.resolve()) as any;
const penalizeOnFailure = mock(() => Promise.resolve()) as any;
mock.module('../forgetting', () => ({ boostDecayOnAccess, penalizeOnFailure }));

const appendEvent = mock(() => Promise.resolve()) as any;
mock.module('../timeline', () => ({ appendEvent }));

const enqueue = mock(() => Promise.resolve()) as any;
mock.module('../index', () => ({ memoryTaskQueue: { enqueue } }));

// verify.md は task 90(同型候補)と task 100(当該)の両方に変更ファイル表を持たせる。
const VERIFY_MD = [
  '## 変更ファイル',
  '| ファイル | 種別 | 変更内容 |',
  '| `services/settings/general.ts` | 変更 | トグル追加 |',
  '| `services/settings/schema.ts` | 変更 | 1行追加 |',
].join('\n');
const readWorkflowFile = mock(() => Promise.resolve(VERIFY_MD)) as any;
mock.module('../../workflow/workflow-file-utils', () => ({ readWorkflowFile }));

const { maybeGeneratePlaybook } = await import('./playbook-generate');
const { parsePlaybookResult } = await import('./playbook-prompt');

/** 同型クラスタが成立する候補行(タイトル類似+同一ファイル群)。 */
const similarRows = () => [
  { id: 90, title: '設定トグル追加: 通知音を設定画面から切り替え可能にする' },
];

beforeEach(() => {
  taskFindUnique.mockReset();
  taskFindUnique.mockResolvedValue({
    title: '設定トグル追加: 自動リトライを設定画面から切り替え可能にする',
    themeId: 7,
  });
  taskFindMany.mockReset();
  taskFindMany.mockResolvedValue(similarRows());
  knowledgeCreate.mockReset();
  knowledgeCreate.mockResolvedValue({ id: 501 });
  sendAIMessage.mockReset();
  sendAIMessage.mockResolvedValue({ content: VALID_AI_CONTENT, tokensUsed: 10 });
  findSemanticDuplicate.mockReset();
  findSemanticDuplicate.mockResolvedValue(null);
  findLexicalDuplicate.mockReset();
  findLexicalDuplicate.mockResolvedValue(null);
  boostDecayOnAccess.mockReset();
  boostDecayOnAccess.mockResolvedValue(undefined);
  appendEvent.mockReset();
  appendEvent.mockResolvedValue(undefined);
  enqueue.mockReset();
  enqueue.mockResolvedValue(undefined);
  readWorkflowFile.mockReset();
  readWorkflowFile.mockResolvedValue(VERIFY_MD);
});

describe('maybeGeneratePlaybook', () => {
  test('同型クラスタ成立時はAIをちょうど1回呼び、KnowledgeEntryを作成する', async () => {
    await maybeGeneratePlaybook(100);
    expect(sendAIMessage).toHaveBeenCalledTimes(1);
    expect(knowledgeCreate).toHaveBeenCalledTimes(1);
    const data = knowledgeCreate.mock.calls[0][0].data;
    expect(data.sourceType).toBe('playbook');
    expect(data.category).toBe('procedure');
    expect(data.confidence).toBe(0.72);
    // tags は文字列配列を厳守(tags-as-object 障害回避)
    expect(JSON.parse(data.tags)).toEqual(['playbook', 'auto_generated']);
    // embed + validate のキュー投入
    const queued = enqueue.mock.calls.map((c: unknown[]) => c[0]);
    expect(queued).toContain('embed');
    expect(queued).toContain('validate');
  });

  test('同型候補が無ければAIを呼ばない(クラスタ不成立)', async () => {
    taskFindMany.mockResolvedValue([]);
    await maybeGeneratePlaybook(100);
    expect(sendAIMessage).not.toHaveBeenCalled();
    expect(knowledgeCreate).not.toHaveBeenCalled();
  });

  test('変更ファイル表が無い(verify/plan両方空)なら候補外でAIを呼ばない', async () => {
    readWorkflowFile.mockResolvedValue('# report\n表なし');
    await maybeGeneratePlaybook(100);
    expect(sendAIMessage).not.toHaveBeenCalled();
  });

  test('AI応答パース失敗時はcreateせずfail-openで終了(失敗イベント記録)', async () => {
    sendAIMessage.mockResolvedValue({ content: 'これはJSONではない', tokensUsed: 1 });
    await maybeGeneratePlaybook(100);
    expect(sendAIMessage).toHaveBeenCalledTimes(1);
    expect(knowledgeCreate).not.toHaveBeenCalled();
    const events = appendEvent.mock.calls.map((c: any[]) => c[0].eventType);
    expect(events).toContain('playbook_generation_failed');
  });

  test('dedupヒット時は既存をboostし新規createしない', async () => {
    findSemanticDuplicate.mockResolvedValue(321);
    await maybeGeneratePlaybook(100);
    expect(boostDecayOnAccess).toHaveBeenCalledWith(321, 0.1);
    expect(knowledgeCreate).not.toHaveBeenCalled();
  });

  test('AIがrejectしてもthrowしない(fail-open)', async () => {
    sendAIMessage.mockRejectedValue(new Error('AI down'));
    await expect(maybeGeneratePlaybook(100)).resolves.toBeUndefined();
    expect(knowledgeCreate).not.toHaveBeenCalled();
  });
});

describe('parsePlaybookResult', () => {
  test('正常JSONは{title, content}にパースされる', () => {
    const r = parsePlaybookResult(`前置き\n${VALID_AI_CONTENT}\n後置き`);
    expect(r.parseFailed).toBe(false);
    if (!r.parseFailed) {
      expect(r.title).toBe('設定トグル追加の手順書');
      expect(r.content).toContain('## 対象ファイル');
    }
  });

  test('不正応答(非JSON/フィールド欠落/対象ファイル節なし)はparseFailed', () => {
    expect(parsePlaybookResult('壊れた応答').parseFailed).toBe(true);
    expect(parsePlaybookResult('{"title":"x"}').parseFailed).toBe(true);
    expect(
      parsePlaybookResult(JSON.stringify({ title: 'x', content: '## 手順\n1. 対象ファイル節なし' }))
        .parseFailed,
    ).toBe(true);
  });
});
