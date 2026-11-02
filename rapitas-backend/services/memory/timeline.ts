/**
 * タイムラインイベント管理
 * メモリシステムのイベントログ基盤
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { TimelineEventType, ActorType, TimelineQueryOptions } from './types';

const log = createLogger('memory:timeline');

/**
 * タイムラインイベントを追加
 */
export async function appendEvent(event: {
  eventType: TimelineEventType;
  actorType?: ActorType;
  actorId?: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
}): Promise<{ id: number }> {
  try {
    const created = await prisma.timelineEvent.create({
      data: {
        eventType: event.eventType,
        actorType: event.actorType ?? 'system',
        actorId: event.actorId,
        payload: JSON.stringify(event.payload ?? {}),
        correlationId: event.correlationId,
      },
    });
    log.debug({ eventType: event.eventType, id: created.id }, 'Timeline event appended');
    return { id: created.id };
  } catch (error) {
    log.error({ err: error, eventType: event.eventType }, 'Failed to append timeline event');
    throw error;
  }
}

/**
 * タイムラインイベントをクエリ
 */
/**
 * Delete every event of one type for one correlation id.
 *
 * Narrow on purpose: the two filters together identify a single subject's
 * records of a single kind, which is the only deletion the timeline needs.
 * A wider delete would make the log forgettable by accident.
 *
 * @param filter - Event type and correlation id, both required / 種別と相関ID（いずれも必須）
 * @returns How many rows were removed / 削除件数
 */
export async function deleteEvents(filter: {
  eventType: string;
  correlationId: string;
}): Promise<number> {
  const removed = await prisma.timelineEvent.deleteMany({
    where: { eventType: filter.eventType, correlationId: filter.correlationId },
  });
  return removed.count;
}

export async function queryEvents(options: TimelineQueryOptions = {}) {
  const { eventType, actorType, correlationId, since, until, limit = 50, offset = 0 } = options;

  const where: Record<string, unknown> = {};
  if (eventType) where.eventType = eventType;
  if (actorType) where.actorType = actorType;
  if (correlationId) where.correlationId = correlationId;
  if (since || until) {
    where.createdAt = {
      ...(since ? { gte: since } : {}),
      ...(until ? { lte: until } : {}),
    };
  }

  const [events, total] = await Promise.all([
    prisma.timelineEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.timelineEvent.count({ where }),
  ]);

  return {
    events: events.map((e) => ({
      ...e,
      payload: JSON.parse(e.payload),
    })),
    total,
    limit,
    offset,
  };
}
