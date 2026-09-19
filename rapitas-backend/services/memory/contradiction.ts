/**
 * Contradiction Detection & Resolution
 *
 * Detects contradictions between new/updated entries and similar existing entries,
 * and provides resolution options.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { vectorSearch } from './rag/search';
import { isNearDuplicatePair } from './text-similarity';
import { appendEvent } from './timeline';
import type { ContradictionResolution } from './types';

const log = createLogger('memory:contradiction');

/** Max open contradictions one entry may accumulate before we stop adding more. */
const MAX_OPEN_PER_ENTRY = (() => {
  const v = parseInt(process.env.RAPITAS_KB_MAX_OPEN_CONTRADICTIONS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
})();

/**
 * Minimum trimmed length of an extracted claim to be considered a usable
 * contradiction statement. Heading-only outputs (e.g. `**主な矛盾点：**`) fall
 * below this and are deferred rather than auto-conflicting two entries.
 */
const MIN_CLAIM_LENGTH = 20;
/**
 * Confidence at/above which a structured contradiction auto-conflicts both
 * entries. Below it the row is kept for human review (`needsReview`) but the
 * entries stay usable — a low-confidence judgement (often "different point in
 * time / different subject") must not silently pull knowledge out of recall.
 */
const CONFIDENCE_CONFLICT_THRESHOLD = 0.7;

/** Structured contradiction claims extracted from the LLM response. */
interface ContradictionClaims {
  claimA: string;
  claimB: string;
  citationA: string;
  citationB: string;
  asOfA: string;
  asOfB: string;
  codeVersionA: string;
  codeVersionB: string;
  confidence: number;
}

/** All structured field labels, used as non-greedy lookahead stops. */
const CLAIM_FIELD_LABELS =
  '対立命題[AB]|引用箇所[AB]|適用時点[AB]|コード版[AB]|確信度|種類|説明|判定';

/**
 * Extract a single labelled field's value, spanning multiple lines up to the
 * next known field label (or end of text). Returns '' when the label is absent.
 *
 * @param text - Full LLM response text. / LLM応答全文
 * @param label - Field label without the trailing colon (e.g. `対立命題A`). / フィールド名
 * @returns Trimmed field value, or '' if not present. / 抽出値（無ければ空文字）
 */
function extractField(text: string, label: string): string {
  // Non-greedy capture stops at the next labelled line so multi-line values are
  // preserved without swallowing the following field.
  const re = new RegExp(
    `${label}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${CLAIM_FIELD_LABELS})\\s*[:：]|$)`,
  );
  const m = text.match(re);
  return m ? m[1]!.trim() : '';
}

/**
 * Parse the structured contradiction fields out of an LLM response. Returns
 * `null` when the model did not follow the structured format at all (neither
 * `対立命題A` nor `対立命題B` present) — the caller then treats it as the
 * "insufficient information" safe path (defer, do not conflict).
 *
 * @param responseText - Raw LLM response. / LLM応答
 * @returns Parsed claims, or null when unstructured. / 構造化抽出結果
 */
export function parseContradictionClaims(responseText: string): ContradictionClaims | null {
  const claimA = extractField(responseText, '対立命題A');
  const claimB = extractField(responseText, '対立命題B');
  // No claim labels at all → the model returned free-form / heading-only text.
  // Signal the fallback path rather than fabricating empty claims.
  if (!claimA && !claimB) return null;
  const confRaw = extractField(responseText, '確信度');
  const parsedConf = parseFloat(confRaw);
  const confidence = Number.isFinite(parsedConf) ? Math.min(1, Math.max(0, parsedConf)) : 0;
  return {
    claimA,
    claimB,
    citationA: extractField(responseText, '引用箇所A'),
    citationB: extractField(responseText, '引用箇所B'),
    asOfA: extractField(responseText, '適用時点A'),
    asOfB: extractField(responseText, '適用時点B'),
    codeVersionA: extractField(responseText, 'コード版A'),
    codeVersionB: extractField(responseText, 'コード版B'),
    confidence,
  };
}

/**
 * Detect contradictions for a new or updated entry.
 *
 * @param entryId - Knowledge entry ID to check
 * @returns Number of contradictions detected
 */
export async function detectContradictions(entryId: number): Promise<number> {
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) return 0;

  let detectCount = 0;

  try {
    // Retrieve top-10 similar entries
    const searchResults = await vectorSearch({
      query: entry.content,
      limit: 10,
      minSimilarity: 0.6,
    });

    // Exclude self
    const candidates = searchResults.filter((r) => r.knowledgeEntryId !== entryId);

    // Cap: an entry buried under open contradictions gains nothing from more —
    // each additional pair repeats the same "this cluster disagrees" signal
    // while inflating the backlog the nightly drain must chew through.
    let openCount = await prisma.knowledgeContradiction.count({
      where: {
        resolution: null,
        OR: [{ entryAId: entryId }, { entryBId: entryId }],
      },
    });

    for (const candidate of candidates) {
      if (openCount >= MAX_OPEN_PER_ENTRY) {
        log.debug(
          { entryId, openCount },
          '[contradiction] Open-contradiction cap reached — skipping further pairs',
        );
        break;
      }

      const candidateEntry = await prisma.knowledgeEntry.findUnique({
        where: { id: candidate.knowledgeEntryId },
      });
      if (!candidateEntry) continue;

      // Check for existing contradiction record
      const existing = await prisma.knowledgeContradiction.findFirst({
        where: {
          OR: [
            { entryAId: entryId, entryBId: candidate.knowledgeEntryId },
            { entryAId: candidate.knowledgeEntryId, entryBId: entryId },
          ],
        },
      });
      if (existing) {
        // A RESOLVED pair (resolution set) is a decided matter — never relitigate.
        if (existing.resolution != null) continue;
        // Unresolved pair: re-evaluate ONLY if either entry's content actually
        // changed since detection (hash mismatch). This lets a correction re-open
        // a stale judgement while a no-op save doesn't burn an LLM call. Map the
        // stored A/B hashes to the current pair by the recorded orientation.
        const currentHashA =
          existing.entryAId === entryId ? entry.contentHash : candidateEntry.contentHash;
        const currentHashB =
          existing.entryAId === entryId ? candidateEntry.contentHash : entry.contentHash;
        if (
          existing.contentHashAAtDetection === currentHashA &&
          existing.contentHashBAtDetection === currentHashB
        ) {
          continue; // genuinely unchanged since detection
        }
        // Content changed → drop the stale row and fall through to re-detect.
        await prisma.knowledgeContradiction.delete({ where: { id: existing.id } });
      }

      // Near-duplicate pair = same lesson reworded — dedup it here instead of
      // asking the LLM, which reliably misreads paraphrase deltas as
      // "contradictions". Keep the outcome-proven side (decayScore, then age).
      if (isNearDuplicatePair(entry, candidateEntry)) {
        const keepCandidate =
          candidateEntry.decayScore > entry.decayScore ||
          (candidateEntry.decayScore === entry.decayScore && candidateEntry.id < entry.id);
        const loserId = keepCandidate ? entry.id : candidateEntry.id;
        await prisma.knowledgeEntry.update({
          where: { id: loserId },
          data: { validationStatus: 'rejected', forgettingStage: 'archived' },
        });
        await appendEvent({
          eventType: 'knowledge_archived',
          payload: {
            entryId: loserId,
            keptEntryId: keepCandidate ? candidateEntry.id : entry.id,
            reason: 'near_duplicate_dedup',
          },
        });
        log.info(
          { entryId: loserId, keptEntryId: keepCandidate ? candidateEntry.id : entry.id },
          '[contradiction] Near-duplicate pair deduped instead of contradiction-flagged',
        );
        // The new entry lost the dedup — no point checking further candidates.
        if (loserId === entryId) break;
        continue;
      }

      // Determine contradiction via LLM
      try {
        const response = await sendAIMessage({
          provider: 'ollama',
          messages: [
            {
              role: 'user',
              content: `以下の2つの知識エントリに矛盾がないか判定してください。同一の対象・同一の時点について論理的に両立しない場合のみ矛盾と判定してください（適用時点や対象が異なるだけの場合は矛盾ではありません）。

エントリA:
タイトル: ${entry.title}
内容: ${entry.content}

エントリB:
タイトル: ${candidateEntry.title}
内容: ${candidateEntry.content}

矛盾がある場合は以下の形式で回答（対立命題A/Bは必ず1文以上の具体的な命題で記述すること。見出しや箇条書き記号のみは不可）:
判定: CONTRADICTION
種類: [factual/procedural/preference]
対立命題A: [エントリAが主張する具体的な命題]
対立命題B: [エントリBが主張する、Aと両立しない具体的な命題]
引用箇所A: [エントリAの根拠（ファイルパス/URL/該当記述など、無ければ「なし」）]
引用箇所B: [エントリBの根拠（無ければ「なし」）]
適用時点A: [エントリAが前提とする時点・状況（無ければ「なし」）]
適用時点B: [エントリBが前提とする時点・状況（無ければ「なし」）]
コード版A: [エントリAが対象とするコード版（無ければ「なし」）]
コード版B: [エントリBが対象とするコード版（無ければ「なし」）]
確信度: [0.0〜1.0の数値。両者が同一対象・同一時点で本当に論理矛盾している確信度]
説明: [矛盾の要約]

矛盾がない場合:
判定: NO_CONTRADICTION`,
            },
          ],
          maxTokens: 512,
        });

        const responseText = response.content;
        // "NO_CONTRADICTION" contains the substring "CONTRADICTION" — check the
        // negative form first, or a plain includes() misreads every negative
        // verdict as positive and the caller registers a row it shouldn't.
        if (responseText.includes('NO_CONTRADICTION')) {
          log.debug(
            { entryId, candidateId: candidate.knowledgeEntryId },
            '[contradiction] LLM judged NO_CONTRADICTION — skipping record',
          );
        } else if (responseText.includes('CONTRADICTION')) {
          const claims = parseContradictionClaims(responseText);

          // Insufficient structured evidence — heading-only claims, or an
          // unstructured / format-broken response (parse returned null). Defer to
          // the next detection instead of conflicting two entries on a hunch.
          if (
            !claims ||
            claims.claimA.trim().length < MIN_CLAIM_LENGTH ||
            claims.claimB.trim().length < MIN_CLAIM_LENGTH
          ) {
            log.debug(
              { entryId, candidateId: candidate.knowledgeEntryId },
              '[contradiction] Verdict lacked a usable structured claim — deferring',
            );
            continue;
          }

          const typeMatch = responseText.match(/種類:\s*(factual|procedural|preference)/);
          const descMatch = responseText.match(/説明:\s*(.+)/);
          // High confidence + concrete claims on both sides → conflict both
          // entries (legacy behavior). Otherwise keep the row for human review
          // without pulling either entry out of recall.
          const highConfidence = claims.confidence >= CONFIDENCE_CONFLICT_THRESHOLD;
          const orNull = (s: string): string | null => (s ? s : null);

          const contradiction = await prisma.knowledgeContradiction.create({
            data: {
              entryAId: entryId,
              entryBId: candidate.knowledgeEntryId,
              contradictionType: typeMatch?.[1] ?? 'factual',
              description: descMatch?.[1]?.trim() ?? claims.claimA,
              claimA: claims.claimA,
              claimB: claims.claimB,
              citationA: orNull(claims.citationA),
              citationB: orNull(claims.citationB),
              asOfA: orNull(claims.asOfA),
              asOfB: orNull(claims.asOfB),
              codeVersionA: orNull(claims.codeVersionA),
              codeVersionB: orNull(claims.codeVersionB),
              confidence: claims.confidence,
              needsReview: !highConfidence,
              // Snapshot both entries' content hashes so a later correction can be
              // detected (hash mismatch re-opens this unresolved pair).
              contentHashAAtDetection: entry.contentHash,
              contentHashBAtDetection: candidateEntry.contentHash,
            },
          });

          // Only a high-confidence, well-structured judgement conflicts the
          // entries; a low-confidence one stays usable pending review.
          if (highConfidence) {
            await prisma.knowledgeEntry.updateMany({
              where: { id: { in: [entryId, candidate.knowledgeEntryId] } },
              data: { validationStatus: 'conflict' },
            });
          }

          await appendEvent({
            eventType: 'contradiction_detected',
            payload: {
              contradictionId: contradiction.id,
              entryAId: entryId,
              entryBId: candidate.knowledgeEntryId,
              type: contradiction.contradictionType,
              confidence: claims.confidence,
              needsReview: !highConfidence,
            },
          });

          detectCount++;
          openCount++;
          log.info(
            {
              contradictionId: contradiction.id,
              entryAId: entryId,
              entryBId: candidate.knowledgeEntryId,
              confidence: claims.confidence,
              conflicted: highConfidence,
            },
            'Contradiction detected',
          );
        }
      } catch (error) {
        log.warn(
          { err: error, entryId, candidateId: candidate.knowledgeEntryId },
          'LLM contradiction check failed',
        );
      }
    }
  } catch (error) {
    log.debug({ err: error, entryId }, 'Vector search unavailable for contradiction detection');
  }

  return detectCount;
}

