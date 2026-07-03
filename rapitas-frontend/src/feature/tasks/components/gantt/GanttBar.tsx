/**
 * GanttBar - 個別タスクのガントバー
 *
 * 1つのタスクを表すバーと、その上のラベル・ツールチップを描画する
 */

import React from 'react';
import type { GanttBarData } from './gantt-utils';

interface GanttBarProps {
  bar: GanttBarData;
  isOnCriticalPath?: boolean;
  onClick?: (taskId: number) => void;
  onHover?: (taskId: number | null) => void;
}

export function GanttBar({ bar, isOnCriticalPath = false, onClick, onHover }: GanttBarProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(bar.taskId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onClick?.(bar.taskId);
    }
  };

  const handleMouseEnter = () => {
    onHover?.(bar.taskId);
  };

  const handleMouseLeave = () => {
    onHover?.(null);
  };

  // ステータスに基づくスタイル調整
  const getBarStyle = () => {
    let baseClass = 'transition-all duration-200 ease-out cursor-pointer hover:opacity-80';

    if (isOnCriticalPath) {
      baseClass += ' ring-2 ring-red-400 ring-opacity-60';
    }

    if (bar.status === 'done') {
      baseClass += ' opacity-80';
    }

    return baseClass;
  };

  return (
    <g>
      {/* バー本体 — タイトルは左列に表示するためバー内は省略 */}
      <rect
        x={bar.x}
        y={bar.y}
        width={bar.width}
        height={bar.height}
        fill={bar.color}
        className={getBarStyle()}
        rx={4}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onKeyDown={onClick ? handleKeyDown : undefined}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      />

      {/* ステータスインジケーター */}
      {bar.status === 'in-progress' && (
        <circle
          cx={bar.x + bar.width - 8}
          cy={bar.y + 8}
          r={4}
          fill="white"
          className="animate-pulse"
        />
      )}

      {bar.status === 'blocked' && (
        <g>
          <circle cx={bar.x + bar.width - 8} cy={bar.y + 8} r={6} fill="rgba(0,0,0,0.2)" />
          <text
            x={bar.x + bar.width - 8}
            y={bar.y + 8 + 3}
            fill="white"
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
            className="pointer-events-none select-none"
          >
            !
          </text>
        </g>
      )}

      {/* クリティカルパスインジケーター */}
      {isOnCriticalPath && (
        <g>
          <circle cx={bar.x + 8} cy={bar.y - 6} r={4} fill="#EF4444" />
          <text
            x={bar.x + 8}
            y={bar.y - 6 + 3}
            fill="white"
            fontSize="8"
            fontWeight="bold"
            textAnchor="middle"
            className="pointer-events-none select-none"
          >
            !
          </text>
        </g>
      )}
    </g>
  );
}
