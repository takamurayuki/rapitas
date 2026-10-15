/**
 * publication-only-partial
 *
 * Recognizes a verify.md whose `⚠️ 一部失敗` verdict rests ONLY on publication
 * steps (commit / push / PR / CI / merge) that the pipeline performs after the
 * report is saved. Not responsible for detecting real failures — a nonzero
 * test tally or any non-publication remaining item keeps the verdict as is.
 *
 * Measured 2026-09-14..20: 96 verify_repair bounces carried this verdict; 94 of
 * them stated the technical checks passed and 58 named only deferred
 * publication as the reason. Each bounce re-ran the implementer for nothing.
 */

const PUBLICATION_RE =
  /(?:push|pull\s*request|\bPR\b|\bCI\b|merge|マージ|公開|コミット|commit|deploy|デプロイ|watcher)/i;
const PENDING_RE =
  /(?:未実施|未着手|未完了|未確認|保留|pending|待ち|後工程|自動(?:実行|化)|not\s+(?:yet|run|started)|deferred|skipped|later)/i;
const REAL_FAILURE_RE =
  /(?:失敗|不合格|エラー|\berror\b|\bfail(?:ed|ure)?\b|未実装|不足|欠落|欠如|バグ|regression|回帰|broken|壊れ)/i;
/** `2 fail` / `Tests 3 failed` style tallies anywhere outside code fences. */
const NONZERO_TALLY_RE = /\b[1-9]\d*\s+fail(?:ed|ures?)?\b|\b[1-9]\d*\s*件\s*(?:失敗|fail)/i;
const REMAINING_HEADING_RE =
  /^#{2,4}\s*(?:残課題|フォローアップ|未解決|未完了|Remaining|Unresolved|Follow-?ups?|Open\s+items)/i;

function stripFencesAndQuotes(content: string): string[] {
  return content
    .replace(/<!--\s*repair-feedback:start\s*-->[\s\S]*?<!--\s*repair-feedback:end\s*-->/gi, '')
    .replace(/```[^\n]*\n[\s\S]*?\n[ \t]*```/g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*>/.test(l));
}

/** Verdict cells/lines as hasNonpassingVerifyVerdict reads them; null when none selected. */
function selectedVerdicts(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\*\*|__/g, '').trim();
    const cell = line.match(
      /^\|\s*(?:全体判定|overall(?:\s+(?:verdict|result|status))?)\s*\|\s*([^|]*)\|/i,
    );
    const value = (
      cell?.[1] ??
      line.replace(
        /^(?:#{1,6}\s*)?(?:(?:冒頭結論|全体判定|overall(?:\s+(?:verdict|result|status))?)\s*[:：]\s*)?/i,
        '',
      )
    ).trim();
    if (/✅|場合|とき|なら|選択|選ぶ|\b(?:if|when|choose)\b/i.test(value)) continue;
    if (/^(?:⚠️?\s*(?:一部失敗|Partial\b)|❌\s*(?:検証失敗|Fail(?:ed)?\b))/i.test(value)) {
      out.push(value);
    }
  }
  return out;
}

/** Bullet / numbered / table-row items under the remaining-work heading. */
function remainingItems(lines: string[]): string[] {
  const items: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      inSection = REMAINING_HEADING_RE.test(line);
      continue;
    }
    if (!inSection || line === '') continue;
    if (/^\|?\s*-{3,}/.test(line) || /^\|(?:\s*:?-+:?\s*\|)+$/.test(line)) continue; // separators
    if (/^[-*]\s+|^\d+[.)]\s+/.test(line)) {
      items.push(line.replace(/^[-*]\s+|^\d+[.)]\s+/, ''));
    } else if (line.startsWith('|')) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      // Header rows carry column labels, not work items.
      if (
        cells.every((c) =>
          /^(?:#|No\.?|内容|項目|重要度|推奨対応|状態|備考|Item|Severity|Action|Status)$/i.test(c),
        )
      )
        continue;
      items.push(cells.join(' '));
    }
  }
  return items;
}

/**
 * True when the report's partial verdict is explained solely by publication
 * work that has not happened yet.
 *
 * @param content - verify.md body. / verify.md 本文
 * @returns Whether the partial verdict can be treated as a pass. / 公開待ちのみによる一部失敗か
 */
export function isPublicationOnlyPartial(content: string): boolean {
  const lines = stripFencesAndQuotes(content);
  const verdicts = selectedVerdicts(lines);
  if (verdicts.length === 0) return false;
  // Any explicit ❌ is a real failure verdict; only ⚠️ can be publication-only.
  if (verdicts.some((v) => /^❌/.test(v))) return false;
  if (NONZERO_TALLY_RE.test(lines.join('\n'))) return false;

  const items = remainingItems(lines);
  if (items.length === 0) return false;
  return items.every(
    (item) => PUBLICATION_RE.test(item) && PENDING_RE.test(item) && !REAL_FAILURE_RE.test(item),
  );
}
