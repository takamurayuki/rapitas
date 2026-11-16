/**
 * subtask-integration-verify
 *
 * Builds a split parent's integration verify.md from its subtasks' results.
 * Not responsible for writing it or finalizing the parent
 * (subtask-completion-handler.ts).
 *
 * NOTE: Split out of subtask-completion-handler.ts (over the 300-line limit)
 * when parent finalization gained the common completion check.
 */

/**
 * Build integration verify.md content from all subtask results.
 *
 * @param parentTask - The parent task being finalized. / 完了させる親タスク
 * @param subtasks - All sibling subtasks with their statuses. / 全サブタスク
 * @param isPassed - The handler's "subtask passed" rule (passed in, not imported, to avoid an import cycle) / 合格判定
 * @returns Markdown content for the parent's verify.md. / verify.md の内容
 */
export function buildIntegrationVerify(
  parentTask: { id: number; title: string },
  subtasks: Array<{ id: number; title: string; status: string; workflowStatus: string | null }>,
  isPassed: (s: { status: string; workflowStatus: string | null }) => boolean,
): string {
  const lines: string[] = [];

  lines.push(`# Integration Verification: ${parentTask.title}`);
  lines.push('');
  lines.push(`## Subtask Summary`);
  lines.push('');

  let allPassed = true;

  for (const st of subtasks) {
    const passed = isPassed(st);
    lines.push(`- ${passed ? '✅' : '❌'} #${st.id}: ${st.title}`);

    if (!passed) {
      allPassed = false;
    }
  }
  lines.push('');

  lines.push('## Integration Check');
  lines.push(`- [${allPassed ? 'x' : ' '}] All subtasks completed successfully`);
  lines.push('- [ ] No regression in existing functionality');
  lines.push('- [ ] Integration points between subtasks verified');
  lines.push('');

  lines.push('## Overall Result');
  lines.push(
    allPassed
      ? 'All subtasks completed. Ready for final review.'
      : 'Some subtasks have issues. Manual review required.',
  );

  return lines.join('\n');
}
