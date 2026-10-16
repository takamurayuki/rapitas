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
import { type ScaffoldFile, writeProjectSkeleton } from './scaffold-project-writer';

/** The generated documents, any of which may be absent. */
export interface ScaffoldDocs {
  requirements?: string;
  design?: string;
  /** Architecture decision records. / 技術選定記録 */
  adr?: string;
  /**
   * Project skeleton (manifests, configs, entry stubs). Written so the project
   * root carries its own package.json from creation: without it the first
   * environment-setup task has nothing to install from, and an agent handed
   * only docs cannot tell what to implement (task 1152 blocked on exactly that).
   * / プロジェクト雛形
   */
  scaffold?: ScaffoldFile[];
}

/**
 * Write whichever documents were generated under `<projectPath>/docs`, plus the
 * project skeleton at the root.
 *
 * ADRs go to `docs/adr/0001-architecture-decisions.md` rather than a flat
 * `docs/adr.md`: records accumulate, and the numbered-file convention lets
 * later decisions land as 0002-, 0003- without rewriting the first one.
 *
 * The skeleton is delegated to scaffold-project-writer, which validates every
 * model-supplied path; rejections are returned here so the caller can log them.
 *
 * @param projectPath - Absolute path of the scaffolded project. / プロジェクトの絶対パス
 * @param docs - Generated documents and skeleton. Blank entries are skipped. / 生成文書と雛形
 * @returns Written relative paths and any refused skeleton entries. / 書き込んだ相対パスと却下
 */
export function writeScaffoldDocs(
  projectPath: string,
  docs: ScaffoldDocs,
): { written: string[]; rejected: Record<string, string> } {
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

  const skeleton = writeProjectSkeleton(projectPath, docs.scaffold);
  return { written: [...written, ...skeleton.written], rejected: skeleton.rejected };
}
