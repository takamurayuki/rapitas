/**
 * event-emitter-properties.test.ts
 *
 * Cross-cutting property tests for AgentEventEmitter.
 * Verifies mandatory fields across all 10 event types, covers the 4 untested
 * emit methods (question/artifact/commit/metrics_update), boundary conditions,
 * and stream multi-type filtering.
 *
 * NOTE: Record<AgentEventType, true> / Record<AgentState, true> completeness
 * objects enforce that all union members are declared here at compile time.
 * Adding a new AgentEventType or AgentState without updating these objects
 * causes tsc to fail — intentional design to catch coverage gaps early.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { AgentEventEmitter } from '../services/agents/abstraction/event-emitter';
import type {
  AgentEvent,
  AgentEventType,
  AgentState,
  QuestionEvent,
  ArtifactEvent,
  CommitEvent,
  MetricsUpdateEvent,
  OutputEvent,
  ErrorEvent,
  StateChangeEvent,
  ProgressEvent,
  ExecutionMetrics,
  PendingQuestion,
  AgentArtifact,
  GitCommitInfo,
} from '../services/agents/abstraction/types';

// ============================================================================
// Completeness guards — tsc fails if any union member is missing
// NOTE: These objects are the single source of truth for type-coverage
// enforcement. Object.keys() over these produces the canonical lists below.
// ============================================================================

/** Ensures every AgentEventType is represented at compile time. */
const EVENT_TYPE_COMPLETENESS: Record<AgentEventType, true> = {
  state_change: true,
  output: true,
  error: true,
  tool_start: true,
  tool_end: true,
  question: true,
  progress: true,
  artifact: true,
  commit: true,
  metrics_update: true,
};

/** Ensures every AgentState is represented at compile time. */
const STATE_COMPLETENESS: Record<AgentState, true> = {
  idle: true,
  initializing: true,
  running: true,
  waiting_for_input: true,
  paused: true,
  completing: true,
  completed: true,
  failed: true,
  cancelled: true,
  timeout: true,
};

const AGENT_EVENT_TYPES = Object.keys(EVENT_TYPE_COMPLETENESS) as AgentEventType[];
const AGENT_STATES = Object.keys(STATE_COMPLETENESS) as AgentState[];

// ============================================================================
// Fixture factories
// ============================================================================

function makeQuestion(): PendingQuestion {
  return {
    questionId: 'q-1',
    text: 'What should I do next?',
    category: 'clarification',
    options: [{ label: 'Option A', value: 'a' }],
  };
}

function makeArtifact(): AgentArtifact {
  return {
    type: 'file',
    name: 'output.ts',
    content: 'export const x = 1;',
  };
}

function makeCommit(): GitCommitInfo {
  return {
    hash: 'abc1234',
    message: 'feat: add feature',
    branch: 'feature/test',
    filesChanged: 2,
    additions: 10,
    deletions: 3,
  };
}

function makeMetrics(): Partial<ExecutionMetrics> {
  // NOTE: startTime is intentionally omitted — Partial<ExecutionMetrics> makes
  // all fields optional, including startTime.
  return {
    tokensUsed: 500,
    durationMs: 1200,
  };
}

// ============================================================================
// Harness helper
// ============================================================================

/**
 * Registers an onAll listener and collects received events in an array.
 *
 * @param emitter - Target emitter to observe.
 * @returns collected events array and an unsubscribe function.
 */
function createHarness(emitter: AgentEventEmitter): { received: AgentEvent[]; unsub: () => void } {
  const received: AgentEvent[] = [];
  const unsub = emitter.onAll((event) => {
    received.push(event);
  });
  return { received, unsub };
}

// ============================================================================
// Tests
// ============================================================================

