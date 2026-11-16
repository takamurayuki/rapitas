/**
 * literal-message-keys.test
 *
 * Fails when source calls `t('key')` with a literal key that the generated
 * locale bundle does not contain. next-intl renders a missing key as the raw
 * dotted path, and component tests mock `useTranslations` with an echo, so
 * nothing else catches it (task #1291's audit found 12 raw keys on
 * /agents/supervision this way).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

const DECL =
  /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*['"]([\w.]+)['"]\s*\)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function hasPath(messages: unknown, dotted: string): boolean {
  let node: unknown = messages;
  for (const key of dotted.split('.')) {
    if (node === null || typeof node !== 'object' || !(key in node)) return false;
    node = (node as Record<string, unknown>)[key];
  }
  return true;
}

/**
 * Lists `namespace.key` paths used with a literal key but absent from the bundle.
 *
 * @param messages - Parsed locale bundle / ロケールのメッセージ
 * @returns Missing paths prefixed by file / 欠落しているキーの一覧
 */
function missingKeys(messages: unknown): string[] {
  const missing = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    const decls = [...src.matchAll(DECL)].map((m) => ({ at: m.index ?? 0, name: m[1], ns: m[2] }));
    for (const name of new Set(decls.map((d) => d.name))) {
      const call = new RegExp(
        `(?<![\\w.])${name}(?:\\.rich|\\.raw|\\.markup)?\\(\\s*['"]([\\w.]+)['"]`,
        'g',
      );
      for (const m of src.matchAll(call)) {
        // A file can declare the same name in several components; the nearest
        // declaration above the call is the one in scope.
        const owner = decls.filter((d) => d.name === name && d.at < (m.index ?? 0)).at(-1);
        if (owner && !hasPath(messages, `${owner.ns}.${m[1]}`)) {
          missing.add(`${relative(ROOT, file)}: ${owner.ns}.${m[1]}`);
        }
      }
    }
  }
  return [...missing].sort();
}

describe('literal translation keys', () => {
  it.each(['ja', 'en'])('every literal key exists in %s.json', (locale) => {
    const messages: unknown = JSON.parse(
      readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf8'),
    );
    expect(missingKeys(messages)).toEqual([]);
  });
});
