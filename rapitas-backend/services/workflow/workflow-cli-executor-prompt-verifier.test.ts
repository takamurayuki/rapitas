/**
 * workflow-cli-executor-prompt — verifier/auto_verifier セクション注入テスト
 * (task 917, 受入基準4)。implementer ロードの既存出力が変化しないことの
 * 回帰確認も含む。
 */
import { describe, it, expect } from 'bun:test';
import { buildCliAgentPrompt } from './workflow-cli-executor-prompt';
import type { RoleTransition } from './workflow-types';

const baseParams = {
  taskId: 917,
  language: 'ja' as const,
  systemPrompt: '',
  context: '',
};

function transitionFor(
  role: RoleTransition['role'],
  outputFile: RoleTransition['outputFile'],
): RoleTransition {
  return { role, outputFile, nextStatus: 'in_progress' };
}

describe('buildCliAgentPrompt — verifier/auto_verifier git制約注入', () => {
  it('verifierロールでは破壊的操作の禁止・読み取り許可・新規パス限定の3点を含む', () => {
    const prompt = buildCliAgentPrompt({
      ...baseParams,
      transition: transitionFor('verifier', 'verify'),
    });
    expect(prompt).toContain('検証フェーズの git 操作制限');
    expect(prompt).toContain('checkout -- <file>');
    expect(prompt).toContain('git status');
    expect(prompt).toContain('新規パス');
  });

  it('auto_verifierロールでも同じ制約セクションを含む', () => {
    const prompt = buildCliAgentPrompt({
      ...baseParams,
      transition: transitionFor('auto_verifier', 'verify'),
    });
    expect(prompt).toContain('検証フェーズの git 操作制限');
  });

  it('英語出力でも制約セクションを含む', () => {
    const prompt = buildCliAgentPrompt({
      ...baseParams,
      language: 'en',
      transition: transitionFor('verifier', 'verify'),
    });
    expect(prompt).toContain('Verify-phase git restrictions');
  });

  it('researcher/planner/implementerロールでは制約セクションを注入しない', () => {
    for (const role of ['researcher', 'planner', 'implementer'] as const) {
      const outputFile =
        role === 'implementer' ? null : role === 'researcher' ? 'research' : 'plan';
      const prompt = buildCliAgentPrompt({
        ...baseParams,
        transition: transitionFor(role, outputFile),
      });
      expect(prompt).not.toContain('検証フェーズの git 操作制限');
    }
  });

  it('implementerロールの実装フェーズ文言は変更前後で完全一致する（回帰確認）', () => {
    const prompt = buildCliAgentPrompt({
      ...baseParams,
      transition: transitionFor('implementer', null),
    });
    expect(prompt).toContain('## 実装フェーズ（厳守）');
    expect(prompt).toContain(
      '- Write/Edit で直接コードを変更し、関連テストを追加/更新し、変更を完成させてください（調査・計画だけで終わらせない）。',
    );
    expect(prompt).toContain(
      '- **許可**: `git status` / `git diff` / `git log` / `git add` / 現在のブランチへの `git commit`。コミット・push・PR 作成は基本的に Rapitas が自動で行います。',
    );
    expect(prompt).not.toContain('検証フェーズの git 操作制限');
  });
});
