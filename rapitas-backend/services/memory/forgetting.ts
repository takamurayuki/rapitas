/**
 * 忘却システム（3段階忘却）
 * active (decayScore≥0.5) → dormant (0.1≤score<0.5) → archived (score<0.1)
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { appendEvent } from './timeline';

const log = createLogger('memory:forgetting');

/**
 * 減衰スコアを計算
 * newDecay = decayScore * (0.95 ^ daysSinceLastAccess) * (0.5 + confidence * 0.5)
 */
function calculateDecay(
  currentDecay: number,
  confidence: number,
  lastAccessedAt: Date | null,
  lastDecayAt: Date,
): number {
  const now = new Date();
  const referenceDate = lastAccessedAt ?? lastDecayAt;
  const daysSince = (now.getTime() - referenceDate.getTime()) / (24 * 60 * 60 * 1000);

  const decay = currentDecay * Math.pow(0.95, daysSince) * (0.5 + confidence * 0.5);
  return Math.max(0, Math.min(1, decay));
}

/**
 * forgettingStageを判定
 */
function determineStage(decayScore: number): 'active' | 'dormant' | 'archived' {
  if (decayScore >= 0.5) return 'active';
  if (decayScore >= 0.1) return 'dormant';
  return 'archived';
}

/**
 * 忘却スイープを実行
 * すべてのactive/dormantエントリの減衰スコアを更新し、ステージを遷移
 */
export async function runForgettingSweep(): Promise<{
  processed: number;
  transitioned: { toDormant: number; toArchived: number };
}> {
  const entries = await prisma.knowledgeEntry.findMany({
    where: {
      forgettingStage: { in: ['active', 'dormant'] },
    },
    select: {
      id: true,
      decayScore: true,
      confidence: true,
      lastAccessedAt: true,
      lastDecayAt: true,
      forgettingStage: true,
      pinnedUntil: true,
    },
  });

  // pinnedでないもののみ処理（pinnedUntilが未来の場合はスキップ）
  const now = new Date();
  const processable = entries.filter((e) => !e.pinnedUntil || e.pinnedUntil <= now);

  let toDormant = 0;
  let toArchived = 0;

  for (const entry of processable) {
    const newDecay = calculateDecay(
      entry.decayScore,
      entry.confidence,
      entry.lastAccessedAt,
      entry.lastDecayAt,
    );
    const newStage = determineStage(newDecay);
    const stageChanged = newStage !== entry.forgettingStage;

    if (stageChanged) {
      if (newStage === 'dormant') toDormant++;
      if (newStage === 'archived') toArchived++;
    }

    await prisma.knowledgeEntry.update({
      where: { id: entry.id },
      data: {
        decayScore: newDecay,
        lastDecayAt: now,
        forgettingStage: newStage,
      },
    });
  }

  await appendEvent({
    eventType: 'forgetting_sweep',
    payload: {
      processed: processable.length,
      toDormant,
      toArchived,
    },
  });

  log.info({ processed: processable.length, toDormant, toArchived }, 'Forgetting sweep completed');

  return {
    processed: processable.length,
    transitioned: { toDormant, toArchived },
  };
}

/**
 * アクセス時にdecayを回復
 * min(1.0, current + 0.3)
 */
export async function boostDecayOnAccess(entryId: number): Promise<void> {
  const entry = await prisma.knowledgeEntry.findUnique({
    where: { id: entryId },
    select: { decayScore: true },
  });

  if (!entry) return;

  const newDecay = Math.min(1.0, entry.decayScore + 0.3);
  const newStage = determineStage(newDecay);

  await prisma.knowledgeEntry.update({
    where: { id: entryId },
    data: {
      decayScore: newDecay,
      forgettingStage: newStage,
      accessCount: { increment: 1 },
      lastAccessedAt: new Date(),
    },
  });
}
