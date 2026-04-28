'use client';

/**
 * daily-schedule/_components/BlockArc
 *
 * SVG group rendering a single donut-arc segment for a DailyScheduleBlock.
 * Extracted from ScheduleChart to keep individual files under 300 lines.
 * Not responsible for data fetching or hover state management.
 */

import type { DailyScheduleBlock } from '@/types';
import { timeToMinutes, minutesToAngle, polarToCartesian } from './schedule-utils';

/** SVG chart constants shared with ScheduleChart. */
export const CX = 200;
export const CY = 200;
export const RADIUS = 170;
export const INNER_RADIUS = 70;

type BlockArcProps = {
  block: DailyScheduleBlock;
  isHovered: boolean;
  onHover: (id: number | null) => void;
  onClick: (block: DailyScheduleBlock) => void;
};

/**
 * Renders a donut arc path and optional label for one schedule block.
 *
 * @param block - The schedule block data / スケジュールブロック
 * @param isHovered - Whether this arc is currently hovered / ホバー中フラグ
 * @param onHover - Called on mouse enter/leave / ホバーコールバック
 * @param onClick - Called when the arc is clicked / クリックコールバック
 */
export function BlockArc({ block, isHovered, onHover, onClick }: BlockArcProps) {
  const startMin = timeToMinutes(block.startTime);
  let endMin = timeToMinutes(block.endTime);
  if (endMin <= startMin) endMin += 1440;

  const startAngle = minutesToAngle(startMin);
  const endAngle = minutesToAngle(endMin);
  const currentRadius = isHovered ? RADIUS + 8 : RADIUS;

  const outerStart = polarToCartesian(CX, CY, currentRadius, startAngle);
  const outerEnd = polarToCartesian(CX, CY, currentRadius, endAngle);
  const innerStart = polarToCartesian(CX, CY, INNER_RADIUS, startAngle);
  const innerEnd = polarToCartesian(CX, CY, INNER_RADIUS, endAngle);

  let sweep = endAngle - startAngle;
  if (sweep < 0) sweep += 360;
  const largeArc = sweep > 180 ? 1 : 0;

  const donutPath = [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${currentRadius} ${currentRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    `Z`,
  ].join(' ');

  const midAngle = startAngle + sweep / 2;
  const labelPos = polarToCartesian(CX, CY, (currentRadius + INNER_RADIUS) / 2, midAngle);
  const showLabel = sweep > 15;

  return (
    <g
      onMouseEnter={() => onHover(block.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(block)}
      className="cursor-pointer"
    >
      <path
        d={donutPath}
        fill={block.color}
        opacity={isHovered ? 1 : 0.85}
        stroke="white"
        strokeWidth="2"
        className="transition-opacity duration-200"
      />
      {showLabel && (
        <text
          x={labelPos.x}
          y={labelPos.y}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontSize={sweep > 30 ? '11' : '9'}
          fontWeight="600"
          className="pointer-events-none select-none"
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
        >
          {block.label}
        </text>
      )}
    </g>
  );
}
