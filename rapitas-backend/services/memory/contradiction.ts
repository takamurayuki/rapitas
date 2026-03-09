/**
 * 矛盾検出・解決（Contradiction Detection & Resolution）
 * 新規/更新エントリに対して類似エントリとの矛盾を検出し、解決策を提示
 */
import { prisma } from "../../config/database";
import { createLogger } from "../../config/logger";
import { sendAIMessage } from "../../utils/ai-client";
import { vectorSearch } from "./rag/search";
import { appendEvent } from "./timeline";
import type { ContradictionResolution } from "./types";

const log = createLogger("memory:contradiction");

/**
 * 新規/更新エントリに対して矛盾を検出
 */
export async function detectContradictions(entryId: number): Promise<number> {
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) return 0;

  let detectCount = 0;

  try {
    // top-10類似エントリを取得
    const searchResults = await vectorSearch({
      query: entry.content,
      limit: 10,
      minSimilarity: 0.6,
    });

    // 自分自身と既にチェック済みのペアを除外
    const candidates = searchResults.filter((r) => r.knowledgeEntryId !== entryId);

    for (const candidate of candidates) {
      // 既存の矛盾レコードがあるかチェック
      const existing = await prisma.knowledgeContradiction.findFirst({
        where: {
          OR: [
            { entryAId: entryId, entryBId: candidate.knowledgeEntryId },
            { entryAId: candidate.knowledgeEntryId, entryBId: entryId },
          ],
        },
      });
      if (existing) continue;

      const candidateEntry = await prisma.knowledgeEntry.findUnique({
        where: { id: candidate.knowledgeEntryId },
      });
      if (!candidateEntry) continue;

      // LLMで矛盾判定
      try {
        const response = await sendAIMessage({
          messages: [
            {
              role: "user",
              content: `以下の2つの知識エントリに矛盾がないか判定してください。

エントリA:
タイトル: ${entry.title}
内容: ${entry.content}

エントリB:
タイトル: ${candidateEntry.title}
内容: ${candidateEntry.content}

矛盾がある場合は以下の形式で回答:
判定: CONTRADICTION
種類: [factual/procedural/preference]
説明: [矛盾の内容]

矛盾がない場合:
判定: NO_CONTRADICTION`,
            },
          ],
          maxTokens: 256,
        });

        const responseText = response.content;
        if (responseText.includes("CONTRADICTION")) {
          const typeMatch = responseText.match(/種類:\s*(factual|procedural|preference)/);
          const descMatch = responseText.match(/説明:\s*(.+)/);

          const contradiction = await prisma.knowledgeContradiction.create({
            data: {
              entryAId: entryId,
              entryBId: candidate.knowledgeEntryId,
              contradictionType: typeMatch?.[1] ?? "factual",
              description: descMatch?.[1]?.trim(),
            },
          });

          // エントリのvalidationStatusをconflictに更新
          await prisma.knowledgeEntry.updateMany({
            where: { id: { in: [entryId, candidate.knowledgeEntryId] } },
            data: { validationStatus: "conflict" },
          });

          await appendEvent({
            eventType: "contradiction_detected",
            payload: {
              contradictionId: contradiction.id,
              entryAId: entryId,
              entryBId: candidate.knowledgeEntryId,
              type: contradiction.contradictionType,
            },
          });

          detectCount++;
          log.info(
            { contradictionId: contradiction.id, entryAId: entryId, entryBId: candidate.knowledgeEntryId },
            "Contradiction detected",
          );
        }
      } catch (error) {
        log.warn({ err: error, entryId, candidateId: candidate.knowledgeEntryId }, "LLM contradiction check failed");
      }
    }
  } catch (error) {
    log.debug({ err: error, entryId }, "Vector search unavailable for contradiction detection");
  }

  return detectCount;
}

/**
 * 矛盾を解決
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
    case "keep_a":
      await prisma.knowledgeEntry.update({
        where: { id: contradiction.entryBId },
        data: { forgettingStage: "archived", validationStatus: "rejected" },
      });
      break;
    case "keep_b":
      await prisma.knowledgeEntry.update({
        where: { id: contradiction.entryAId },
        data: { forgettingStage: "archived", validationStatus: "rejected" },
      });
      break;
    case "merge":
      // マージの場合は両方をvalidatedに
      await prisma.knowledgeEntry.updateMany({
        where: { id: { in: [contradiction.entryAId, contradiction.entryBId] } },
        data: { validationStatus: "validated" },
      });
      break;
    case "dismiss":
      // 無視の場合はvalidatedに戻す
      await prisma.knowledgeEntry.updateMany({
        where: { id: { in: [contradiction.entryAId, contradiction.entryBId] } },
        data: { validationStatus: "validated" },
      });
      break;
  }

  await prisma.knowledgeContradiction.update({
    where: { id: contradictionId },
    data: { resolution, resolvedAt: new Date() },
  });

  await appendEvent({
    eventType: "contradiction_resolved",
    payload: { contradictionId, resolution },
  });

  log.info({ contradictionId, resolution }, "Contradiction resolved");
}

/**
 * 未解決の矛盾一覧を取得
 */
export async function getUnresolvedContradictions(limit = 20) {
  return prisma.knowledgeContradiction.findMany({
    where: { resolution: null },
    include: {
      entryA: { select: { id: true, title: true, content: true, category: true, confidence: true } },
      entryB: { select: { id: true, title: true, content: true, category: true, confidence: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
