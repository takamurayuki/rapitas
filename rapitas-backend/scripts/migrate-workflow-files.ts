/**
 * migrate-workflow-files
 *
 * One-shot CLI runner for `migrateLegacyWorkflowFiles`. Invokes the same
 * idempotent migrator the backend boots with and prints a summary so the
 * operator can verify the move before deleting the legacy directory.
 */
import { migrateLegacyWorkflowFiles } from '../services/workflow/workflow-legacy-migrator';
import { getWorkflowBaseDir } from '../services/workflow/workflow-paths';

async function main() {
  const target = getWorkflowBaseDir();
  console.log(`[migrate] target base dir: ${target}`);
  const copied = await migrateLegacyWorkflowFiles();
  console.log(`[migrate] copied ${copied} file(s)`);
  console.log(`[migrate] new layout: ${target}/<categoryId>/<themeId>/<taskId>/*.md`);
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
