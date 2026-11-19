/**
 * DeliverableDraft
 *
 * Turns a completed task's verify.md / research.md into a note document
 * (design §3.3「本文は生成で整える」), the same way note-draft turns a reply:
 * Haiku, NOTE_MARKDOWN_FORMAT_RULES, TITLE:/BODY: markers.
 *
 * Failure follows nav70: a failed model call, or a reply with no usable body,
 * is an error and the caller saves NOTHING. A reply that only lacks the
 * markers is still a body (parseNoteDraftReply), not a failure.
 *
 * Not responsible for saving — see deliverable-create.
 */
import { sendAIMessage } from '../../../utils/ai-client';
import { createLogger } from '../../../config/logger';
import { NOTE_MARKDOWN_FORMAT_RULES } from '../note-format-rules';
import {
  NoteDraftUnavailableError,
  parseNoteDraftReply,
  resolveNoteDraftTitle,
  type NoteDraft,
} from '../note-draft';
import type { DeliverableKind } from './deliverable-eligibility';

const logger = createLogger('deliverable-draft');

const DRAFT_MODEL = 'claude-haiku-4-5-20251001';
const DRAFT_MAX_TOKENS = 4000;
/** Input kept from the file; a verify.md can be long and the note is a summary. */
const MAX_SOURCE_CHARS = 30_000;

const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
完了したタスクの記録（検証結果または調査結果）を、あとから読み返す成果物ノートに整えます。

出すもの:
1. タイトル: 何をした・何が分かったかが分かる簡潔な日本語（目安30字以内）。装飾や日付は付けない。
2. 本文: 記録をドキュメントとして整えたもの。

守ること:
1. 記録に無い情報を足さない。
2. 結論・変更点・確認結果・残った課題を、読み手が先に知りたい順に並べる。
3. ファイル一覧や表は必要なものだけ残す。
4. 説明やコードブロックで全体を囲まず、次の形だけで答える:

TITLE: <タイトル>
BODY:
<本文>

${NOTE_MARKDOWN_FORMAT_RULES}`;

/**
 * Ask the model for a deliverable note.
 *
 * @param kind - verify or research / 元ファイルの種類
 * @param taskTitle - The task's title, for context and the fallback title / タスク名
 * @param source - The file content / ファイル内容
 * @returns Title and tidied body / タイトルと整えた本文
 * @throws {NoteDraftUnavailableError} when the model gave no usable body / 本文が得られなかったとき
 * @throws {Error} when the model call itself failed / 呼び出し自体が失敗したとき
 */
export async function draftDeliverableNote(
  kind: DeliverableKind,
  taskTitle: string,
  source: string,
): Promise<NoteDraft> {
  const label = kind === 'verify' ? '検証結果（verify.md）' : '調査結果（research.md）';
  const response = await sendAIMessage({
    provider: 'claude',
    model: DRAFT_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: DRAFT_MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: `タスク: ${taskTitle}\n${label}:\n${source.slice(0, MAX_SOURCE_CHARS).trim()}`,
      },
    ],
  });
  const parsed = parseNoteDraftReply(response.content ?? '');
  if (!parsed.content) {
    logger.info({ kind }, 'model answered without a deliverable body');
    throw new NoteDraftUnavailableError('model answered without a deliverable body');
  }
  const fallback = kind === 'verify' ? `${taskTitle}の成果` : `${taskTitle}の調査結果`;
  // The model's title when it gave one; otherwise the task's, not the body's
  // first line (a verify.md usually opens with a table or a file list).
  const title = parsed.title ? resolveNoteDraftTitle(parsed.title, parsed.content) : fallback;
  return { title, content: `${parsed.content}\n` };
}
