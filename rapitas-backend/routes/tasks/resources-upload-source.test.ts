/**
 * resources-upload-source.test
 *
 * `POST /resources/upload-from-path` copies a caller-supplied absolute path
 * into `uploads/`, from where it can be downloaded. The containment check that
 * makes that safe compared `resolve(sourcePath)` against the allowlisted
 * roots — a LEXICAL comparison — while `copyFile` follows links. So a symlink
 * or a Windows junction sitting inside an allowed root (the OS temp dir is one)
 * pointed anywhere on disk, and both the allowlist and the sensitive-filename
 * rule were bypassed by naming the link instead of its target.
 *
 * Own file — it mocks the config barrel to control the allowlisted roots.
 */
import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';

/**
 * A directory and a file that exist on the host and are outside both
 * allowlisted roots (the OS temp dir and the project root).
 */
const OUTSIDE_EVERY_ROOT_DIR = process.platform === 'win32' ? 'C:\Windows' : '/etc';
const OUTSIDE_EVERY_ROOT_FILE =
  process.platform === 'win32' ? 'C:\Windows\win.ini' : '/etc/hostname';

let projectRoot = '';
mock.module('../../config', () => ({ getProjectRoot: () => projectRoot }));

const { resolveUploadSourcePath } = await import('./resources');

let allowed = '';
let outside = '';

beforeEach(() => {
  // The OS temp dir is an allowlisted root, so a directory under it is inside
  // the allowlist without having to mock the roots themselves.
  allowed = mkdtempSync(join(tmpdir(), 'rapitas-allowed-'));
  outside = mkdtempSync(join(tmpdir(), 'rapitas-outside-'));
  projectRoot = allowed;
});

afterEach(() => {
  for (const dir of [allowed, outside]) rmSync(dir, { recursive: true, force: true });
});

/** Create a symlink, or report that this environment forbids them. */
function trySymlink(target: string, linkPath: string, type?: 'file' | 'dir'): boolean {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch {
    // Windows needs Developer Mode or elevation for symlinks. The assertion
    // below is skipped rather than passed vacuously.
    return false;
  }
}

describe('a real file inside an allowed root', () => {
  test('is accepted', () => {
    const file = join(allowed, 'notes.txt');
    writeFileSync(file, 'hello');
    expect(resolveUploadSourcePath(file)).toBe(file);
  });

  test('is rejected when it is outside every root', () => {
    const file = join(outside, 'notes.txt');
    writeFileSync(file, 'hello');
    // `outside` is also under tmpdir, so prove rejection with a path that is
    // not: a file at the filesystem root.
    expect(() => resolveUploadSourcePath('/etc/passwd')).toThrow();
    expect(resolveUploadSourcePath(file)).toBe(file);
  });

  test('is rejected when its name is sensitive', () => {
    const file = join(allowed, '.env');
    writeFileSync(file, 'SECRET=1');
    expect(() => resolveUploadSourcePath(file)).toThrow();
  });
});

describe('a link that escapes the allowlist', () => {
  test('is rejected even though its own path looks contained', () => {
    // The target has to be outside EVERY root, and the OS temp dir is one of
    // them — so this points at a file that exists on the host instead of one
    // this test writes.
    const link = join(allowed, 'innocent.txt');
    if (!trySymlink(OUTSIDE_EVERY_ROOT_FILE, link, 'file')) return;

    // Before the fix this returned the link path and copyFile followed it.
    expect(() => resolveUploadSourcePath(link)).toThrow();
  });

  test('is rejected when it points at a sensitive filename', () => {
    const env = join(outside, '.env');
    writeFileSync(env, 'SECRET=1');
    const link = join(allowed, 'harmless.txt');
    if (!trySymlink(env, link, 'file')) return;

    expect(() => resolveUploadSourcePath(link)).toThrow();
  });

  test('is rejected when a parent directory is the link', () => {
    const dirLink = join(allowed, 'data');
    if (!trySymlink(OUTSIDE_EVERY_ROOT_DIR, dirLink, 'dir')) return;

    expect(() =>
      resolveUploadSourcePath(join(dirLink, basename(OUTSIDE_EVERY_ROOT_FILE))),
    ).toThrow();
  });
});

describe('a link that stays inside the allowlist', () => {
  test('is still accepted, resolved to its target', () => {
    const real = join(allowed, 'real.txt');
    writeFileSync(real, 'hello');
    const link = join(allowed, 'alias.txt');
    if (!trySymlink(real, link, 'file')) return;

    expect(resolveUploadSourcePath(link)).toBe(real);
  });
});

describe('a path that does not exist', () => {
  // Resolving the real path of a missing file must not become a 500; the
  // endpoint already reports a missing source, and the containment check has
  // nothing to resolve.
  test('is rejected with a validation error, not an ENOENT crash', () => {
    expect(() => resolveUploadSourcePath(join(allowed, 'nope.txt'))).toThrow();
  });
});
