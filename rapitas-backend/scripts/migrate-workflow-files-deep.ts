/**
 * migrate-workflow-files-deep
 *
 * Mirrors EVERY `.md` file under the legacy `<cwd>/tasks/` tree to the new
 * workflow base dir, preserving the relative directory structure. Covers:
 *   - <cat>/<theme>/<task>/{research,plan,question,verify}.md
 *   - <cat>/<theme>/<task>/subtasks/<n>/instruction.md
 *   - <cat>/<theme>/<task>/_archive/<ts>/*.md
 *
 * Idempotent: skips files that already exist at the destination.
 */
import { existsSync } from 'fs';
import { copyFile, mkdir, readdir, stat } from 'fs/promises';
import { dirname, join, relative } from 'path';
import { getWorkflowBaseDir } from '../services/workflow/workflow-paths';

async function walkMd(root: string): Promise<string[]> {
  const acc: string[] = [];
  async function walk(dir: string) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      let st;
      try {
        st = await stat(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) await walk(p);
      else if (st.isFile() && name.endsWith('.md')) acc.push(p);
    }
  }
  await walk(root);
  return acc;
}

async function main() {
  const legacyRoot = join(process.cwd(), 'tasks');
  const newRoot = getWorkflowBaseDir();
  console.log(`[deep-migrate] from: ${legacyRoot}`);
  console.log(`[deep-migrate] to:   ${newRoot}`);

  if (!existsSync(legacyRoot)) {
    console.log('[deep-migrate] no legacy directory — nothing to do.');
    return;
  }

  const all = await walkMd(legacyRoot);
  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const src of all) {
    const rel = relative(legacyRoot, src);
    const dst = join(newRoot, rel);
    if (existsSync(dst)) {
      skipped++;
      continue;
    }
    try {
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
      copied++;
    } catch (err) {
      failed++;
      console.warn(`[deep-migrate] failed: ${src} → ${dst}: ${err}`);
    }
  }

  console.log(
    `[deep-migrate] total=${all.length} copied=${copied} skipped=${skipped} failed=${failed}`,
  );
  console.log(`[deep-migrate] new layout root: ${newRoot}`);
}

main().catch((err) => {
  console.error('[deep-migrate] failed:', err);
  process.exit(1);
});
