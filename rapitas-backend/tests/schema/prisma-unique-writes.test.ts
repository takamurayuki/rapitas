/**
 * prisma-unique-writes
 *
 * Every Prisma call whose `where` must identify exactly one row must name a
 * unique constraint the schema actually declares.
 *
 * This exists because making a constraint workspace-aware silently breaks
 * every call site that keyed on the old one. `@unique` on `WorkflowModeConfig.mode`
 * became `@@unique([workspaceId, mode])`, and `where: { mode }` stopped being a
 * legal `WhereUniqueInput` — but only `tsc` run against a FRESHLY GENERATED
 * client says so, and this repository forbids running `prisma generate` by
 * hand (CLAUDE.md §1), so the breakage is invisible locally and surfaces as a
 * red `Lint Code` job after the push. It did: 10 call sites in 6 files.
 *
 * Reading the `.prisma` files directly gives the same answer without a client.
 * Checked against that CI run, this scan reproduced exactly those 10 and
 * nothing else.
 *
 * NOT responsible for whether a query is SCOPED to a workspace — that is
 * workspace-scope's enumeration. This only asks whether the key can identify
 * one row at all.
 */
import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const BACKEND_DIR = dirname(dirname(import.meta.dir));
const SCHEMA_DIR = join(BACKEND_DIR, 'prisma', 'schema');

/**
 * The operations whose `where` is a `WhereUniqueInput`.
 *
 * `updateMany` / `deleteMany` / `findFirst` / `findMany` take a plain filter
 * and are deliberately absent — a non-unique key is correct for them.
 */
const UNIQUE_WHERE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'upsert', 'delete']);

/** Receivers that are a Prisma client: `prisma`, a `$transaction` handle, a DI'd one. */
const CLIENT_RECEIVER = /\b(?:prisma|tx|client|db)\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g;

/** Directories holding no shipping source. */
const SKIP_DIRS = new Set(['node_modules', 'generated', '.git', 'dist', 'coverage', '.data']);

interface CallSite {
  file: string;
  line: number;
  model: string;
  op: string;
  keys: string[];
}

/** Every unique key set the schema declares, keyed by model name. */
function loadUniqueSets(): Map<string, string[][]> {
  const byModel = new Map<string, string[][]>();
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'))) {
    const text = readFileSync(join(SCHEMA_DIR, file), 'utf8');
    const models = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    let found: RegExpExecArray | null;
    while ((found = models.exec(text)) !== null) {
      const [, model, body] = found;
      const sets: string[][] = [];
      for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('//')) continue;
        const field = line.match(/^(\w+)\s+\S/);
        if (field !== null && /@(?:id|unique)\b/.test(line)) sets.push([field[1]]);
        const compound = line.match(/^@@(?:unique|id)\(\s*\[([^\]]+)\]/);
        if (compound !== null) sets.push(compound[1].split(',').map((f) => f.trim()));
      }
      byModel.set(model, sets);
    }
  }
  return byModel;
}

/** Every shipping `.ts` file under the backend. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(full, out);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
    out.push(full);
  }
  return out;
}

/**
 * The balanced-brace object literal that starts at `text[open]`.
 *
 * @param text - Source to read / 読み取る原文
 * @param open - Index of the opening brace / 開き波括弧の位置
 * @returns Its source text, or null if unbalanced / その原文、閉じなければnull
 */
