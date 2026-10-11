/**
 * project-manifests.test
 *
 * Run against real temp directories: the behaviour under test is what is on
 * disk, which a mocked fs would only restate.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectManifests,
  fingerprintManifests,
  installInvocation,
  resolveInstallCommand,
} from './project-manifests';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-manifests-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const put = (rel: string, body: string) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
};

describe('resolveInstallCommand', () => {
  it('follows the lockfile when one exists', () => {
    put('package.json', '{}');
    put('pnpm-lock.yaml', '');
    expect(resolveInstallCommand(dir)).toBe('pnpm install');
  });

  it('falls back to the packageManager field before any lockfile exists', () => {
    put('package.json', JSON.stringify({ packageManager: 'yarn@4.5.0' }));
    expect(resolveInstallCommand(dir)).toBe('yarn install');
  });

  it('infers pnpm from a workspace file when nothing else says', () => {
    // A freshly scaffolded monorepo: no lockfile yet, which is when this runs.
    put('package.json', '{}');
    put('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    expect(resolveInstallCommand(dir)).toBe('pnpm install');
  });

  it('defaults to npm for a plain single-package project', () => {
    put('package.json', '{}');
    expect(resolveInstallCommand(dir)).toBe('npm install');
  });

  it('ignores an unreadable manifest instead of throwing', () => {
    put('package.json', '{ this is not json');
    expect(resolveInstallCommand(dir)).toBe('npm install');
  });
});

describe('installInvocation', () => {
  it('downgrades the pnpm ignored-builds error to a warning', () => {
    // pnpm 11+ exits non-zero on ignored build scripts even when node_modules
    // and the lockfile were written. Measured 2026-10-08: TempoRaid's install
    // completed, exited 1 over ten ignored builds, so the fingerprint was never
    // written and every agent launch re-installed.
    expect(installInvocation('pnpm install')).toBe('pnpm install --config.strict-dep-builds=false');
  });

  it('leaves the other package managers untouched', () => {
    for (const c of ['npm install', 'yarn install', 'bun install']) {
      expect(installInvocation(c)).toBe(c);
    }
  });
});

describe('collectManifests', () => {
  it('finds root files and every workspace package.json', () => {
    put('package.json', '{}');
    put('pnpm-workspace.yaml', '');
    put('apps/web/package.json', '{}');
    put('apps/server/package.json', '{}');
    put('packages/core/package.json', '{}');
    expect(collectManifests(dir)).toEqual([
      'apps/server/package.json',
      'apps/web/package.json',
      'package.json',
      'packages/core/package.json',
      'pnpm-workspace.yaml',
    ]);
  });

  it('never descends into node_modules or build output', () => {
    put('package.json', '{}');
    put('node_modules/zod/package.json', '{}');
    put('dist/package.json', '{}');
    expect(collectManifests(dir)).toEqual(['package.json']);
  });

  it('returns nothing for a repo that only has docs', () => {
    // ContextFlow's state when task 1152 blocked: docs + .claude only.
    put('docs/design.md', '# design');
    put('.claude/CLAUDE.md', '# guide');
    expect(collectManifests(dir)).toEqual([]);
  });
});

describe('fingerprintManifests', () => {
  const setup = () => {
    put('package.json', JSON.stringify({ dependencies: { zod: '^3' } }));
    put('apps/web/package.json', '{}');
    return collectManifests(dir);
  };

  it('is stable when nothing changed', () => {
    const m = setup();
    expect(fingerprintManifests(dir, m)).toBe(fingerprintManifests(dir, m));
  });

  it('changes when a dependency is added — the trigger for a re-install', () => {
    const m = setup();
    const before = fingerprintManifests(dir, m);
    put('package.json', JSON.stringify({ dependencies: { zod: '^3', pino: '^9' } }));
    expect(fingerprintManifests(dir, m)).not.toBe(before);
  });

  it('changes when a new workspace package appears', () => {
    const before = fingerprintManifests(dir, setup());
    put('packages/core/package.json', '{}');
    expect(fingerprintManifests(dir, collectManifests(dir))).not.toBe(before);
  });

  it('is empty when there is no manifest, so no install is attempted', () => {
    expect(fingerprintManifests(dir, [])).toBe('');
  });
});
