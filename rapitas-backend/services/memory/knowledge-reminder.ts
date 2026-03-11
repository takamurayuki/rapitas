/**
 * ナレッジ自動リマインドサービス
 *
 * 忘却曲線のdecayScoreを監視し、忘れかけているナレッジを
 * 通知として能動的にリマインドする
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { boostDecayOnAccess } from './forgetting';
import { appendEvent } from './timeline';

const log = createLogger('memory:reminder');

// decayScoreがこの値を下回ったらリマインド対象
const REMINDER_THRESHOLD = 0.55;
// 1回のスキャンでリマインドする最大数
const MAX_REMINDERS_PER_SCAN = 5;
// 同じエントリのリマインド間隔（日数）
const MIN_REMINDER_INTERVAL_DAYS = 3;

interface ReminderEntry {
  id: number;
  title: string;
  content: string;
  category: string;
  decayScore: number;
  confidence: number;
  lastAccessedAt: Date | null;
  themeId: number | null;
  daysSinceAccess: number;
}

interface ReminderScanResult {
  scanned: number;
  remindersCreated: number;
  entries: ReminderEntry[];
}

/**
 * 忘れかけているナレッジをスキャンし、リマインド通知を作成
 */
export async function scanAndRemind(): Promise<ReminderScanResult> {
  try {
    const now = new Date();

    // アクティブだがdecayScoreが閾値に近いエントリを取得
    const atRiskEntries = await prisma.knowledgeEntry.findMany({
      where: {
        forgettingStage: 'active',
        decayScore: { lte: REMINDER_THRESHOLD, gt: 0.1 },
        // ピン留めされていないもの
        OR: [{ pinnedUntil: null }, { pinnedUntil: { lt: now } }],
      },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        decayScore: true,
        confidence: true,
        lastAccessedAt: true,
        themeId: true,
      },
      orderBy: { decayScore: 'asc' }, // 最もリスクの高いものから
      take: MAX_REMINDERS_PER_SCAN * 2,
    });

    // 最近リマインド済みのエントリを除外
    const minInterval = MIN_REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    const recentReminders = await prisma.notification.findMany({
      where: {
        type: 'knowledge_reminder',
        createdAt: { gte: new Date(now.getTime() - minInterval) },
      },
      select: { metadata: true },
    });

    const recentlyRemindedIds = new Set<number>();
    for (const n of recentReminders) {
      if (n.metadata) {
        try {
          const meta = JSON.parse(n.metadata);
          if (meta.entryId) recentlyRemindedIds.add(meta.entryId);
        } catch {
          // ignore
        }
      }
    }

    const candidates = atRiskEntries.filter((e) => !recentlyRemindedIds.has(e.id));
    const toRemind = candidates.slice(0, MAX_REMINDERS_PER_SCAN);

    const reminderEntries: ReminderEntry[] = [];
    let remindersCreated = 0;

    for (const entry of toRemind) {
      const daysSinceAccess = entry.lastAccessedAt
        ? Math.round((now.getTime() - entry.lastAccessedAt.getTime()) / (24 * 60 * 60 * 1000))
        : -1;

      reminderEntries.push({
        ...entry,
        content: entry.content.slice(0, 200),
        daysSinceAccess,
      });

      // 通知作成
      await prisma.notification.create({
        data: {
          type: 'knowledge_reminder',
          title: '忘れかけているナレッジ',
          message: `「${entry.title}」を復習しませんか？（${daysSinceAccess >= 0 ? `${daysSinceAccess}日間アクセスなし` : '未アクセス'}、記憶強度: ${Math.round(entry.decayScore * 100)}%）`,
          link: `/knowledge`,
          metadata: JSON.stringify({
            entryId: entry.id,
            decayScore: entry.decayScore,
            daysSinceAccess,
            category: entry.category,
          }),
        },
      });

      remindersCreated++;
    }

    if (remindersCreated > 0) {
      await appendEvent({
        eventType: 'knowledge_reminder_sent',
        actorType: 'system',
        payload: {
          count: remindersCreated,
          entryIds: reminderEntries.map((e) => e.id),
        },
      });

      log.info({ count: remindersCreated }, 'Knowledge reminders created');
    }

    return {
      scanned: atRiskEntries.length,
      remindersCreated,
      entries: reminderEntries,
    };
  } catch (error) {
    log.error({ err: error }, 'Failed to scan and remind');
    return { scanned: 0, remindersCreated: 0, entries: [] };
  }
}

/**
 * ナレッジを復習済みとしてマーク（decayScore回復）
 */
export async function markAsReviewed(entryId: number): Promise<{
  success: boolean;
  newDecayScore: number;
  newStage: string;
}> {
  try {
    await boostDecayOnAccess(entryId);

    const updated = await prisma.knowledgeEntry.findUnique({
      where: { id: entryId },
      select: { decayScore: true, forgettingStage: true },
    });

    if (!updated) {
      return { success: false, newDecayScore: 0, newStage: 'archived' };
    }

    await appendEvent({
      eventType: 'knowledge_reviewed',
      actorType: 'user',
      payload: { entryId },
    });

    log.info({ entryId, newDecay: updated.decayScore }, 'Knowledge reviewed');

    return {
      success: true,
      newDecayScore: updated.decayScore,
      newStage: updated.forgettingStage,
    };
  } catch (error) {
    log.error({ err: error, entryId }, 'Failed to mark as reviewed');
    return { success: false, newDecayScore: 0, newStage: 'unknown' };
  }
}

/**
 * リマインド対象のサマリー（ダッシュボード表示用）
 */
export async function getReminderSummary(): Promise<{
  atRiskCount: number;
  dormantCount: number;
  recentlyReviewedCount: number;
  topAtRisk: Array<{ id: number; title: string; decayScore: number; category: string }>;
}> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [atRisk, dormant, reviewed, topAtRisk] = await Promise.all([
    prisma.knowledgeEntry.count({
      where: {
        forgettingStage: 'active',
        decayScore: { lte: REMINDER_THRESHOLD },
      },
    }),
    prisma.knowledgeEntry.count({
      where: { forgettingStage: 'dormant' },
    }),
    prisma.knowledgeEntry.count({
      where: {
        lastAccessedAt: { gte: sevenDaysAgo },
      },
    }),
    prisma.knowledgeEntry.findMany({
      where: {
        forgettingStage: 'active',
        decayScore: { lte: REMINDER_THRESHOLD, gt: 0.1 },
      },
      select: { id: true, title: true, decayScore: true, category: true },
      orderBy: { decayScore: 'asc' },
      take: 5,
    }),
  ]);

  return {
    atRiskCount: atRisk,
    dormantCount: dormant,
    recentlyReviewedCount: reviewed,
    topAtRisk,
  };
}