function balanced(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * The top-level property names of an object literal's source text.
 *
 * Nested objects are skipped by depth, so `{ a: { b: 1 } }` yields `['a']` —
 * which matters because a compound key's value is itself an object.
 *
 * @param objectText - Source of the literal, braces included / 波括弧を含む原文
 * @returns Its top-level keys / トップレベルのキー
 */
function topLevelKeys(objectText: string): string[] {
  const inner = objectText.slice(1, -1);
  const keys: string[] = [];
  let depth = 0;
  let atKey = true;
  let buffer = '';
  for (const char of inner) {
    if (char === '{' || char === '[' || char === '(') depth++;
    else if (char === '}' || char === ']' || char === ')') depth--;
    if (depth === 0 && char === ',') {
      atKey = true;
      buffer = '';
      continue;
    }
    if (depth === 0 && char === ':') {
      if (atKey) keys.push(buffer.trim());
      atKey = false;
      buffer = '';
      continue;
    }
    if (atKey) buffer += char;
  }
  // A shorthand property (`{ id }`) never hits a colon, so it is left over.
  if (atKey && buffer.trim() !== '') keys.push(buffer.trim());
  return keys.filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
}

interface Scan {
  sites: CallSite[];
  /** Calls whose argument is not a literal, so the key set is unknowable here. */
  indirect: number;
}

/** Every unique-where call site whose `where` is a literal object. */
function scanCallSites(delegates: Map<string, string>): Scan {
  const sites: CallSite[] = [];
  let indirect = 0;
  for (const file of sourceFiles(BACKEND_DIR)) {
    const text = readFileSync(file, 'utf8');
    CLIENT_RECEIVER.lastIndex = 0;
    let call: RegExpExecArray | null;
    while ((call = CLIENT_RECEIVER.exec(text)) !== null) {
      const [matched, delegate, op] = call;
      if (!UNIQUE_WHERE_OPS.has(op)) continue;
      const model = delegates.get(delegate);
      if (model === undefined) continue;

      // The argument has to be a literal starting right here. Searching ahead
      // for the next `{` would read a LATER call's where clause instead.
      let at = call.index + matched.length;
      while (at < text.length && /\s/.test(text[at])) at++;
      if (text[at] !== '{') {
        indirect++;
        continue;
      }
      const args = balanced(text, at);
      const where = args?.match(/\bwhere\s*:\s*\{/) ?? null;
      if (args === null || where === null || where.index === undefined) {
        indirect++;
        continue;
      }
      const whereObject = balanced(args, args.indexOf('{', where.index + where[0].length - 1));
      if (whereObject === null) {
        indirect++;
        continue;
      }
      sites.push({
        file: relative(BACKEND_DIR, file).replace(/\\/g, '/'),
        line: text.slice(0, call.index).split('\n').length,
        model,
        op,
        keys: topLevelKeys(whereObject),
      });
    }
  }
  return { sites, indirect };
}

const uniqueSets = loadUniqueSets();
const delegates = new Map(
  [...uniqueSets.keys()].map((m) => [m.charAt(0).toLowerCase() + m.slice(1), m]),
);
const { sites, indirect } = scanCallSites(delegates);

/**
 * Whether these keys pin down one row.
 *
 * Prisma names a compound unique by joining its fields with `_`, so the single
 * key `workspaceId_mode` satisfies the set `[workspaceId, mode]`. Extra keys
 * are fine (`extendedWhereUnique` allows filters alongside the identifier);
 * what matters is that one declared set is fully covered.
 */
function identifiesOneRow(site: CallSite): boolean {
  const keys = new Set(site.keys);
  const sets = uniqueSets.get(site.model) ?? [];
  return sets.some((set) => set.every((f) => keys.has(f)) || keys.has(set.join('_')));
}

describe('a Prisma write that must identify one row', () => {
  it('always names a unique constraint the schema declares', () => {
    const broken = sites.filter((s) => !identifiesOneRow(s));
    // Printed in full: the failure is a list of edits, and a bare count would
    // send the next reader back to a CI log to find out which.
    expect(
      broken.map(
        (s) =>
          `${s.file}:${s.line} ${s.model}.${s.op} where{${s.keys.join(',')}} — ` +
          `unique: ${(uniqueSets.get(s.model) ?? []).map((u) => u.join('+')).join(' | ')}`,
      ),
    ).toEqual([]);
  });
});

describe('the scan itself', () => {
  // A scan that silently matches nothing is the failure mode this whole file
  // guards against, so its own reach is pinned (docs/lessons/gates-that-do-not-measure.md).
  it('read the schema', () => {
    expect(uniqueSets.size).toBeGreaterThan(80);
    expect([...uniqueSets.values()].filter((s) => s.length > 1).length).toBeGreaterThan(20);
  });

  it('found call sites to check', () => {
    expect(sites.length).toBeGreaterThan(300);
    expect(new Set(sites.map((s) => s.model)).size).toBeGreaterThan(40);
  });

  it('could read nearly every call site, so a pass is not an empty pass', () => {
    // 4 at the time of writing: two `prisma.task.update(updateArgs)` sharing a
    // hoisted literal, and two `client.subscriptions.delete()` on a JS Set.
    expect(indirect).toBeLessThan(12);
  });

  it('accepts the compound-key spelling rather than demanding the fields', () => {
    // Guards the rule that removed 11 false positives: `where: { a_b: {...} }`
    // is how Prisma takes a compound unique, and it must not read as "no key".
    // Counted rather than required of ALL of them, because a site naming a
    // compound that no longer exists is a real violation this must still catch.
    const compound = sites.filter((s) => s.keys.some((k) => k.includes('_')));
    expect(compound.filter((s) => identifiesOneRow(s)).length).toBeGreaterThan(5);
  });
});
