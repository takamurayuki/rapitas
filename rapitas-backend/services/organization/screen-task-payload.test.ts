/**
 * screen-task-payload.test
 *
 * Covers the task a screen becomes. What matters is that the task is
 * finishable and that finishing it leaves the screen REACHABLE — a screen
 * component that renders in a unit test and is mounted by nothing is the
 * TempoRaid outcome, not a fix for it.
 */
import { describe, test, expect } from 'bun:test';
import { toScreenTaskPayload, SCREEN_TASK_PREFIX, screenTaskTitle } from './screen-task-payload';
import { RUNTIME_CONFIG_FILE } from './project-bootstrap-task';
import type { ScreenTaskSpec } from './screen-task-plan';

const screen = (over: Partial<ScreenTaskSpec> = {}): ScreenTaskSpec => ({
  name: 'ロビー',
  detail: '曲読込ドロップゾーン、ルーム作成。解析後にルーム待機へ遷移。',
  featureIds: ['F-02', 'F-03'],
  ...over,
});

describe('screenTaskTitle', () => {
  test('is the prefix plus the screen name, so filing is idempotent by name', () => {
    expect(screenTaskTitle('ロビー')).toBe(`${SCREEN_TASK_PREFIX} ロビー`);
  });
});

describe('toScreenTaskPayload', () => {
  test('titles the task by name and belongs it to the theme', () => {
    const p = toScreenTaskPayload(screen(), { themeId: 35, outOfScope: [] });
    expect(p.title).toBe(`${SCREEN_TASK_PREFIX} ロビー`);
    expect(p.themeId).toBe(35);
  });

  test('carries the document prose, so the implementer needs no second file', () => {
    const p = toScreenTaskPayload(screen(), { themeId: 1, outOfScope: [] });
    expect(p.description).toContain('曲読込ドロップゾーン');
  });

  test('names the route when the document gives one', () => {
    const p = toScreenTaskPayload(screen({ route: '/lobby' }), { themeId: 1, outOfScope: [] });
    expect(p.description).toContain('/lobby');
  });

  test('names the features that must become startable from this screen', () => {
    const p = toScreenTaskPayload(screen(), { themeId: 1, outOfScope: [] });
    expect(p.description).toContain('F-02');
    expect(p.description).toContain('F-03');
  });

  test('says so plainly when no 画面導線 lands here, instead of implying none exist', () => {
    const p = toScreenTaskPayload(screen({ featureIds: [] }), { themeId: 1, outOfScope: [] });
    expect(p.description).toContain('画面導線');
  });

  test('requires reachability from the entry point, not just a rendering component', () => {
    const criteria = toScreenTaskPayload(screen(), {
      themeId: 1,
      outOfScope: [],
    }).acceptanceCriteria.join('\n');
    // A component nothing mounts is exactly what shipped last time.
    expect(criteria).toContain('起動');
    for (const c of toScreenTaskPayload(screen(), { themeId: 1, outOfScope: [] })
      .acceptanceCriteria) {
      expect(c).toContain('Given');
      expect(c).toContain('Then');
    }
  });

  test('constrains the screen task to structure, leaving behaviour to the feature tasks', () => {
    const c = toScreenTaskPayload(screen(), { themeId: 1, outOfScope: [] }).constraints.join('\n');
    expect(c).toContain('F-02');
  });

  test('carries the document out-of-scope items as constraints', () => {
    const p = toScreenTaskPayload(screen(), { themeId: 1, outOfScope: ['決済'] });
    expect(p.constraints.some((x) => x.includes('決済'))).toBe(true);
  });

  // runtime-smoke's reachability check reads featureEntries from
  // rapitas.runtime.json. Nothing wrote one, so evaluateFeatureReachability
  // returned 'unknown' and applyFeatureReachability passed every verdict
  // through — the check has been inert for every project. The screen task is
  // where the entry can be written with a path that actually exists.
  describe('featureEntries registration', () => {
    test('asks the screen to register an entry for each feature it hosts', () => {
      const p = toScreenTaskPayload(screen(), { themeId: 1, outOfScope: [] });
      const all = [p.description, ...p.goals, ...p.acceptanceCriteria].join('\n');
      expect(all).toContain('featureEntries');
      expect(all).toContain(RUNTIME_CONFIG_FILE);
    });

    test('names the exact feature ids that must appear, not just "the features"', () => {
      const criteria = toScreenTaskPayload(screen(), {
        themeId: 1,
        outOfScope: [],
      }).acceptanceCriteria.join('\n');
      expect(criteria).toContain('F-02');
      expect(criteria).toContain('F-03');
    });

    test('spells out the entry shape, so the implementer writes valid config', () => {
      const p = toScreenTaskPayload(screen(), { themeId: 1, outOfScope: [] });
      expect(p.description).toContain('"id"');
      expect(p.description).toContain('"file"');
      expect(p.description).toContain('"marker"');
    });

    test('forbids dropping entries other screens registered', () => {
      const c = toScreenTaskPayload(screen(), { themeId: 1, outOfScope: [] }).constraints.join(
        '\n',
      );
      expect(c).toContain('追記');
    });

    test('asks for nothing when no feature is reached from this screen', () => {
      const p = toScreenTaskPayload(screen({ featureIds: [] }), { themeId: 1, outOfScope: [] });
      const all = [p.description, ...p.goals, ...p.acceptanceCriteria, ...p.constraints].join('\n');
      expect(all).not.toContain('featureEntries');
    });
  });
});
