/**
 * FileSave Content Preparation
 *
 * Body parsing, preamble stripping, mojibake / log-pollution / rejected-resave
 * rejection, persistence via writeWorkflowFile, and research-complexity apply.
 * Not responsible for status transitions or verify gates.
 */

import { ValidationError } from '../../../../middleware/error-handler';
import { createLogger } from '../../../../config/logger';
import type { WorkflowFileType } from '../../core/workflow-helpers';
import {
  writeWorkflowFile,
  sliceFromReportHeading,
} from '../../../../services/workflow/workflow-file-utils';
import { detectReplacementLoss } from '../../../../utils/common/mojibake-detector';
import { looksLogPolluted } from '../../../../services/workflow/phase-output-validator';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import type { WorkflowStatus } from '../../../../services/workflow/workflow-types';
import { HTTP_STATUS } from '../../../../utils/common/http-status';

const log = createLogger('routes:workflow:handlers:files');

/**
 * Result of the content-preparation stage: either the persisted content, or an
 * early HTTP rejection (status + body) the handler must return as-is.
 */
export type ContentPrepOutcome =
  | { ok: true; content: string; fileLanguage: 'ja' | 'en'; savedContent: string }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Parses the request body, rejects broken content, and persists the file.
 *
 * @param params - taskId / fileType / raw body / guard-time status / 入力一式
 * @returns ok:true with persisted content, or ok:false with an HTTP rejection
 * @throws {ValidationError} When the JSON body has no content field
 */
