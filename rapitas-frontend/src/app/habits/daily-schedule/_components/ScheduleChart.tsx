'use client';

/**
 * daily-schedule/_components/ScheduleChart
 *
 * 24-hour donut (clock) chart that visualises daily schedule blocks as SVG
 * arc segments. Includes hour markers, a current-time needle, and a hover
 * tooltip. Not responsible for data fetching or CRUD operations.
 */

import type { DailyScheduleBlock } from '@/types';
import { useTranslations } from 'next-intl';
import {
  timeToMinutes,
  minutesToAngle,
  polarToCartesian,
  getCategoryIcon,
  getDurationParts,
} from './schedule-utils';
import { BlockArc, CX, CY, RADIUS, INNER_RADIUS } from './BlockArc';

type ScheduleChartProps = {
  blocks: DailyScheduleBlock[];
  hoveredBlock: number | null;
  coveragePercent: number;
  totalHours: number;
  totalMins: number;
  onBlockHover: (id: number | null) => void;
  onBlockClick: (block: DailyScheduleBlock) => void;
};

/** Renders hour-marker tick lines and labels around the outer edge of the chart. */
function HourMarkers() {
  const markers = [];
  for (let h = 0; h < 24; h++) {
    const angle = minutesToAngle(h * 60);
    const outerP = polarToCartesian(CX, CY, RADIUS + 18, angle);
    const tickStart = polarToCartesian(CX, CY, RADIUS + 4, angle);
    const tickEnd = polarToCartesian(CX, CY, RADIUS + 10, angle);
    const isMajor = h % 6 === 0;
    markers.push(
      <g key={`marker-${h}`}>
        <line
          x1={tickStart.x} y1={tickStart.y}
          x2={tickEnd.x} y2={tickEnd.y}
          stroke="currentColor"
          strokeWidth={isMajor ? '2' : '1'}
          className="text-zinc-400 dark:text-zinc-500"
        />
        {isMajor && (
          <text
            x={outerP.x} y={outerP.y}
            textAnchor="middle" dominantBaseline="central"
            fontSize="12" fontWeight="600"
            fill="currentColor" className="text-zinc-600 dark:text-zinc-300"
          >
            {h}:00
          </text>
        )}
      </g>,
    );
  }
  return <>{markers}</>;
}

/** Renders the red needle indicating the current local time. */
function CurrentTimeIndicator() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const angle = minutesToAngle(currentMinutes);
  const outerP = polarToCartesian(CX, CY, RADIUS + 12, angle);
  const innerP = polarToCartesian(CX, CY, INNER_RADIUS - 5, angle);
  return (
    <g>
      <line
        x1={innerP.x} y1={innerP.y} x2={outerP.x} y2={outerP.y}
        stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round"
      />
      <circle cx={outerP.x} cy={outerP.y} r="4" fill="#EF4444" />
    </g>
  );
}

/**
 * Renders the full 24-hour donut chart with block arcs, markers, and tooltip.
 *
 * @param blocks - Schedule blocks to render / スケジュールブロック一覧
 * @param hoveredBlock - Id of the currently hovered block, or null / ホバー中ブロックID
 * @param coveragePercent - Percentage of the day covered by blocks / カバー率(%)
 * @param totalHours - Total scheduled hours / 合計時間
 * @param totalMins - Remaining minutes beyond full hours / 端数分
 * @param onBlockHover - Called on mouse enter/leave per block / ホバーコールバック
 * @param onBlockClick - Called when a block arc is clicked / クリックコールバック
 */
export function ScheduleChart({
  blocks,
  hoveredBlock,
  coveragePercent,
  totalHours,
  totalMins,
  onBlockHover,
  onBlockClick,
}: ScheduleChartProps) {
  const t = useTranslations('habits');

  const formatDuration = (startTime: string, endTime: string): string => {
    const { h, m } = getDurationParts(startTime, endTime);
    if (h === 0) return t('durationMinutes', { m });
    if (m === 0) return t('durationHours', { h });
    return t('durationHoursMinutes', { h, m });
  };

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {t('chart24h')}
        </h2>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('coveragePercent', {
            percent: coveragePercent,
            hours: totalHours,
            mins: totalMins > 0 ? `${totalMins}` : '',
          })}
        </div>
      </div>

      <div className="flex justify-center">
        <svg viewBox="0 0 400 400" className="w-full max-w-[400px]">
          {/* Background donut */}
          <circle cx={CX} cy={CY} r={RADIUS} fill="currentColor"
            className="text-zinc-100 dark:text-zinc-700/50" />
          <circle cx={CX} cy={CY} r={INNER_RADIUS} fill="currentColor"
            className="text-white dark:text-zinc-800" />

          {blocks.map((block) => (
            <BlockArc
              key={block.id}
              block={block}
              isHovered={hoveredBlock === block.id}
              onHover={onBlockHover}
              onClick={onBlockClick}
            />
          ))}

          {/* Inner overlay to punch the donut hole */}
          <circle cx={CX} cy={CY} r={INNER_RADIUS} fill="currentColor"
            className="text-white dark:text-zinc-800" />

          <text x={CX} y={CY - 8} textAnchor="middle" dominantBaseline="central"
            fontSize="14" fontWeight="700" fill="currentColor"
            className="text-zinc-800 dark:text-zinc-100">
            24h
          </text>
          <text x={CX} y={CY + 12} textAnchor="middle" dominantBaseline="central"
            fontSize="10" fill="currentColor" className="text-zinc-500 dark:text-zinc-400">
            {t('schedule')}
          </text>

          <HourMarkers />
          <CurrentTimeIndicator />
        </svg>
      </div>

      {/* Hover tooltip */}
      {hoveredBlock && (() => {
        const block = blocks.find((b) => b.id === hoveredBlock);
        if (!block) return null;
        const Icon = getCategoryIcon(block.category);
        return (
          <div className="mt-3 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-lg">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: block.color }} />
              <Icon className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                {block.label}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {block.startTime}〜{block.endTime}（
                {formatDuration(block.startTime, block.endTime)}）
              </span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
