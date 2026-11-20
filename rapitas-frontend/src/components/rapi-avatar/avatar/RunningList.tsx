'use client';
/**
 * RunningList
 *
 * The running tasks inside ラピ's status bubble: one line per task, the
 * title cut to one line and the phase as a small tag on the right. Kept to
 * the bubble's 280px — anything longer belongs in the panel.
 */
import type { DockLine } from './RapiAvatarDock';

/** Phase tag colour: blue is the app-wide running hue (ui-design-language §4). */
const PHASE_COLOR = { light: '#1D4ED8', dark: '#93C5FD' } as const;

/**
 * @param props.lines - The tasks to name / 表示するタスク
 * @param props.more - 「ほか N 件」, if some were left out / 省略件数の表示
 * @param props.dark - Whether the bubble is dark / ダーク表示か
 */
export function RunningList({
  lines,
  more,
  dark,
}: {
  lines: DockLine[];
  more?: string;
  dark: boolean;
}) {
  const text = dark ? '#F3F4F6' : '#1F2937';
  const muted = dark ? '#A1A1AA' : '#71717A';
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
      {lines.map((l) => (
        <li
          key={l.key}
          style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, minWidth: 0 }}
        >
          <span style={{ color: muted, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            #{l.taskId}
          </span>
          {/* A plain link: in her own desktop window, RapiFloatPage forwards
              in-app hrefs to the main window. showHeader keeps the way back. */}
          <a
            href={`/tasks/${l.taskId}?showHeader=true`}
            title={l.title}
            style={{
              color: text,
              textDecoration: 'none',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {l.title}
          </a>
          {l.phase && (
            <span
              style={{
                color: PHASE_COLOR[dark ? 'dark' : 'light'],
                fontSize: 11,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {l.phase}
            </span>
          )}
        </li>
      ))}
      {more && <li style={{ fontSize: 11, color: muted }}>{more}</li>}
    </ul>
  );
}
