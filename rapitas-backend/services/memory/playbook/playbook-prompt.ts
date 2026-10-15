/**
 * playbook-prompt
 *
 * Pure prompt-construction and response-parsing layer for playbook generation:
 * builds the ONE aux-AI request from a same-shape task cluster and parses the
 * strict-JSON `{title, content}` reply. No I/O.
 */
import type { PlaybookCluster, PlaybookParseResult } from './playbook-types';

/** Title cap — long titles hurt list views and dedup. */
const TITLE_MAX_CHARS = 150;
/** Content cap — bounds KnowledgeEntry size and later prompt injection. */
const CONTENT_MAX_CHARS = 6000;
/** Per-member artifact excerpt cap fed to the prompt. */
const EXCERPT_MAX_CHARS = 1500;

/** System prompt: distil a reusable procedure, output strict JSON only. */
export const PLAYBOOK_SYSTEM_PROMPT = [
  'あなたは開発チームの手順書(プレイブック)編集者です。',
  '同型の完了タスク群から、この型のタスクを次回速く正確に実行するための汎用手順書を1つ蒸留してください。',
  '個別タスクの再説明ではなく、型として共通する手順・対象ファイル・ハマりどころを一般化すること。',
  '出力は厳密なJSONオブジェクトのみ: {"title": "手順書タイトル", "content": "Markdown本文"}',
  'content は必ず次のセクションを持つMarkdown:',
  '## 対象ファイル (1行1ファイル、必ずバッククォートで `path/to/file.ts` 形式)',
  '## 手順 (同型ミラーの箇所を含む番号付き手順)',
  '## ハマりどころ',
  '## 検証手順',
  'JSON以外の前置き・後置きテキストを出力しないこと。',
].join('\n');

/**
 * Build the user prompt for playbook generation from a same-shape cluster.
 *
 * @param cluster - Same-shape cluster (current task first). / 同型クラスタ
 * @returns Prompt text. / プロンプト本文
 */
export function buildPlaybookPrompt(cluster: PlaybookCluster): string {
  const members = cluster.members
    .map((m, i) => {
      const parts = [
        `### タスク${i + 1}: ${m.title} (#${m.taskId})`,
        `変更ファイル: ${m.files.map((f) => `\`${f}\``).join(', ')}`,
      ];
      if (m.artifactExcerpt?.trim()) {
        parts.push('成果物抜粋:', m.artifactExcerpt.slice(0, EXCERPT_MAX_CHARS));
      }
      return parts.join('\n');
    })
    .join('\n\n');
  return [
    '以下は同型と判定された完了タスク群です。この型のタスクの汎用手順書を1つ生成してください。',
    '',
    members,
  ].join('\n');
}

/**
 * Parse the AI reply into a playbook. Structural failures (no JSON object,
 * parse error, missing/empty fields, missing `## 対象ファイル` section) all
 * yield `{parseFailed: true}` — the caller stores nothing (fail-open). The
 * 対象ファイル section is REQUIRED because the injection-time freshness gate
 * re-extracts paths from it; a playbook without it can never be validated.
 *
 * @param raw - AI response text. / AI応答テキスト
 * @returns Parsed playbook or failure flag. / パース結果
 */
export function parsePlaybookResult(raw: string): PlaybookParseResult {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { parseFailed: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { parseFailed: true };
  }
  if (parsed === null || typeof parsed !== 'object') return { parseFailed: true };
  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, TITLE_MAX_CHARS) : '';
  const content = typeof obj.content === 'string' ? obj.content.trim() : '';
  if (!title || !content) return { parseFailed: true };
  if (!/^##\s*対象ファイル/m.test(content)) return { parseFailed: true };
  return { parseFailed: false, title, content: content.slice(0, CONTENT_MAX_CHARS) };
}