/**
 * Resolve a detected contradiction.
 *
 * @param contradictionId - Contradiction record ID
 * @param resolution - Resolution strategy (keep_a, keep_b, merge, dismiss)
 */
export async function resolveContradiction(
  contradictionId: number,
  resolution: ContradictionResolution,
): Promise<void> {
  const contradiction = await prisma.knowledgeContradiction.findUnique({
    where: { id: contradictionId },
    include: { entryA: true, entryB: true },
  });

  if (!contradiction) {
    throw new Error(`Contradiction not found: ${contradictionId}`);
  }

  switch (resolution) {
    case 'keep_a':
      await prisma.knowledgeEntry.update({
        where: { id: contradiction.entryBId },
        data: { forgettingStage: 'archived', validationStatus: 'rejected' },
      });
      break;
    case 'keep_b':
      await prisma.knowledgeEntry.update({
        where: { id: contradiction.entryAId },
        data: { forgettingStage: 'archived', validationStatus: 'rejected' },
      });
      break;
    case 'merge':
      // Merge: mark both as validated
      await prisma.knowledgeEntry.updateMany({
        where: { id: { in: [contradiction.entryAId, contradiction.entryBId] } },
        data: { validationStatus: 'validated' },
      });
      break;
    case 'dismiss':
      // Dismiss: revert both to validated
      await prisma.knowledgeEntry.updateMany({
        where: { id: { in: [contradiction.entryAId, contradiction.entryBId] } },
        data: { validationStatus: 'validated' },
      });
      break;
  }

  await prisma.knowledgeContradiction.update({
    where: { id: contradictionId },
    data: { resolution, resolvedAt: new Date() },
  });

  await appendEvent({
    eventType: 'contradiction_resolved',
    payload: { contradictionId, resolution },
  });

  log.info({ contradictionId, resolution }, 'Contradiction resolved');
}

// NOTE: revalidateStaleConflicts / drainStaleConflicts moved to
// ./contradiction-sweep.ts — this file was past the 300-line split threshold,
// and the nightly backlog drain is a separate concern from detection/resolution.

/**
 * Retrieve unresolved contradictions.
 */
export async function getUnresolvedContradictions(limit = 20) {
  return prisma.knowledgeContradiction.findMany({
    where: { resolution: null },
    include: {
      entryA: {
        select: { id: true, title: true, content: true, category: true, confidence: true },
      },
      entryB: {
        select: { id: true, title: true, content: true, category: true, confidence: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
