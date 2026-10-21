'use client';
/**
 * RapiModeContent
 *
 * Whichever mode is showing, drawn.
 *
 * One switch, lifted out of the panel so the panel is about the frame —
 * header, tabs, scroll area, composer — and this is about what goes in it.
 * It also means adding a mode touches the mode list, this file and nothing
 * else.
 *
 * `handedOver` is passed through rather than resolved here: only the panel
 * knows whether the sentence that was routed is still the one this mode is
 * showing.
 */
import { TaskAsk, TaskConsult, TaskIntake, TaskRoadmap, TaskTidy, TaskWatch } from './intake';
import type { PanelMode } from './rapi-modes';

interface Props {
  mode: PanelMode;
  /** What was typed, if it was routed here. / この行き先に振り分けられた文 */
  handedOver: (mode: PanelMode) => string | undefined;
}

/**
 * @param props - The mode to draw and the sentence that reached it
 */
export function RapiModeContent({ mode, handedOver }: Props) {
  switch (mode) {
    case 'watch':
      return <TaskWatch />;
    case 'create':
      return <TaskIntake handedOver={handedOver('create')} />;
    case 'ask':
      return <TaskAsk handedOver={handedOver('ask')} />;
    case 'consult':
      return <TaskConsult />;
    case 'tidy':
      return <TaskTidy />;
    case 'roadmap':
      return <TaskRoadmap handedOver={handedOver('roadmap')} />;
    default:
      return null;
  }
}
