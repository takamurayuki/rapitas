import { describe, expect, test } from 'bun:test';
import {
  shellExitCodeSafetyRule,
  verificationEvidencePrompt,
} from './workflow-verification-evidence-prompt';

describe('shellExitCodeSafetyRule', () => {
  test.each(['ja', 'en'] as const)('mentions run-checked.cjs and pipe risk for %s', (language) => {
    const text = shellExitCodeSafetyRule(language);
    expect(text).toContain('run-checked.cjs');
    expect(text).toContain(language === 'ja' ? 'パイプ' : 'pipe');
    expect(text).toContain(language === 'ja' ? '終了コード' : 'exit code');
  });
});

describe('verificationEvidencePrompt', () => {
  test.each(['ja', 'en'] as const)('mentions runId identity for %s', (language) => {
    expect(verificationEvidencePrompt(language)).toContain('runId');
  });
});

describe('shellExitCodeSafetyRule entry step (task 1263)', () => {
  test.each(['ja', 'en'] as const)(
    '%s tells how to enter rapitas-backend relatively',
    (language) => {
      const text = shellExitCodeSafetyRule(language);
      expect(text).toContain('cd rapitas-backend');
      expect(text).toContain('<primary>');
      expect(text).not.toContain('/c/Projects');
    },
  );
});

// 2026-11-24: of the 79 repair bounces in the preceding 7 days, about 25 were
// gaps the verifier found by trying inputs the implementer had not — empty or
// zero rows, boundaries, a stale async response after a restart, a failure
// part-way through (TempoRaid 1403, 1420, 1521, 506). Handing the implementer
// the same probes moves those finds into the first round.
describe('implementerSelfCheckPrompt', () => {
  test.each(['ja', 'en'] as const)('%s names the probes the verifier uses', async (language) => {
    const { implementerSelfCheckPrompt } = await import('./workflow-verification-evidence-prompt');
    const text = implementerSelfCheckPrompt(language);
    const probes =
      language === 'ja'
        ? ['空', '0件', '境界', '順序', '失敗', '再実行']
        : ['empty', 'zero', 'boundar', 'order', 'fail', 're-run'];
    for (const probe of probes) expect(text).toContain(probe);
    expect(text).toContain(language === 'ja' ? 'テスト' : 'test');
  });

  test.each(['ja', 'en'] as const)(
    '%s reaches the implementer and not the verifier',
    async (language) => {
      const { buildRoleTexts } = await import('./workflow-role-prompts');
      const { implementerSelfCheckPrompt } =
        await import('./workflow-verification-evidence-prompt');
      const texts = buildRoleTexts(1, { title: 't', description: 'd' }, language);
      const block = implementerSelfCheckPrompt(language);
      expect(texts.implementer.constraints).toContain(block);
      expect(JSON.stringify(texts.verifier)).not.toContain(JSON.stringify(block).slice(1, -1));
    },
  );
});