describe('AgentEventEmitter — プロパティ横断テスト', () => {
  let emitter: AgentEventEmitter;

  beforeEach(() => {
    emitter = new AgentEventEmitter('test-agent', 'exec-1');
  });

  // --------------------------------------------------------------------------
  // 横断テンプレート: 必須フィールド（全10イベントタイプ）
  // --------------------------------------------------------------------------

  describe('全イベントタイプ横断: 必須フィールド存在', () => {
    // Drive table: [eventType, emitFn]
    // NOTE: emitOutput must use a valid non-null/non-undefined string.
    // null/'null'/'undefined' are silently skipped by emitOutput (see
    // event-emitter.ts:231), so they would produce 0 received events.
    const driveTable: Array<[AgentEventType, (e: AgentEventEmitter) => Promise<void>]> = [
      ['state_change',   (e) => e.emitStateChange('idle', 'running')],
      ['output',         (e) => e.emitOutput('hello world')],
      ['error',          (e) => e.emitError(new Error('test'))],
      ['tool_start',     (e) => e.emitToolStart('t1', 'read', { path: '/a' })],
      ['tool_end',       (e) => e.emitToolEnd('t1', 'read', 'ok', true, 100)],
      ['question',       (e) => e.emitQuestion(makeQuestion())],
      ['progress',       (e) => e.emitProgress(1, 10, 'step 1')],
      ['artifact',       (e) => e.emitArtifact(makeArtifact())],
      ['commit',         (e) => e.emitCommit(makeCommit())],
      ['metrics_update', (e) => e.emitMetricsUpdate(makeMetrics())],
    ];

    test('駆動テーブルが全 AgentEventType を網羅すること', () => {
      // NOTE: Runtime safety net complementing the compile-time Record check.
      // Catches cases where the drive table omits a type added to the Record.
      expect(driveTable.length).toBe(AGENT_EVENT_TYPES.length);
      const tableTypes = driveTable.map(([type]) => type).sort();
      expect(tableTypes).toEqual([...AGENT_EVENT_TYPES].sort());
    });

    test.each(driveTable)(
      '%s イベントに type/timestamp/executionId/agentId が存在すること',
      async (eventType, emitFn) => {
        const { received } = createHarness(emitter);
        await emitFn(emitter);

        expect(received).toHaveLength(1);
        const event = received[0];
        expect(event.type).toBe(eventType);
        expect(event.timestamp).toBeInstanceOf(Date);
        expect(event.executionId).toBe('exec-1');
        expect(event.agentId).toBe('test-agent');
      },
    );
  });

  // --------------------------------------------------------------------------
  // 欠落イベント4種: emit → receive ペイロード検証
  // --------------------------------------------------------------------------

  describe('emitQuestion', () => {
    test('question フィールドが正しく伝播すること', async () => {
      let received: QuestionEvent | null = null;
      emitter.on<QuestionEvent>('question', (event) => {
        received = event;
      });

      await emitter.emitQuestion(makeQuestion());

      expect(received).not.toBeNull();
      expect(received!.question.questionId).toBe('q-1');
      expect(received!.question.text).toBe('What should I do next?');
      expect(received!.question.category).toBe('clarification');
    });
  });

  describe('emitArtifact', () => {
    test('artifact フィールドが正しく伝播すること', async () => {
      let received: ArtifactEvent | null = null;
      emitter.on<ArtifactEvent>('artifact', (event) => {
        received = event;
      });

      await emitter.emitArtifact(makeArtifact());

      expect(received).not.toBeNull();
      expect(received!.artifact.type).toBe('file');
      expect(received!.artifact.name).toBe('output.ts');
      expect(received!.artifact.content).toBe('export const x = 1;');
    });
  });

  describe('emitCommit', () => {
    test('commit の必須6フィールドが正しく伝播すること', async () => {
      let received: CommitEvent | null = null;
      emitter.on<CommitEvent>('commit', (event) => {
        received = event;
      });

      await emitter.emitCommit(makeCommit());

      expect(received).not.toBeNull();
      expect(received!.commit.hash).toBe('abc1234');
      expect(received!.commit.message).toBe('feat: add feature');
      expect(received!.commit.branch).toBe('feature/test');
      expect(received!.commit.filesChanged).toBe(2);
      expect(received!.commit.additions).toBe(10);
      expect(received!.commit.deletions).toBe(3);
    });
  });

  describe('emitMetricsUpdate', () => {
    test('Partial<ExecutionMetrics> のフィールドが正しく伝播すること', async () => {
      let received: MetricsUpdateEvent | null = null;
      emitter.on<MetricsUpdateEvent>('metrics_update', (event) => {
        received = event;
      });

      await emitter.emitMetricsUpdate(makeMetrics());

      expect(received).not.toBeNull();
      expect(received!.metrics.tokensUsed).toBe(500);
      expect(received!.metrics.durationMs).toBe(1200);
      // Verifies Partial allows omitting startTime
      expect(received!.metrics.startTime).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 境界値: maxHistorySize = 1000
  // --------------------------------------------------------------------------

  describe('maxHistorySize 境界', () => {
    test('1001件 emit 後に履歴が1000件以下でかつ最古が drop されること', async () => {
      for (let i = 0; i < 1001; i++) {
        await emitter.emitProgress(i, 1001);
      }

      const history = emitter.getEventHistory();
      expect(history.length).toBe(1000);
      // The first event (current=0) was dropped; oldest remaining is current=1
      expect((history[0] as ProgressEvent).current).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 分岐テスト
  // --------------------------------------------------------------------------

  describe('emitOutput — isError/isPartial 分岐', () => {
    test('isError=true, isPartial=true のとき受信イベントに反映されること', async () => {
      let received: OutputEvent | null = null;
      emitter.on<OutputEvent>('output', (event) => {
        received = event;
      });

      await emitter.emitOutput('stderr line', true, true);

      expect(received).not.toBeNull();
      expect(received!.isError).toBe(true);
      expect(received!.isPartial).toBe(true);
      expect(received!.content).toBe('stderr line');
    });
  });

  describe('emitError — recoverable/context 分岐', () => {
    test('recoverable=true と context が伝播すること', async () => {
      let received: ErrorEvent | null = null;
      emitter.on<ErrorEvent>('error', (event) => {
        received = event;
      });

      await emitter.emitError(new Error('transient'), true, 'retry context');

      expect(received).not.toBeNull();
      expect(received!.recoverable).toBe(true);
      expect(received!.context).toBe('retry context');
    });
  });

  // --------------------------------------------------------------------------
  // プロパティ: イベント順序不変条件
  // --------------------------------------------------------------------------

  describe('イベント順序不変条件', () => {
    test('複数タイプ混在 emit 後 getEventHistory() が emit 順と一致すること', async () => {
      await emitter.emitOutput('first');
      await emitter.emitError(new Error('second'));
      await emitter.emitProgress(1, 3, 'third');
      await emitter.emitOutput('fourth');

      const history = emitter.getEventHistory();
      expect(history).toHaveLength(4);
      expect(history[0].type).toBe('output');
      expect(history[1].type).toBe('error');
      expect(history[2].type).toBe('progress');
      expect(history[3].type).toBe('output');
    });
  });

  // --------------------------------------------------------------------------
  // プロパティ: state_change 状態集合所属
  // --------------------------------------------------------------------------

  describe('state_change — 状態集合プロパティ', () => {
    test('AGENT_STATES が AgentState の全10メンバーを網羅すること', () => {
      // NOTE: 10種は timeout を含む。research.md は誤って9種と記載していたが
      // 実コード agent-identification.ts:19 が正とする。
      expect(AGENT_STATES).toHaveLength(10);
    });

    const representativeTransitions: Array<[AgentState, AgentState]> = [
      ['idle', 'running'],
      ['running', 'completed'],
      ['running', 'failed'],
      ['running', 'cancelled'],
      ['initializing', 'running'],
    ];

    test.each(representativeTransitions)(
      'state_change(%s → %s) の previousState/newState が AGENT_STATES に属すること',
      async (from, to) => {
        let received: StateChangeEvent | null = null;
        emitter.on<StateChangeEvent>('state_change', (event) => {
          received = event;
        });

        await emitter.emitStateChange(from, to);

        expect(received).not.toBeNull();
        expect(AGENT_STATES).toContain(received!.previousState);
        expect(AGENT_STATES).toContain(received!.newState);
      },
    );
  });

  // --------------------------------------------------------------------------
  // stream — 複数タイプフィルタ
  // --------------------------------------------------------------------------

  describe('stream — 複数タイプフィルタ', () => {
    test("stream(['error','commit']) が指定2タイプのみ受信し、他はスキップすること", async () => {
      const stream = emitter.stream(['error', 'commit']);
      const iterator = stream[Symbol.asyncIterator]();

      // emit: output (filtered out), error (pass), progress (filtered out), commit (pass)
      await emitter.emitOutput('ignored');
      await emitter.emitError(new Error('captured-error'));
      await emitter.emitProgress(1, 2, 'ignored-progress');
      await emitter.emitCommit(makeCommit());

      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect(first.value.type).toBe('error');

      const second = await iterator.next();
      expect(second.done).toBe(false);
      expect(second.value.type).toBe('commit');

      await iterator.return!();
    });
  });
});
