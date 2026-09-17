// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const frontendRoot = path.resolve(__dirname, '..', '..');

function readPackageJson(): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  pnpm?: unknown;
} {
  return JSON.parse(readFileSync(path.join(frontendRoot, 'package.json'), 'utf8'));
}

function readWorkspaceOverrides(): Record<string, string> {
  const raw = readFileSync(path.join(frontendRoot, 'pnpm-workspace.yaml'), 'utf8');
  const overridesBlockMatch = raw.match(/^overrides:\n((?:[ \t].*\n?)*)/m);
  const overrides: Record<string, string> = {};
  if (!overridesBlockMatch) return overrides;
  for (const line of overridesBlockMatch[1].split('\n')) {
    const match = line.match(/^\s+(\S+):\s+(\S+)\s*$/);
    if (match) overrides[match[1]] = match[2];
  }
  return overrides;
}

test('package.json does not declare a "pnpm" config block while pnpm-workspace.yaml exists', () => {
  // pnpm v10 (used by the "Update Lockfiles" CI job) rejects overrides/etc. declared
  // in package.json once a pnpm-workspace.yaml root file is present, with
  // ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Regression for task #957.
  const pkg = readPackageJson();
  expect(pkg.pnpm).toBeUndefined();
});

test('plain-name pnpm-workspace.yaml overrides stay in sync with the matching direct dependency specifier', () => {
  // A plain override (no "@range" suffix) for a package that is also a direct
  // dependency must match the direct specifier, or pnpm v10's frozen-lockfile
  // install fails with ERR_PNPM_OUTDATED_LOCKFILE ("specifiers in the lockfile
  // don't match specifiers in package.json"). Regression for task #957.
  const pkg = readPackageJson();
  const directDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const overrides = readWorkspaceOverrides();

  for (const [name, overrideSpecifier] of Object.entries(overrides)) {
    if (name.includes('@')) continue; // range-scoped override, not a plain package override
    const directSpecifier = directDeps[name];
    if (directSpecifier === undefined) continue;
    expect(overrideSpecifier).toBe(directSpecifier);
  }
});
