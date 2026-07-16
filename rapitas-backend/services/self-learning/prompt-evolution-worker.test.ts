/**
 * prompt-evolution-worker テスト
 *
 * pending候補からの提案生成(status→proposed)、承認/却下(承認時は同ロールの
 * 旧承認をsuperseded化)、承認済み追記の取得を検証する。
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let aiResponse = '- 提出前にlintを実行する\n- 型チェックを通す';
const sendAIMessage = mock(() => Promise.resolve({ content: aiResponse }));
mock.module('../../utils/ai-client', () => ({ sendAIMessage }));

interface EvoRow {
  id: number;
  basePromptKey: string | null;
  category: string;
  reason: string | null;
  evidenceJson: string | null;
  afterPrompt: string;
  improvement: string | null;
  status: string;
  createdAt: Date;
}

let rows: EvoRow[] = [];
const transitionFindMany = mock(async () => [] as Array<{ cause: string | null }>);

mock.module('../../config/database', () => ({
  prisma: {
    promptEvolution: {
      findMany: mock((args: { where?: { status?: string }; take?: number }) => {
        const filtered = rows.filter((r) => !args?.where?.status || r.status === args.where.status);
        return Promise.resolve(args?.take ? filtered.slice(0, args.take) : filtered);
      }),
      findFirst: mock((args: { where: { basePromptKey?: string; status?: string } }) =>
        Promise.resolve(
          rows
            .filter(
              (r) =>
                (!args.where.basePromptKey || r.basePromptKey === args.where.basePromptKey) &&
                (!args.where.status || r.status === args.where.status),
            )
            .sort((a, b) => b.id - a.id)[0] ?? null,
        ),
      ),
      findUnique: mock((args: { where: { id: number } }) =>
        Promise.resolve(rows.find((r) => r.id === args.where.id) ?? null),
      ),
      update: mock((args: { where: { id: number }; data: Partial<EvoRow> }) => {
        const row = rows.find((r) => r.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
      updateMany: mock(
        (args: { where: { basePromptKey?: string; status?: string }; data: Partial<EvoRow> }) => {
          let count = 0;
          for (const r of rows) {
            if (
              (!args.where.basePromptKey || r.basePromptKey === args.where.basePromptKey) &&
              (!args.where.status || r.status === args.where.status)
            ) {
              Object.assign(r, args.data);
              count++;
            }
          }
          return Promise.resolve({ count });
        },
      ),
    },
    workflowTransition: { findMany: transitionFindMany },
  },
}));

const { generateProposalsForPending, getApprovedRoleAddendum, reviewProposal, listProposals } =
  await import('./prompt-evolution-worker');

function pendingRow(id: number, role: string): EvoRow {
  return {
    id,
    basePromptKey: `workflow_role_${role}`,
    category: '',
    reason: `success_rate 55% < 70% threshold`,
    evidenceJson: '{"total":20,"success":11}',
    afterPrompt: '',
    improvement: null,
    status: 'pending',
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };
}

beforeEach(() => {
  rows = [];
  aiResponse = '- 提出前にlintを実行する\n- 型チェックを通す';
  sendAIMessage.mockClear();
  transitionFindMany.mockClear();
  transitionFindMany.mockResolvedValue([]);
});

describe('generateProposalsForPending', () => {
  test('pending候補がLLM生成の追記付きでproposedになる', async () => {
    rows = [pendingRow(1, 'implementer')];
    const n = await generateProposalsForPending();
    expect(n).toBe(1);
    expect(rows[0].status).toBe('proposed');
    expect(rows[0].afterPrompt).toContain('lint');
    expect(rows[0].category).toBe('implementer');
  });

  test('LLM失敗時は候補をpendingのまま残す(次回再試行)', async () => {
    rows = [pendingRow(2, 'planner')];
    sendAIMessage.mockRejectedValueOnce(new Error('LLM down'));
    const n = await generateProposalsForPending();
    expect(n).toBe(0);
    expect(rows[0].status).toBe('pending');
  });

  test('limitで処理件数が制限される', async () => {
    rows = [pendingRow(1, 'a'), pendingRow(2, 'b'), pendingRow(3, 'c')];
    const n = await generateProposalsForPending(2);
    expect(n).toBe(2);
    expect(rows.filter((r) => r.status === 'proposed')).toHaveLength(2);
  });
});

describe('reviewProposal', () => {
  test('承認でapprovedになり、同ロールの旧承認はsupersededになる', async () => {
    rows = [
      { ...pendingRow(1, 'implementer'), status: 'approved', afterPrompt: '古い追記' },
      { ...pendingRow(2, 'implementer'), status: 'proposed', afterPrompt: '新しい追記' },
    ];
    const ok = await reviewProposal(2, true);
    expect(ok).toBe(true);
    expect(rows[0].status).toBe('superseded');
    expect(rows[1].status).toBe('approved');
  });

  test('却下でrejectedになる', async () => {
    rows = [{ ...pendingRow(3, 'verifier'), status: 'proposed' }];
    expect(await reviewProposal(3, false)).toBe(true);
    expect(rows[0].status).toBe('rejected');
  });

  test('proposed以外の行はレビューできない', async () => {
    rows = [{ ...pendingRow(4, 'verifier'), status: 'approved' }];
    expect(await reviewProposal(4, true)).toBe(false);
  });
});

describe('getApprovedRoleAddendum', () => {
  test('承認済み追記を返し、無ければnull', async () => {
    rows = [{ ...pendingRow(1, 'implementer'), status: 'approved', afterPrompt: '追記テキスト' }];
    expect(await getApprovedRoleAddendum('implementer')).toBe('追記テキスト');
    expect(await getApprovedRoleAddendum('planner')).toBeNull();
  });
});

describe('listProposals', () => {
  test('proposedのみを返す', async () => {
    rows = [
      { ...pendingRow(1, 'a'), status: 'proposed' },
      { ...pendingRow(2, 'b'), status: 'pending' },
    ];
    const list = await listProposals();
    expect(list).toHaveLength(1);
  });
});
