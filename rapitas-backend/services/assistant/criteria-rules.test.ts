/**
 * criteria-rules.test
 *
 * The rules for writing a task's completion criteria (#1545). Each rule is
 * one way tasks kept failing: a criterion the agent cannot reach loops the
 * verify step forever, a bare "does not" is met by doing nothing, a
 * criterion with no way to check it is judged by guesswork, and a report
 * with no "nothing to change" ending stops at the no-diff gate.
 */
import { describe, it, expect } from 'bun:test';
import { CRITERIA_RULES_PROMPT, findCriterionIssues, findSpecIssues } from './criteria-rules';

const codes = (text: string) => findCriterionIssues(text, 'jury').map((i) => i.code);

describe('a criterion the agent cannot reach', () => {
  it.each([
    'CI の Fault Injection E2E が 7/7 成功すること',
    'GitHub Actions がすべて緑になる',
    'PR がマージされた後に本番で動作する',
    'デプロイ後にエラーが出ないこと（確認方法: ログ）',
    'push 後に Lint Code ジョブが通る',
  ])('flags %s', (text) => {
    expect(codes(text)).toContain('unreachable');
  });

  it('leaves a local check alone', () => {
    expect(codes('`bun test services/x.test.ts` が通る')).not.toContain('unreachable');
  });
});

describe('a criterion that only says what must not happen', () => {
  it.each(['エラーを表示しないこと', 'スクロールバーが出ない', '既存の API を壊さない'])(
    'flags %s',
    (text) => {
      expect(codes(text)).toContain('negation_only');
    },
  );

  it('accepts a "does not" paired with what happens instead', () => {
    expect(codes('空の一覧ではエラーを出さず、「タスクはありません」と表示する')).not.toContain(
      'negation_only',
    );
  });
});

describe('a criterion with no way to check it', () => {
  it('flags a sentence that names no test, command, file or observable result', () => {
    expect(codes('検索機能を実装する')).toContain('no_check_method');
  });

  it.each([
    'src/app/globals.css の --color-green-500 が oklch(69.6% 0.17 162.48) になる',
    'task-list.test.ts の新しいテストが通る',
    'GET /tasks?q=abc が該当タスクだけを返す',
    '確認方法: `bunx tsc --noEmit` がエラー 0 で終わる',
    '10件表示でも一覧の高さが 980px 以下になる',
  ])('accepts %s', (text) => {
    expect(codes(text)).not.toContain('no_check_method');
  });
});

describe('what only the person checks', () => {
  // The person's checks go to userAcceptanceChecks; none of these rules,
  // which are about what an agent can verify, apply to them.
  it('raises nothing for a criterion the person checks', () => {
    expect(findCriterionIssues('実際に使ってみて迷わない', 'user')).toEqual([]);
  });
});

describe('each issue', () => {
  it('says how to rewrite the criterion', () => {
    for (const issue of findCriterionIssues('CI が通ること', 'jury')) {
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.suggestion.length).toBeGreaterThan(0);
    }
  });
});

describe('a task whose deliverable is a report', () => {
  it('asks for a "nothing to change" ending when none is written', () => {
    const issues = findSpecIssues({
      title: 'ログイン処理のセキュリティを監査する',
      description: null,
      acceptanceCriteria: ['監査結果を docs/audit.md にまとめる'],
    });
    expect(issues.map((i) => i.code)).toContain('no_unchanged_route');
  });

  it('is satisfied once that ending is written', () => {
    const issues = findSpecIssues({
      title: 'ログイン処理のセキュリティを監査する',
      description: null,
      acceptanceCriteria: [
        '監査結果を docs/audit.md にまとめる',
        '問題がなければ「修正不要」と根拠を verify.md に書く',
      ],
    });
    expect(issues.map((i) => i.code)).not.toContain('no_unchanged_route');
  });

  it('does not ask it of a task that builds something', () => {
    const issues = findSpecIssues({
      title: '検索ボックスを追加する',
      description: null,
      acceptanceCriteria: ['GET /tasks?q= が該当タスクを返す'],
    });
    expect(issues).toEqual([]);
  });
});

describe('what the model is told', () => {
  // The same rules, in the prompts that write criteria, so a draft starts
  // out following them rather than being flagged afterwards.
  it('states every rule', () => {
    for (const word of ['CI', 'マージ', '確認方法', 'しない', '変更不要']) {
      expect(CRITERIA_RULES_PROMPT).toContain(word);
    }
  });
});
