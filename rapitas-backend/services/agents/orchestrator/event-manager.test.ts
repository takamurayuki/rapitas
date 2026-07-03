/**
 * event-manager ユニットテスト
 *
 * EventManager のリスナー登録・削除・発火（例外分離を含む）を検証する。
 */
import { describe, expect, test } from 'bun:test';
import { EventManager } from './event-manager';
import type { OrchestratorEvent } from './types';

/** テスト用の最小 OrchestratorEvent を構築する */
function makeEvent(overrides: Partial<OrchestratorEvent> = {}): OrchestratorEvent {
  return {
    type: 'execution_output',
    executionId: 1,
    sessionId: 1,
    taskId: 1,
    timestamp: new Date(),
    ...overrides,
  };
}

describe('EventManager', () => {
  test('addEventListener で登録したリスナーに emitEvent が届く', () => {
    const manager = new EventManager();
    const received: OrchestratorEvent[] = [];
    manager.addEventListener((event) => received.push(event));

    const event = makeEvent();
    manager.emitEvent(event);

    expect(received).toEqual([event]);
  });

  test('複数リスナーすべてに同じイベントが配信される', () => {
    const manager = new EventManager();
    const calls: number[] = [];
    manager.addEventListener(() => calls.push(1));
    manager.addEventListener(() => calls.push(2));

    manager.emitEvent(makeEvent());

    expect(calls.sort()).toEqual([1, 2]);
  });

  test('removeEventListener 後は該当リスナーに配信されない', () => {
    const manager = new EventManager();
    const received: OrchestratorEvent[] = [];
    const listener = (event: OrchestratorEvent) => received.push(event);

    manager.addEventListener(listener);
    manager.removeEventListener(listener);
    manager.emitEvent(makeEvent());

    expect(received).toEqual([]);
  });

  test('未登録のリスナーを removeEventListener しても例外を投げない', () => {
    const manager = new EventManager();
    expect(() => manager.removeEventListener(() => {})).not.toThrow();
  });

  test('あるリスナーが例外を投げても他のリスナーへの配信は継続する', () => {
    const manager = new EventManager();
    const received: string[] = [];
    manager.addEventListener(() => {
      throw new Error('listener boom');
    });
    manager.addEventListener(() => received.push('second'));

    expect(() => manager.emitEvent(makeEvent())).not.toThrow();
    expect(received).toEqual(['second']);
  });

  test('リスナー未登録で emitEvent しても例外を投げない', () => {
    const manager = new EventManager();
    expect(() => manager.emitEvent(makeEvent())).not.toThrow();
  });
});
