/**
 * no-task-link-without-header.test.mjs
 *
 * Unit tests for the no-task-link-without-header ESLint rule.
 *
 * The two halves that matter: it catches the real mistake (a navigation to
 * `/tasks/<id>` with no `showHeader`), and it leaves the REST path alone —
 * `/tasks/${id}` is also how every `fetch` in the app addresses a task, so a
 * rule that judged by the string would flag hundreds of correct lines.
 *
 * Strategy mirrors the other rules here: `Linter.verify()` inside each `it()`,
 * because `RuleTester.run()` calls `describe()` which bun:test forbids there.
 */

import { describe, expect, it } from 'bun:test';
import { Linter } from 'eslint';
import rule from './no-task-link-without-header.mjs';

/**
 * Runs the rule against `code` and returns the lint messages.
 *
 * @param {string} code - source to lint / 対象ソース
 * @returns {import('eslint').Linter.LintMessage[]} messages
 */
function runRule(code) {
  const linter = new Linter();
  return linter.verify(code, {
    plugins: { local: { rules: { 'no-task-link-without-header': rule } } },
    rules: { 'local/no-task-link-without-header': 'error' },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });
}

/** Assert the rule fired exactly once. */
function expectOne(code) {
  const msgs = runRule(code);
  expect(msgs.map((m) => m.message)).toHaveLength(1);
  expect(msgs[0].messageId).toBe('missingShowHeader');
}

/** Assert the rule stayed quiet. */
function expectNone(code) {
  expect(runRule(code).map((m) => m.message)).toEqual([]);
}

describe('catches a navigation that drops the header', () => {
  // The defect this was written for: #1092, the note split view.
  it('router.push with a note query', () => {
    expectOne('router.push(`/tasks/${taskId}?note=${note.id}`);');
  });

  it('router.push with a bare task link', () => {
    expectOne('router.push(`/tasks/${taskId}`);');
  });

  it('router.replace', () => {
    expectOne('router.replace(`/tasks/${id}`);');
  });

  it('a JSX href expression', () => {
    expectOne('const a = <a href={`/tasks/${id}`}>x</a>;');
  });

  it('a JSX href string', () => {
    expectOne('const a = <Link href="/tasks/684">x</Link>;');
  });

  it('a link passed as an object property', () => {
    expectOne("invoke('toast_navigate', { link: `/tasks/${taskId}` });");
  });

  it('an assignment to location.href', () => {
    expectOne('window.location.href = `/tasks/${data.taskId}`;');
  });

  // `/tasks/detail?id=` is the Tauri spelling of the same page.
  it('the query-parameter spelling of the detail page', () => {
    expectOne('router.push(`/tasks/detail?id=${taskId}`);');
  });
});

describe('accepts a navigation that keeps it', () => {
  it('the flag written out', () => {
    expectNone('router.push(`/tasks/${taskId}?showHeader=true`);');
  });

  it('the flag alongside other parameters', () => {
    expectNone('router.push(`/tasks/${taskId}?showHeader=true&note=${noteId}`);');
  });

  it('the helper', () => {
    expectNone('router.push(withHeaderVisible(`/tasks/${taskId}?note=${note.id}`));');
  });

  it('a JSX href with the flag', () => {
    expectNone('const a = <a href={`/tasks/${id}?showHeader=true`}>x</a>;');
  });
});

/**
 * The half that keeps the rule usable. `/tasks/${id}` is the REST path as
 * well as the route, and the app says it constantly.
 */
describe('leaves data access alone', () => {
  it('a fetch against the API base', () => {
    expectNone('const r = await fetch(`${API_BASE_URL}/tasks/${id}`);');
  });

  it('a relative API path that is not a navigation', () => {
    expectNone('const d = await apiFetch(`/tasks/${resolvedTaskId}`);');
    expectNone('clearApiCache(`/tasks/${taskId}`);');
    expectNone('const paths = ids.map((id) => `/tasks/${id}`);');
  });

  it('a sub-resource, which is not the detail page', () => {
    expectNone('router.push(`/tasks/${id}/subtasks`);');
    expectNone('const r = await fetch(`/tasks/${id}/comments`);');
  });

  it('the new-task route', () => {
    expectNone('router.push(`/tasks/new?themeId=${themeId}`);');
    expectNone('router.push("/tasks/new");');
  });

  it('another route entirely', () => {
    expectNone('router.push(`/themes/${id}`);');
    expectNone('const a = <a href="/notes">x</a>;');
  });

  // `array.push` is not a navigation, however task-shaped its argument.
  it('a push that is not a router', () => {
    expectNone('prefetchPaths.push(`/tasks/${currentTaskId}`);');
  });
});
