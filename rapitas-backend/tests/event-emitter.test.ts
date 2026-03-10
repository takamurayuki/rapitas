import { describe, test, expect, beforeEach } from 'bun:test';
import {
  AgentEventEmitter,
  createAgentEventEmitter,
} from '../services/agents/abstraction/event-emitter';
import type {
  AgentEvent,
  OutputEvent,
  StateChangeEvent,
} from '../services/agents/abstraction/types';

describe('AgentEventEmitter', () => {
  let emitter: AgentEventEmitter;

  beforeEach(() => {
    emitter = new AgentEventEmitter('test-agent', 'exec-1');
  });

  describe('リスナー登録・解除', () => {
    test('onでリスナーを登録できること', () => {
      emitter.on('output', () => {});
      expect(emitter.listenerCount('output')).toBe(1);
    });

    test('unsubscribe関数でリスナーを解除できること', () => {
      const unsub = emitter.on('output', () => {});
      unsub();
      expect(emitter.listenerCount('output')).toBe(0);
    });

    test('onceでリスナーを登録できること', () => {
      emitter.once('error', () => {});
      expect(emitter.listenerCount('error')).toBe(1);
    });

    test('onAllで全イベントリスナーを登録できること', () => {
      emitter.onAll(() => {});
      expect(emitter.listenerCount()).toBe(1);
    });

    test('onAllのunsubscribeが機能すること', () => {
      const unsub = emitter.onAll(() => {});
      unsub();
      expect(emitter.listenerCount()).toBe(0);
    });

    test('removeAllListenersで特定タイプのリスナーを削除すること', () => {
      emitter.on('output', () => {});
      emitter.on('error', () => {});
      emitter.removeAllListeners('output');
      expect(emitter.listenerCount('output')).toBe(0);
      expect(emitter.listenerCount('error')).toBe(1);
    });

    test('removeAllListenersで全リスナーを削除すること', () => {
      emitter.on('output', () => {});
      emitter.onAll(() => {});
      emitter.removeAllListeners();
      expect(emitter.listenerCount()).toBe(0);
    });

    test('複数リスナーを同一タイプに登録できること', () => {
      emitter.on('output', () => {});
      emitter.on('output', () => {});
      emitter.on('output', () => {});
      expect(emitter.listenerCount('output')).toBe(3);
    });
  });

  describe('イベント発行', () => {
    test('emitでタイプ別リスナーが呼ばれること', async () => {
      const received: string[] = [];
      emitter.on<OutputEvent>('output', (event) => {
        received.push(event.content);
      });

      await emitter.emitOutput('Hello');
      expect(received).toEqual(['Hello']);
    });

    test('emitでonAllリスナーが呼ばれること', async () => {
      const types: string[] = [];
      emitter.onAll((event) => {
        types.push(event.type);
      });

      await emitter.emitOutput('test');
      await emitter.emitError(new Error('test'));
      expect(types).toEqual(['output', 'error']);
    });

    test('onceリスナーが1回だけ呼ばれること', async () => {
      let callCount = 0;
      emitter.once('output', () => {
        callCount++;
      });

      await emitter.emitOutput('first');
      await emitter.emitOutput('second');
      expect(callCount).toBe(1);
    });

    test('ハンドラーエラー時も他のリスナーが呼ばれること', async () => {
      let secondCalled = false;

      emitter.on('output', () => {
        throw new Error('handler error');
      });
      emitter.on('output', () => {
        secondCalled = true;
      });

      await emitter.emitOutput('test');
      expect(secondCalled).toBe(true);
    });
  });

  describe('イベント履歴', () => {
    test('emitしたイベントが履歴に追加されること', async () => {
      await emitter.emitOutput('A');
      await emitter.emitOutput('B');

      const history = emitter.getEventHistory();
      expect(history).toHaveLength(2);
    });

    test('タイプでフィルタできること', async () => {
      await emitter.emitOutput('text');
      await emitter.emitError(new Error('err'));
      await emitter.emitOutput('text2');

      const outputHistory = emitter.getEventHistory('output');
      expect(outputHistory).toHaveLength(2);
    });

    test('件数で制限できること', async () => {
      await emitter.emitOutput('A');
      await emitter.emitOutput('B');
      await emitter.emitOutput('C');

      const limited = emitter.getEventHistory(undefined, 2);
      expect(limited).toHaveLength(2);
    });

    test('clearEventHistoryで履歴がクリアされること', async () => {
      await emitter.emitOutput('A');
      emitter.clearEventHistory();
      expect(emitter.getEventHistory()).toHaveLength(0);
    });
  });

  describe('convenience methods', () => {
    test('emitStateChangeが正しいイベントを発行すること', async () => {
      let received: StateChangeEvent | null = null;
      emitter.on<StateChangeEvent>('state_change', (event) => {
        received = event;
      });

      await emitter.emitStateChange('idle', 'running', 'task started');
      expect(received).not.toBeNull();
      expect(received!.type).toBe('state_change');
      expect(received!.previousState).toBe('idle');
      expect(received!.newState).toBe('running');
      expect(received!.reason).toBe('task started');
      expect(received!.agentId).toBe('test-agent');
      expect(received!.executionId).toBe('exec-1');
    });

    test('emitOutputがnull/undefinedをスキップすること', async () => {
      let callCount = 0;
      emitter.on('output', () => {
        callCount++;
      });

      await emitter.emitOutput(null as unknown as string);
      await emitter.emitOutput('null');
      await emitter.emitOutput('undefined');
      expect(callCount).toBe(0);
    });

    test('emitErrorが正しいイベントを発行すること', async () => {
      let received: AgentEvent | null = null;
      emitter.on('error', (event) => {
        received = event;
      });

      await emitter.emitError(new Error('test'), true, 'context');
      expect(received).not.toBeNull();
      expect(received!.type).toBe('error');
    });

    test('emitProgressが正しいイベントを発行すること', async () => {
      let received: AgentEvent | null = null;
      emitter.on('progress', (event) => {
        received = event;
      });

      await emitter.emitProgress(5, 10, 'halfway', 'subtask-1');
      expect(received).not.toBeNull();
      expect(received!.type).toBe('progress');
    });

    test('emitToolStart/Endが正しいイベントを発行すること', async () => {
      const events: AgentEvent[] = [];
      emitter.onAll((event) => {
        events.push(event);
      });

      await emitter.emitToolStart('t1', 'read', { path: '/test' });
      await emitter.emitToolEnd('t1', 'read', 'content', true, 100);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('tool_start');
      expect(events[1].type).toBe('tool_end');
    });

    test('全イベントにtimestampとexecutionIdが含まれること', async () => {
      let received: AgentEvent | null = null;
      emitter.onAll((event) => {
        received = event;
      });

      await emitter.emitOutput('test');
      expect(received!.timestamp).toBeInstanceOf(Date);
      expect(received!.executionId).toBe('exec-1');
      expect(received!.agentId).toBe('test-agent');
    });
  });

  describe('setExecutionId', () => {
    test('実行IDを変更できること', async () => {
      emitter.setExecutionId('exec-new');

      let received: AgentEvent | null = null;
      emitter.onAll((event) => {
        received = event;
      });

      await emitter.emitOutput('test');
      expect(received!.executionId).toBe('exec-new');
    });
  });

  describe('stream', () => {
    test('AsyncIterableでイベントを受信できること', async () => {
      const stream = emitter.stream();
      const iterator = stream[Symbol.asyncIterator]();

      await emitter.emitOutput('A');
      await emitter.emitOutput('B');

      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect((first.value as OutputEvent).content).toBe('A');

      const second = await iterator.next();
      expect(second.done).toBe(false);
      expect((second.value as OutputEvent).content).toBe('B');

      const result = await iterator.return!();
      expect(result.done).toBe(true);
    });

    test('タイプフィルタが適用されること', async () => {
      const stream = emitter.stream(['error']);
      const iterator = stream[Symbol.asyncIterator]();

      await emitter.emitOutput('ignored');
      await emitter.emitError(new Error('captured'));

      const first = await iterator.next();
      expect(first.value.type).toBe('error');

      await iterator.return!();
    });
  });

  describe('createAgentEventEmitter', () => {
    test('ファクトリー関数でインスタンスを作成できること', () => {
      const em = createAgentEventEmitter('agent-x', 'exec-x');
      expect(em).toBeInstanceOf(AgentEventEmitter);
    });
  });
});
