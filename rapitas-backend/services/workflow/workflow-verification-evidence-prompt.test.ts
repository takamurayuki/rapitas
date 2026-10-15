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
