import { describe, expect, test } from 'bun:test';
import { buildRoleTexts } from './workflow-role-prompts';

describe('verification result lookup instructions', () => {
  test.each(['ja', 'en'] as const)(
    'expands the recovery URL for %s without an unresolved task placeholder',
    (language) => {
      const texts = buildRoleTexts(915, { title: 'Probe', description: null }, language);
      expect(texts.implementer.constraints).toContain(
        '/workflow/tasks/915/run-verification/latest',
      );
      expect(texts.implementer.constraints).not.toContain('${taskId}');
      expect(texts.implementer.constraints).toContain('runId');
      expect(texts.implementer.constraints).toContain('checks[].ran');
      expect(texts.verifier.instruction).toContain('checks[].ran');
    },
  );
});

describe('shell exit-code safety rule (task 916)', () => {
  test.each(['ja', 'en'] as const)(
    'is included in implementer and verifier prompts for %s',
    (language) => {
      const texts = buildRoleTexts(916, { title: 'Probe', description: null }, language);
      expect(texts.implementer.constraints).toContain('run-checked.cjs');
      expect(texts.verifier.instruction).toContain('run-checked.cjs');
      const pipeKeyword = language === 'ja' ? 'パイプ' : 'pipe';
      expect(texts.implementer.constraints).toContain(pipeKeyword);
      expect(texts.verifier.instruction).toContain(pipeKeyword);
    },
  );
});

describe('plan-phase question-firing criteria + kind guidance (task 965)', () => {
  test.each(['ja', 'en'] as const)(
    'planner instruction includes the firing criteria and kind guidance for %s',
    (language) => {
      const texts = buildRoleTexts(965, { title: 'Probe', description: null }, language);
      const roundKeyword = language === 'ja' ? '1ラウンド' : 'ONE round';
      const incompatibleKeyword = language === 'ja' ? '互換不能' : 'incompatible';
      expect(texts.planner.instruction).toContain(roundKeyword);
      expect(texts.planner.instruction).toContain(incompatibleKeyword);
      expect(texts.planner.instruction).toContain('execution_continuation');
      expect(texts.planner.instruction).toContain('completion_confirmation');
    },
  );
});

describe('planner completion-criteria verifiability guidance (task 933)', () => {
  test('is included in the ja planner instruction', () => {
    const texts = buildRoleTexts(933, { title: 'Probe', description: null }, 'ja');
    expect(texts.planner.instruction).toContain('許可されたツール操作');
    expect(texts.planner.instruction).toContain('本番相当環境での実測');
  });

  test('is included in the en planner instruction', () => {
    const texts = buildRoleTexts(933, { title: 'Probe', description: null }, 'en');
    expect(texts.planner.instruction).toContain('permitted to run');
    expect(texts.planner.instruction).toContain('production-equivalent environment');
  });
});

describe('ad-hoc verification script prohibition (task 1111)', () => {
  test.each(['ja', 'en'] as const)(
    'implementer constraints steer pure-function checks toward *.test.ts for %s',
    (language) => {
      const texts = buildRoleTexts(1111, { title: 'Probe', description: null }, language);
      const adHocKeyword =
        language === 'ja' ? 'アドホックな検証スクリプト' : 'ad-hoc verification scripts';
      const existingTestKeyword =
        language === 'ja' ? '既存の `*.test.ts`' : 'existing or new `*.test.ts`';
      expect(texts.implementer.constraints).toContain(adHocKeyword);
      expect(texts.implementer.constraints).toContain(existingTestKeyword);
      expect(texts.implementer.constraints).toContain('bun test --isolate');
    },
  );
});

describe('primary checkout guidance wiring (task 1116)', () => {
  test.each(['ja', 'en'] as const)('is appended to implementer and verifier for %s', (language) => {
    const texts = buildRoleTexts(1116, { title: 'Probe', description: null }, language);
    expect(texts.implementer.constraints).toContain('git -C <primary>');
    expect(texts.implementer.constraints).toContain('git branch --show-current');
    expect(texts.verifier.instruction).toContain('git -C <primary>');
    expect(texts.implementer.constraints).toContain('PID');
  });
});

// Task 1582: run 7975 started Monitor, wrote "waiting for runId 94d7787b…" and
// ended its turn; under `--print` nothing wakes it, so the run counted as done
// before the verdict. The implementer must wait in the foreground instead.
describe('self-verification is awaited in the foreground (task 1582)', () => {
  const expectations = {
    ja: [
      'Monitor',
      'ScheduleWakeup',
      'run_in_background',
      'Start-Process',
      '--print',
      '10秒',
      '最大90回',
      '900秒',
      '`status` が `running` の間は番を終えない',
      '未確定',
    ],
    en: [
      'Monitor',
      'ScheduleWakeup',
      'run_in_background',
      'Start-Process',
      '--print',
      '10 seconds',
      'up to 90 times',
      '900 seconds',
      'do not end your turn while `status` is `running`',
      'unconfirmed',
    ],
  } as const;

  test.each(['ja', 'en'] as const)(
    'the %s implementer constraints carry the procedure',
    (language) => {
      const texts = buildRoleTexts(1582, { title: 'Probe', description: null }, language);
      for (const phrase of expectations[language]) {
        expect(texts.implementer.constraints).toContain(phrase);
      }
      expect(texts.implementer.constraints).toContain(
        'http://127.0.0.1:3001/workflow/tasks/1582/run-verification',
      );
    },
  );

  test.each(['ja', 'en'] as const)(
    'the %s constraints no longer tell the agent to poll every 20 seconds',
    (language) => {
      const texts = buildRoleTexts(1582, { title: 'Probe', description: null }, language);
      expect(texts.implementer.constraints).not.toContain(
        language === 'ja' ? '20秒間隔' : 'every 20 seconds',
      );
    },
  );

  test('the prompt types stay importable from workflow-role-prompts', async () => {
    const mod = await import('./workflow-role-prompt-types');
    expect(typeof mod).toBe('object');
  });
});
