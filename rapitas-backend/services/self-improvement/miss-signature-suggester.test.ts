/**
 * miss-signature-suggester.test
 *
 * Parse validation (drop-invalid, fail-open), pending_review creation
 * (acceptance 2), batch cap, rejected-signature exclusion in the prompt, and
 * per-case fail-open on AI/DB errors.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const suggestionFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const suggestionCreateMock = mock((_args: unknown) => Promise.resolve({ id: 1 }));
const caseFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const sendAIMessageMock = mock((_args: unknown) =>
  Promise.resolve({
    content: JSON.stringify({
      suggestions: [
        {
          signature: 'ci-failed-check-unrun-locally',
          explanation: 'ローカル未実行のCIチェックは素通りしやすい。',
        },
      ],
    }),
  }),
);

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: {
    missSignatureSuggestion: { findMany: suggestionFindManyMock, create: suggestionCreateMock },
    detectionMissCase: { findMany: caseFindManyMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: sendAIMessageMock,
}));

const { parseSuggestions, normalizeSignatureKey, buildSuggestionPrompt, generateMissSuggestions } =
  await import('./miss-signature-suggester');

function missCase(over: Record<string, unknown> = {}) {
  return {
    id: 11,
    taskId: 578,
    gate: 'ci_repair',
    reason: 'verify通過後にCIが失敗: Test Backend',
    evidenceJson: '{"transitionId":900}',
    ...over,
  };
}

describe('normalizeSignatureKey', () => {
  test('lowercases and hyphenates into a stable key', () => {
    expect(normalizeSignatureKey('CI Failed Check: unrun locally!')).toBe(
      'ci-failed-check-unrun-locally',
    );
  });

  test('rejects keys with no usable content', () => {
    expect(normalizeSignatureKey('!!!')).toBeNull();
    expect(normalizeSignatureKey('ab')).toBeNull();
  });
});

describe('parseSuggestions', () => {
  test('parses a valid payload', () => {
    const out = parseSuggestions(
      '前置きテキスト {"suggestions":[{"signature":"stale-generated-artifacts","explanation":"生成物の再生成漏れはCIでのみ落ちる。"}]} 後置き',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.signatureKey).toBe('stale-generated-artifacts');
  });

  test('explanation の無い提案は落とす（説明テキストは必須要求）', () => {
    const out = parseSuggestions(
      JSON.stringify({ suggestions: [{ signature: 'some-cue', explanation: '' }] }),
    );
    expect(out).toEqual([]);
  });

  test('壊れたJSON・配列でないpayloadは空配列（fail-open）', () => {
    expect(parseSuggestions('not json at all')).toEqual([]);
    expect(parseSuggestions('{"suggestions": "oops"}')).toEqual([]);
  });
});

describe('generateMissSuggestions', () => {
  beforeEach(() => {
    suggestionFindManyMock.mockReset().mockResolvedValue([]);
    suggestionCreateMock.mockReset().mockResolvedValue({ id: 1 });
    caseFindManyMock.mockReset().mockResolvedValue([]);
    sendAIMessageMock.mockReset().mockResolvedValue({
      content: JSON.stringify({
        suggestions: [
          {
            signature: 'ci-failed-check-unrun-locally',
            explanation: 'ローカル未実行のCIチェックは素通りしやすい。',
          },
        ],
      }),
    });
  });

  test('初期状態では全件が pending_review で作成される（受入基準2）', async () => {
    caseFindManyMock.mockResolvedValue([missCase()]);

    const created = await generateMissSuggestions();

    expect(created).toBe(1);
    const data = (suggestionCreateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> })
      .data;
    expect(data.status).toBe('pending_review');
    expect(data.caseId).toBe(11);
    expect(data.dedupKey).toBe('suggest:ci_repair:ci-failed-check-unrun-locally');
    expect(String(data.explanation).length).toBeGreaterThan(0);
  });

  test('棄却済み兆候がプロンプトの再提案禁止リストに入る', async () => {
    // 1st findMany = suggested caseIds, 2nd = rejected signatures.
    suggestionFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ signature: 'rejected-noisy-cue' }]);
    caseFindManyMock.mockResolvedValue([missCase()]);

    await generateMissSuggestions();

    const prompt = (sendAIMessageMock.mock.calls[0]?.[0] as { messages: { content: string }[] })
      .messages[0]!.content;
    expect(prompt).toContain('rejected-noisy-cue');
    expect(prompt).toContain('再提案禁止');
  });

  test('AI失敗・パース不能は per-case fail-open で継続する', async () => {
    caseFindManyMock.mockResolvedValue([missCase(), missCase({ id: 12 })]);
    sendAIMessageMock
      .mockImplementationOnce(() => Promise.reject(new Error('auth expired')))
      .mockImplementationOnce(() => Promise.resolve({ content: 'garbled output' }));

    const created = await generateMissSuggestions();

    expect(created).toBe(0);
    expect(suggestionCreateMock).not.toHaveBeenCalled();
  });

  test('dedupKey 重複 (P2002) は握り潰して継続する', async () => {
    caseFindManyMock.mockResolvedValue([missCase(), missCase({ id: 12 })]);
    suggestionCreateMock.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })),
    );

    const created = await generateMissSuggestions();

    expect(created).toBe(1);
  });

  test('limit がバッチ上限としてクエリへ渡る', async () => {
    caseFindManyMock.mockResolvedValue([]);
    await generateMissSuggestions({ limit: 2 });
    const args = caseFindManyMock.mock.calls[0]?.[0] as { take: number };
    expect(args.take).toBe(2);
  });

  test('候補クエリ失敗は fail-open で 0 を返す', async () => {
    suggestionFindManyMock.mockImplementation(() => Promise.reject(new Error('db down')));
    const created = await generateMissSuggestions();
    expect(created).toBe(0);
    expect(sendAIMessageMock).not.toHaveBeenCalled();
  });
});

describe('buildSuggestionPrompt', () => {
  test('事例の証拠とゲートがプロンプトへ埋め込まれる', () => {
    const prompt = buildSuggestionPrompt(missCase() as never, []);
    expect(prompt).toContain('ci_repair');
    expect(prompt).toContain('#578');
    expect(prompt).toContain('"transitionId":900');
    expect(prompt).toContain('(なし)');
  });
});
