/**
 * eval-set-isolation.test
 *
 * Static guard: services/self-learning/ (the autonomous learning loop — KB
 * graph, prompt evolution, episode memory) must never reference
 * eval/private-set, so the private evaluation set can't leak into the
 * learning inputs it is supposed to measure (docs/eval-private-set.md).
 */
import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';

const SELF_FILE = basename(import.meta.path);

const SELF_LEARNING_DIR = resolve(import.meta.dir, '..');
const FORBIDDEN_PATTERN = /eval[/\\]private-set/i;

function listSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...listSourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) results.push(full);
  }
  return results;
}

describe('eval-set isolation', () => {
  it('services/self-learning does not reference eval/private-set', () => {
    const files = listSourceFiles(SELF_LEARNING_DIR).filter((f) => basename(f) !== SELF_FILE);
    const offenders: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (FORBIDDEN_PATTERN.test(content)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
