/**
 * log-patterns-table tests
 *
 * Exercises getLogPatterns(t) directly with a stub translator, covering rules
 * not already exercised indirectly via log-message-transformer.test.ts
 * (Codex/Gemini lifecycle details, tool-call sub-cases, result/test-count
 * lines, git output, and status markers).
 */
import { getLogPatterns, HIDDEN_PATTERNS } from '../log-patterns-table';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

function classify(log: string) {
  const patterns = getLogPatterns(t);
  for (const rule of patterns) {
    const match = log.match(rule.pattern);
    if (match) return rule.transform(log, match);
  }
  return null;
}

describe('getLogPatterns', () => {
  test('phase markers map to the correct phase and icon', () => {
    expect(classify('[research] foo')).toMatchObject({
      category: 'progress',
      phase: 'research',
      iconName: 'Search',
    });
    expect(classify('[plan] foo')).toMatchObject({ phase: 'plan', iconName: 'ClipboardList' });
    expect(classify('[implement] foo')).toMatchObject({
      phase: 'implement',
      iconName: 'Code',
    });
    expect(classify('[verify] foo')).toMatchObject({ phase: 'verify', iconName: 'ShieldCheck' });
  });

  test('file_edit and file_create map basename/name correctly', () => {
    const edit = classify('file_edit src/deep/nested/Button.tsx');
    expect(edit).toMatchObject({ category: 'info', iconName: 'FileEdit' });
    expect(edit!.detail).toBe('src/deep/nested/Button.tsx');
    expect(edit!.message).toContain('Button.tsx');

    const create = classify('file_create new.ts');
    expect(create!.category).toBe('success');
  });

  test('[実行開始] shows the raw captured text verbatim (not translated)', () => {
    const r = classify('[実行開始] タスクを開始します');
    expect(r).toMatchObject({ category: 'phase-transition', iconName: 'Play' });
    expect(r!.message).toBe('タスクを開始します');
  });

  test('[エージェント] wraps text via the translator', () => {
    const r = classify('[エージェント] 作業中');
    expect(r!.message).toBe('agentPrefix:{"text":"作業中"}');
  });

  test('[継続実行] and [System: init] and [System Error: ...]', () => {
    expect(classify('[継続実行]')).toMatchObject({ category: 'phase-transition' });
    expect(classify('[System: init]')).toMatchObject({ category: 'progress', iconName: 'Loader' });
    const sysErr = classify('[System Error: disk full]');
    expect(sysErr).toMatchObject({ category: 'error', iconName: 'AlertCircle' });
    expect(sysErr!.message).toContain('disk full');
  });

  test('provider lifecycle lines: starting, working directory, PID, timeout, prompt, timed out, error', () => {
    expect(classify('[Codex] Starting execution')).toMatchObject({
      category: 'phase-transition',
      iconName: 'Play',
    });
    const wd = classify('[Gemini] Working directory: C:\\Projects\\rapitas\\backend');
    expect(wd!.message).toContain('backend');
    expect(wd!.detail).toBe('C:\\Projects\\rapitas\\backend');

    const pid = classify('[Claude Code] Process PID: 12345');
    expect(pid!.message).toContain('12345');

    const timeout = classify('[Codex] Timeout: 30 minutes');
    expect(timeout!.message).toContain('30 minutes');

    const shortPrompt = classify('[Claude] Prompt: do the thing');
    expect(shortPrompt!.category).toBe('agent-text');
    expect(shortPrompt!.detail).toBeUndefined();

    const longText = 'x'.repeat(150);
    const longPrompt = classify(`[Claude] Prompt: ${longText}`);
    expect(longPrompt!.detail).toBe(longText);
    expect(longPrompt!.message).toContain('...');

    const timedOut = classify('[Gemini] Execution timed out (no output)');
    expect(timedOut).toMatchObject({ category: 'error', iconName: 'Timer' });

    const shortErr = classify('[Codex] Error: boom');
    expect(shortErr!.detail).toBeUndefined();
    const longErrText = 'e'.repeat(150);
    const longErr = classify(`[Codex] Error: ${longErrText}`);
    expect(longErr!.detail).toBe(longErrText);
  });

  test('[Result: ...] maps success and failure outcomes, ignores cost token', () => {
    const ok = classify('[Result: completed (12.3s) $0.0421]');
    expect(ok).toMatchObject({ category: 'success', iconName: 'CheckCircle' });
    expect(ok!.message).toContain('12.3s');
    expect(ok!.message).not.toContain('0.0421');

    const fail = classify('[Result: failed]');
    expect(fail).toMatchObject({ category: 'error', iconName: 'XCircle' });
  });

  test('Tool: Read/Edit/Write map to expected category+icon', () => {
    expect(classify('[Tool: Read] -> a.ts')).toMatchObject({
      category: 'info',
      iconName: 'FileSearch',
    });
    expect(classify('[Tool: Edit] -> b.ts')).toMatchObject({
      category: 'info',
      iconName: 'FileEdit',
    });
    expect(classify('[Tool: Write] -> c.ts')).toMatchObject({
      category: 'success',
      iconName: 'FilePlus',
    });
  });

  test('[Command] sub-cases: test, verify, commit, push, git, search, generic shell', () => {
    expect(classify('[Command] bun test --run')).toMatchObject({
      category: 'progress',
      iconName: 'TestTube',
    });
    expect(classify('[Command] tsc --noEmit')).toMatchObject({
      category: 'progress',
      iconName: 'ShieldCheck',
    });
    expect(classify('[Command] git commit -m "x"')).toMatchObject({
      category: 'info',
      iconName: 'GitCommitHorizontal',
    });
    expect(classify('[Command] git push origin main')).toMatchObject({
      category: 'info',
      iconName: 'Upload',
    });
    expect(classify('[Command] git status')).toMatchObject({
      category: 'info',
      iconName: 'GitBranch',
    });
    expect(classify('[Command] rg "pattern" src')).toMatchObject({
      category: 'info',
      iconName: 'Search',
    });
    const generic = classify('[Command] node scripts/setup.js');
    expect(generic).toMatchObject({ category: 'info', iconName: 'Terminal' });

    const longCmd = classify(`[Command] ${'a'.repeat(90)}`);
    expect(longCmd!.detail).toBeDefined();
    expect(longCmd!.message).toContain('...');
  });

  test('[Tool: Bash] $ sub-cases', () => {
    expect(classify('[Tool: Bash] $ bun test')).toMatchObject({
      category: 'progress',
      iconName: 'FlaskConical',
    });
    expect(classify('[Tool: Bash] $ git commit -m "x"')).toMatchObject({
      iconName: 'GitCommitHorizontal',
    });
    expect(classify('[Tool: Bash] $ git push')).toMatchObject({ iconName: 'Upload' });
    expect(classify('[Tool: Bash] $ git log')).toMatchObject({ iconName: 'GitBranch' });
    const longCmd = classify(`[Tool: Bash] $ ${'b'.repeat(80)}`);
    expect(longCmd!.detail).toBeDefined();
  });

  test('Glob/Grep, WebSearch, WebFetch, sub-Agent tool calls', () => {
    const glob = classify('[Tool: Glob] pattern: **/*.ts');
    expect(glob!.message).toContain('**/*.ts');

    const web = classify('[Tool: WebSearch] "claude api pricing"');
    expect(web!.message).toContain('claude api pricing');

    const fetch = classify('[Tool: WebFetch] -> https://example.com');
    expect(fetch!.message).toContain('https://example.com');

    const agent = classify('[Tool: Agent] researching things');
    expect(agent!.category).toBe('progress');

    // No captured text -> falls back to t('subAgentStarting') as the {text} param.
    const agentEmpty = classify('[Tool: Agent] ');
    expect(agentEmpty!.message).toContain('subAgentStarting');
  });

  test('generic Tool fallback parses JSON body, array body, [object Object], and plain text', () => {
    const arrBody = classify('[Tool: Multi] [1,2,3]');
    expect(arrBody!.message).toContain('Multi');
    expect(arrBody!.detail).toBeDefined();

    const objBody = classify('[Tool: Multi] {"a":1}');
    expect(objBody!.detail).toContain('"a": 1');

    const badJson = classify('[Tool: Weird] {not valid json');
    expect(badJson!.message).toContain('Weird');

    const objPlaceholder = classify('[Tool: Foo] [object Object]');
    expect(objPlaceholder!.message).toContain('objectDataPlaceholder');

    const plain = classify('[Tool: Foo] hello world');
    expect(plain!.message).toBe('Foo hello world');
  });

  test('Tool Done / Tool Error (Bash routine vs other tool warning)', () => {
    const done = classify('[Tool Done: Read] (0.2s)');
    expect(done).toMatchObject({ category: 'tool-result' });

    const bashErr = classify('[Tool Error: Bash] (exit 1)');
    expect(bashErr).toMatchObject({ category: 'tool-result' });
    expect(bashErr!.message).toContain('exit 1');

    const otherErr = classify('[Tool Error: Write] (disk full)');
    expect(otherErr).toMatchObject({ category: 'warning', iconName: 'AlertTriangle' });
  });

  test('question and warning markers truncate long text', () => {
    const q = classify('[質問] どちらを選びますか？');
    expect(q).toMatchObject({ category: 'warning', iconName: 'HelpCircle' });

    const longQ = classify(`[質問] ${'q'.repeat(150)}`);
    expect(longQ!.detail).toBeDefined();

    const warn = classify('[警告] 注意してください');
    expect(warn).toMatchObject({ category: 'warning', iconName: 'AlertTriangle' });
  });

  test('test pass/fail counts and typecheck marker', () => {
    expect(classify('12 tests passed')).toMatchObject({
      category: 'success',
      iconName: 'CheckCircle',
    });
    expect(classify('3 failed')).toMatchObject({ category: 'error', iconName: 'XCircle' });
    expect(classify('running tsc --noEmit now')).toMatchObject({
      category: 'progress',
      iconName: 'ShieldCheck',
    });
  });

  test('git commit output line and push completion', () => {
    const commitLine = classify('[main abc1234] fix the thing');
    expect(commitLine).toMatchObject({ category: 'success', iconName: 'GitCommitHorizontal' });
    expect(commitLine!.message).toContain('fix the thing');

    const pushed = classify('To https://github.com/user/repo.git');
    expect(pushed).toMatchObject({ category: 'success', iconName: 'Upload' });
  });

  test('WAITING and TIMEOUT status markers', () => {
    expect(classify('[WAITING]')).toMatchObject({ category: 'warning', iconName: 'Clock' });
    expect(classify('[TIMEOUT]')).toMatchObject({ category: 'error', iconName: 'Timer' });
  });

  test('returns null for a line matching no rule', () => {
    expect(classify('this matches absolutely nothing in the table')).toBeNull();
  });
});

describe('HIDDEN_PATTERNS', () => {
  test('matches noise lines (blank, JSON-ish braces, diff hunks, code page banner)', () => {
    expect(HIDDEN_PATTERNS.some((p) => p.test(''))).toBe(true);
    expect(HIDDEN_PATTERNS.some((p) => p.test('   '))).toBe(true);
    expect(HIDDEN_PATTERNS.some((p) => p.test('{}'))).toBe(true);
    expect(HIDDEN_PATTERNS.some((p) => p.test('Active code page: 65001'))).toBe(true);
    expect(HIDDEN_PATTERNS.some((p) => p.test('@@ -1,3 +1,4 @@'))).toBe(true);
    expect(HIDDEN_PATTERNS.some((p) => p.test('diff --git a/x b/x'))).toBe(true);
    expect(HIDDEN_PATTERNS.some((p) => p.test('const x = 1;'))).toBe(true);
  });

  test('does not match ordinary human-readable log text', () => {
    expect(HIDDEN_PATTERNS.some((p) => p.test('タスクを開始しました'))).toBe(false);
    expect(HIDDEN_PATTERNS.some((p) => p.test('5 tests passed'))).toBe(false);
  });
});
