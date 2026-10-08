/**
 * scaffold-docs-writer.test
 *
 * Exercises the writer against a real temp directory rather than a mocked fs:
 * the behaviour under test is which files land where, and path/mkdir handling
 * is precisely what a mock would paper over.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeScaffoldDocs } from './scaffold-docs-writer';

let projectPath: string;

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-docs-'));
});

afterEach(() => {
  fs.rmSync(projectPath, { recursive: true, force: true });
});

const read = (rel: string) => fs.readFileSync(path.join(projectPath, rel), 'utf8');

describe('writeScaffoldDocs', () => {
  it('writes all three documents at their conventional paths', () => {
    const written = writeScaffoldDocs(projectPath, {
      requirements: '# req',
      design: '# design',
      adr: '# ADR',
    });

    expect(written).toEqual([
      'docs/requirements.md',
      'docs/design.md',
      'docs/adr/0001-architecture-decisions.md',
    ]);
    expect(read('docs/requirements.md')).toBe('# req');
    expect(read('docs/design.md')).toBe('# design');
    expect(read('docs/adr/0001-architecture-decisions.md')).toBe('# ADR');
  });

  it('creates the nested adr directory on its own', () => {
    // The ADR lives one level deeper than the other docs, so it must not rely
    // on a sibling write having created docs/ first.
    writeScaffoldDocs(projectPath, { adr: '# ADR' });
    expect(fs.existsSync(path.join(projectPath, 'docs', 'adr'))).toBe(true);
    expect(read('docs/adr/0001-architecture-decisions.md')).toBe('# ADR');
  });

  it('skips absent documents without creating empty files', () => {
    const written = writeScaffoldDocs(projectPath, { requirements: '# req' });
    expect(written).toEqual(['docs/requirements.md']);
    expect(fs.existsSync(path.join(projectPath, 'docs', 'design.md'))).toBe(false);
    expect(fs.existsSync(path.join(projectPath, 'docs', 'adr'))).toBe(false);
  });

  it('treats a whitespace-only document as absent', () => {
    // The generator can return '' for a document the model dropped; writing a
    // blank docs/adr/0001-*.md would read as "decisions were recorded".
    const written = writeScaffoldDocs(projectPath, { adr: '   \n\t ' });
    expect(written).toEqual([]);
    expect(fs.existsSync(path.join(projectPath, 'docs'))).toBe(false);
  });

  it('creates nothing when every document is absent', () => {
    expect(writeScaffoldDocs(projectPath, {})).toEqual([]);
    expect(fs.readdirSync(projectPath)).toEqual([]);
  });
});