export async function prepareAndPersistContent(params: {
  taskId: number;
  fileType: WorkflowFileType;
  body: unknown;
  currentStatusForGuard: WorkflowStatus;
}): Promise<ContentPrepOutcome> {
  const { taskId, fileType, body, currentStatusForGuard } = params;

  // Accept either a JSON body { content, language } OR a raw text/markdown body.
  // NOTE: agents on Windows used to inline the content into a PowerShell pipeline,
  // where $OutputEncoding defaults to US-ASCII — collapsing every Japanese
  // character to '?' (irreversible). The raw-body path lets the agent write the
  // markdown to a UTF-8 temp file and `curl --data-binary @file`, bypassing shell
  // string encoding entirely. See prompt-builder.ts for the agent-facing steps.
  let content: string;
  let fileLanguage: 'ja' | 'en' = 'ja';
  if (typeof body === 'string') {
    content = body;
  } else {
    const parsedBody = body as { content?: string; language?: 'ja' | 'en' };
    if (parsedBody?.content === undefined || parsedBody?.content === null) {
      throw new ValidationError('content is required');
    }
    content = parsedBody.content;
    fileLanguage = parsedBody.language === 'en' ? 'en' : 'ja';
  }

  // Strip any conversational preamble the agent wrote before the report body
  // (e.g. "これで必要な調査が完了しました。以下がresearch.mdです。"). The .md
  // should begin with its report heading; slice from there. No-op when a heading
  // already leads or none is present.
  content = sliceFromReportHeading(content, fileType);

  // Reject irreversible UTF-8 → '?' replacement mojibake. The original bytes are
  // gone, so there is nothing to "sanitise" — saving it would silently persist
  // garbage. Fail the save and tell the agent to re-send as UTF-8 (the
  // detect → make-it-fix step).
  const loss = detectReplacementLoss(content);
  if (loss.detected) {
    log.warn(
      { taskId, fileType, runs: loss.runs, count: loss.count, longest: loss.longest },
      "[Workflow] Rejected workflow file save: '?'-replacement mojibake detected",
    );
    await recordTransition({
      taskId,
      fromStatus: currentStatusForGuard,
      toStatus: currentStatusForGuard,
      actor: 'system',
      cause: 'mojibake_rejected',
      phase: fileType,
      metadata: { runs: loss.runs, count: loss.count, longest: loss.longest },
      invariantViolation: true,
      invariantMessage: `${fileType}.md rejected: non-ASCII text was replaced by '?' (encoding loss)`,
    });
    return {
      ok: false,
      status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      body: {
        error:
          `保存内容が文字化けしています（日本語が '?' に置換され復元不可）。UTF-8 で再送信してください。` +
          `Windows では PowerShell のパイプ/インライン文字列で curl に渡さないでください（既定の US-ASCII で '?' に潰れます）。` +
          `内容を一時ファイルに UTF-8 で書き出し、'curl.exe -X PUT <url> --data-binary @<file>.md -H "Content-Type: text/markdown; charset=utf-8"' で送ってください。`,
        mojibake: { runs: loss.runs, count: loss.count, longest: loss.longest },
      },
    };
  }

  // Reject a "broken" md whose body is the agent's streamed execution log /
  // stream-json rather than a real report. Persisting it would let a corrupted
  // plan.md get auto-approved and implemented against (and reused on re-run).
  // Don't write it, don't advance — the phase re-runs and regenerates a clean
  // file. (verify validation has its own self-repair path; here we stop the
  // garbage at the door for every file type.)
  if (looksLogPolluted(content)) {
    log.warn(
      { taskId, fileType, currentStatus: currentStatusForGuard, chars: content.length },
      '[Workflow] Rejected workflow file save: agent log/stream output leaked into the md',
    );
    await recordTransition({
      taskId,
      fromStatus: currentStatusForGuard,
      toStatus: currentStatusForGuard,
      actor: 'system',
      cause: 'log_polluted_rejected',
      phase: fileType,
      metadata: { chars: content.length },
      invariantViolation: true,
      invariantMessage: `${fileType}.md rejected: agent execution log leaked into the file (broken artifact)`,
    });
    return {
      ok: false,
      status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      body: {
        error:
          `${fileType}.md の内容に実行ログ/ストリーム出力が混入しています（壊れた成果物）。保存を中止しました。` +
          `最終的なMarkdown本文のみ（ツールログ・[System:...]・stream-json を含めない）を保存してください。`,
      },
    };
  }

  // Front-door resurrection guard: after the phase critic rejects an
  // artifact (rollback + archive), the agent that produced it may PUT the
  // same buffered report again — byte-identical — which would resurrect the
  // rejected content and flip the status forward as if the critique never
  // happened (observed on tasks 539/540). Bounce it with the critic's
  // reasons so the agent revises instead of resubmitting.
  {
    const { checkRejectedResave } =
      await import('../../../../services/workflow/phase-critic/critic-rejection-guard');
    const resave = await checkRejectedResave(taskId, fileType, content);
    if (resave.isResave) {
      await recordTransition({
        taskId,
        fromStatus: currentStatusForGuard,
        toStatus: currentStatusForGuard,
        actor: 'system',
        cause: 'rejected_resave_blocked',
        phase: fileType,
        metadata: { severity: resave.severity, reasonCount: resave.reasons.length },
        invariantViolation: true,
        invariantMessage: `${fileType}.md rejected: byte-identical resubmission of a critic-rejected artifact`,
      }).catch(() => {});
      return {
        ok: false,
        status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        body: {
          error:
            `${fileType}.md は品質批評ゲートに差し戻された内容と同一のため保存できません。` +
            `以下の指摘を反映して修正した内容を保存してください。`,
          criticReasons: resave.reasons,
          severity: resave.severity,
        },
      };
    }
  }

  // Delegate to writeWorkflowFile so the previous version is archived to
  // WorkflowFileVersion. Mojibake sanitisation runs inside writeWorkflowFile.
  const savedContent = await writeWorkflowFile(taskId, fileType, content);

  // Code-grounded complexity: when research.md is saved, apply the score the
  // research agent embedded and re-select the workflow mode (both directions).
  // The auto-run CLI executor does this too — calling the SAME shared helper
  // here keeps the manual (HTTP) path identical, so a low code-grounded score
  // is not stuck in a metadata-picked 'standard' (the "標準 · 複雑度 18" mismatch).
  if (fileType === 'research') {
    try {
      const { applyResearchAssessedComplexity } =
        await import('../../../../services/workflow/research-complexity');
      await applyResearchAssessedComplexity(taskId, savedContent);
    } catch (err) {
      log.warn({ err, taskId }, '[Workflow] Failed to apply research-assessed complexity');
    }
  }

  return { ok: true, content, fileLanguage, savedContent };
}
