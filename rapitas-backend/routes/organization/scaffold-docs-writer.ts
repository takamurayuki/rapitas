/**
 * scaffold-docs-writer
 *
 * Writes the generated specification documents into a freshly scaffolded
 * project. NOT responsible for creating the project directory, the git repo, or
 * the agent guide — themes.ts owns those.
 *
 * Split out of themes.ts so the document set can grow (requirements → design →
 * ADRs → whatever comes next) without pushing that file past its line limit.
 */

import fs from 'fs';
import path from 'path';

/** The generated documents, any of which may be absent. */
export interface ScaffoldDocs {
  requirements?: string;
  design?: string;
  /** Architecture decision records. / 技術選定記録 */
  adr?: string;
}

/**
 * Write whichever documents were generated under `<projectPath>/docs`.
 *
 * ADRs go to `docs/adr/0001-architecture-decisions.md` rather than a flat
 * `docs/adr.md`: records accumulate, and the numbered-file convention lets
 * later decisions land as 0002-, 0003- without rewriting the first one.
 *
 * @param projectPath - Absolute path of the scaffolded project. / プロジェクトの絶対パス
 * @param docs - Generated documents. Blank/whitespace entries are skipped. / 生成文書（空白のみは書き込まない）
 * @returns Repo-relative paths actually written. / 実際に書き込んだ相対パス
 */
export function writeScaffoldDocs(projectPath: string, docs: ScaffoldDocs): string[] {
  const entries: Array<[string, string | undefined]> = [
    ['docs/requirements.md', docs.requirements],
    ['docs/design.md', docs.design],
    ['docs/adr/0001-architecture-decisions.md', docs.adr],
  ];

  const written: string[] = [];
  for (const [relPath, content] of entries) {
    if (!content?.trim()) continue;
    const absPath = path.join(projectPath, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
    written.push(relPath);
  }
  return written;
}
