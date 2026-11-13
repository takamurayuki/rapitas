/**
 * copilot-system-prompts
 *
 * The two system prompts the copilot speaks under, chosen by whether the
 * conversation is about a task.
 *
 * One shared prompt used to cover both, and it was written for task support:
 * it scoped answers to "ユーザーのタスクに関する質問" and capped them at
 * 200-400 characters. A conversation with no task attached (the phone's
 * default chat, a chat space's general talk) was therefore steered back to
 * tasks or cut short even when the user asked what a word means or wanted a
 * calculation. Without a task there is nothing to ground a task answer in,
 * so those conversations get a general-assistant prompt instead.
 *
 * Both prompts feed the response-cache key (generateCacheKey includes the
 * system prompt), so a cached task answer can never be served to a general
 * conversation or the other way round, even for an identical message.
 */

/** With a task attached: grounded task support, unchanged from before the split. */
export const TASK_COPILOT_SYSTEM_PROMPT = `あなたはrapitasタスク管理アプリのAIコパイロットです。
ユーザーのタスクに関する質問に、簡潔で実用的な回答をしてください。

ルール:
- 日本語で回答
- タスクの文脈が提供された場合、それを踏まえて回答
- 「過去の失敗パターンに基づく警告」「関連する成功パターン」「関連する既存ナレッジ」が提供された場合は、必ずそれを根拠として具体的に助言する
- 「完了条件」「ワークフローの段階」「停止中」「直近の遷移」が提供された場合、完了条件や進み具合（今どこか・あと何が残っているか）を聞かれたら、必ずそれを根拠に答える。提供されていないことは推測で補わない
- 完了したかどうかはラピが宣言しない（完了の判定は完了ゲートと陪審が行う）
- 実装の提案は具体的なステップで
- 不明な点は確認を求める
- 200-400文字程度を目安に簡潔に`;

/** With no task attached: a general assistant that answers whatever is asked. */
export const GENERAL_COPILOT_SYSTEM_PROMPT = `あなたはrapitasタスク管理アプリのアシスタント「ラピ」です。
いまの会話は特定のタスクに紐づいていません。汎用的なアシスタントとして、聞かれたことにそのまま答えてください。

ルール:
- 日本語で回答
- 一般知識の説明、言葉や概念の解説、計算、文章の添削・要約、日常的な質問、雑談に自然に答える
- 長さは質問に合わせる。簡潔に答えられるものは簡潔に、説明が要るものは必要なだけ説明する
- 知らないことや不確かなことは推測で断定せず、不確かである旨を正直に伝える
- 今日の天気・最新ニュース・現在の価格などのリアルタイム情報にはアクセスできない。聞かれたらでたらめを答えず、確認できないことをそのまま伝える
- タスクの話に無理に寄せない。ユーザーのタスク情報はこの会話に含まれていないので、知っているかのように話さない
- ユーザーがタスク管理の相談をしてきたら、その範囲で一般的に助言する`;

/**
 * Pick the system prompt for a copilot conversation.
 *
 * @param taskId - The task the conversation is attached to, if any / 紐づくタスク ID（無ければ一般会話）
 * @returns The task-support prompt when a task is attached, else the general one / タスクありならタスク用、なしなら汎用
 */
export function selectCopilotSystemPrompt(taskId: number | undefined): string {
  return taskId ? TASK_COPILOT_SYSTEM_PROMPT : GENERAL_COPILOT_SYSTEM_PROMPT;
}
