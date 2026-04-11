/**
 * GanttArrows - タスク依存関係の矢印表示
 *
 * タスク間の依存関係を SVG 矢印でビジュアル化する
 */

import React from 'react';
import type { GanttBarData, GanttDependency } from '@/types/task.types';
import { arrowPath, arrowheadPath } from './gantt-utils';

interface GanttArrowsProps {
  bars: GanttBarData[];
  dependencies: GanttDependency[];
  criticalPath: number[];
  hoveredTaskId?: number | null;
}

export function GanttArrows({
  bars,
  dependencies,
  criticalPath,
  hoveredTaskId,
}: GanttArrowsProps) {
  // タスクIDからバーデータを引く辞書を作成
  const barMap = new Map<number, GanttBarData>();
  bars.forEach((bar) => {
    barMap.set(bar.taskId, bar);
  });

  // 依存関係をバーデータペアに変換
  const arrowData = dependencies
    .map((dep) => {
      const fromBar = barMap.get(dep.from);
      const toBar = barMap.get(dep.to);

      if (!fromBar || !toBar) {
        return null; // バーが見つからない場合はスキップ
      }

      return {
        fromBar,
        toBar,
        dependency: dep,
        isOnCriticalPath:
          criticalPath.includes(dep.from) && criticalPath.includes(dep.to),
        isHighlighted: hoveredTaskId === dep.from || hoveredTaskId === dep.to,
      };
    })
    .filter(Boolean) as Array<{
    fromBar: GanttBarData;
    toBar: GanttBarData;
    dependency: GanttDependency;
    isOnCriticalPath: boolean;
    isHighlighted: boolean;
  }>;

  // 矢印のスタイル設定
  const getArrowStyle = (isOnCriticalPath: boolean, isHighlighted: boolean) => {
    let color = '#6B7280'; // gray-500
    let strokeWidth = 1.5;
    let opacity = 0.7;

    if (isOnCriticalPath) {
      color = '#EF4444'; // red-500
      strokeWidth = 2.5;
      opacity = 0.9;
    } else if (isHighlighted) {
      color = '#3B82F6'; // blue-500
      strokeWidth = 2;
      opacity = 0.9;
    }

    return {
      stroke: color,
      strokeWidth,
      opacity,
      fill: 'none',
      markerEnd: 'url(#arrowhead)',
    };
  };

  return (
    <g className="gantt-arrows">
      {/* 矢印マーカーの定義 */}
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="10"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
        </marker>
        <marker
          id="arrowhead-critical"
          markerWidth="10"
          markerHeight="7"
          refX="10"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="#EF4444" />
        </marker>
        <marker
          id="arrowhead-highlighted"
          markerWidth="10"
          markerHeight="7"
          refX="10"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="#3B82F6" />
        </marker>
      </defs>

      {/* 依存関係の矢印 */}
      {arrowData.map(
        (
          { fromBar, toBar, dependency, isOnCriticalPath, isHighlighted },
          index,
        ) => {
          const style = getArrowStyle(isOnCriticalPath, isHighlighted);
          const markerId = isOnCriticalPath
            ? 'url(#arrowhead-critical)'
            : isHighlighted
              ? 'url(#arrowhead-highlighted)'
              : 'url(#arrowhead)';

          return (
            <g key={`${dependency.from}-${dependency.to}-${index}`}>
              {/* 矢印の線 */}
              <path
                d={arrowPath(fromBar, toBar)}
                {...style}
                markerEnd={markerId}
                className="transition-all duration-200 ease-out"
              />

              {/* 中点にホバーエリア（太い透明線）*/}
              <path
                d={arrowPath(fromBar, toBar)}
                stroke="transparent"
                strokeWidth="8"
                fill="none"
                className="cursor-pointer"
              >
                {/* SVG <title> child renders as a native browser tooltip on hover */}
                <title>{`${fromBar.title} → ${toBar.title}`}</title>
              </path>
            </g>
          );
        },
      )}
    </g>
  );
}
