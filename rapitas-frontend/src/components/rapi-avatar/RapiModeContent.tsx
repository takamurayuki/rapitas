'use client';
/**
 * RapiModeContent
 *
 * Whichever mode is showing, drawn — and the ones you have already used,
 * kept.
 *
 * Switching tabs used to unmount the mode you were in, which threw away
 * whatever was on it: a drafted roadmap, the questions you had answered,
 * a search that took a minute. Reported as "pressing a tab loses the
 * conversation", and that is exactly what it was.
 *
 * So a mode that has been visited stays mounted and is hidden with
 * `display: none` when it is not the one showing. Hidden is out of the
 * accessibility tree and out of hit-testing, so it is as absent as
 * unmounting — it just does not throw the work away. Only visited modes
 * mount, so opening the panel still does not start five modes' worth of
 * fetching.
 *
 * `handedOver` is passed through rather than resolved here: only the panel
 * knows whether the sentence that was routed is still the one this mode is
 * showing.
 */
import { useEffect, useRef } from 'react';
import { TaskAsk, TaskConsult, TaskIntake, TaskRoadmap, TaskTidy, TaskWatch } from './intake';
import type { PanelMode } from './rapi-modes';

interface Props {
  mode: PanelMode;
  /** What was typed, if it was routed here. / この行き先に振り分けられた文 */
  handedOver: (mode: PanelMode) => string | undefined;
}

/** What each mode draws. Built once, so the map itself is stable. */
const RENDERERS: Record<PanelMode, (handedOver: Props['handedOver']) => React.ReactNode> = {
  watch: () => <TaskWatch />,
  create: (h) => <TaskIntake handedOver={h('create')} />,
  ask: (h) => <TaskAsk handedOver={h('ask')} />,
  consult: () => <TaskConsult />,
  tidy: () => <TaskTidy />,
  roadmap: (h) => <TaskRoadmap handedOver={h('roadmap')} />,
};

/**
 * @param props - The mode to draw and the sentence that reached it
 */
export function RapiModeContent({ mode, handedOver }: Props) {
  /**
   * Every mode opened so far.
   *
   * A ref rather than state: adding to it must not itself cause a render,
   * and the render that reads it is the one that put the mode in.
   */
  const visited = useRef<Set<PanelMode>>(new Set([mode]));
  visited.current.add(mode);

  // Kept so a later render still sees modes opened earlier in this session.
  useEffect(() => {
    visited.current.add(mode);
  }, [mode]);

  return (
    <>
      {[...visited.current].map((value) => (
        <div
          key={value}
          data-rapi-mode-panel={value}
          // Hidden, not removed: out of the accessibility tree and out of
          // hit-testing, while whatever is on it stays.
          {...(value === mode ? {} : { style: { display: 'none' }, 'aria-hidden': true })}
        >
          {RENDERERS[value](handedOver)}
        </div>
      ))}
    </>
  );
}
