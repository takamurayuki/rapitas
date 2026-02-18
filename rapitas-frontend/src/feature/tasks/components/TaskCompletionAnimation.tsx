'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';

const PARTICLE_DURATION = 900;
const RING_SIZE = 56;

// 進捗率に基づくカラーシステム
export function useProgressColors(completed: number, total: number) {
  return useMemo(() => {
    const p = total > 0 ? completed / total : 0;

    // 彩度と明度のランプ
    const saturation = Math.round(15 + p * 80); // 15 → 95
    const lightness = Math.round(72 - p * 18); // 72 → 54
    const opacity = 0.4 + p * 0.6; // 0.4 → 1.0
    const glowStrength = Math.round(p * 20); // 0 → 20
    const glowOpacity = (p * 0.7).toFixed(2); // 0 → 0.7

    // カラー構築
    const primary = `hsl(220, ${saturation}%, ${lightness}%)`;
    const primaryLight = `hsl(220, ${saturation}%, ${Math.min(lightness + 20, 90)}%)`;
    const primaryDark = `hsl(225, ${Math.min(saturation + 10, 100)}%, ${Math.max(lightness - 15, 35)}%)`;
    const glow = `0 0 ${glowStrength}px ${Math.round(glowStrength * 0.6)}px hsla(220, ${saturation}%, ${lightness}%, ${glowOpacity})`;
    const particleCore = `hsl(220, ${Math.min(saturation + 20, 100)}%, ${Math.min(lightness + 15, 92)}%)`;
    const particleOuter = primary;
    const particleGlow = `0 0 ${8 + glowStrength}px ${4 + Math.round(glowStrength * 0.4)}px hsla(220, ${saturation}%, ${lightness}%, ${0.3 + p * 0.35})`;
    const sweepAlpha = (0.08 + p * 0.18).toFixed(2);
    const isComplete = completed === total && total > 0;

    return {
      primary,
      primaryLight,
      primaryDark,
      glow,
      particleCore,
      particleOuter,
      particleGlow,
      sweepAlpha,
      opacity,
      isComplete,
      progress: p,
    };
  }, [completed, total]);
}

// 飛翔する粒子のコンポーネント
interface FlyingParticleProps {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  colors: ReturnType<typeof useProgressColors>;
  onArrive: () => void;
}

export function FlyingParticle({
  startX,
  startY,
  targetX,
  targetY,
  colors,
  onArrive,
}: FlyingParticleProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const midX = (startX + targetX) / 2 + (Math.random() - 0.5) * 120;
    const midY = Math.min(startY, targetY) - 60 - Math.random() * 80;

    el.animate(
      [
        {
          transform: `translate(${startX}px, ${startY}px) scale(1)`,
          opacity: 1,
        },
        {
          transform: `translate(${midX}px, ${midY}px) scale(1.5)`,
          opacity: 1,
          offset: 0.45,
        },
        {
          transform: `translate(${targetX}px, ${targetY}px) scale(0.2)`,
          opacity: 0.6,
        },
      ],
      {
        duration: PARTICLE_DURATION,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      },
    ).onfinish = onArrive;
  }, [startX, startY, targetX, targetY, onArrive]);

  return createPortal(
    <div
      ref={ref}
      className="fixed top-0 left-0 w-3 h-3 pointer-events-none z-[9999]"
    >
      <div
        className="w-full h-full rounded-full animate-task-particle-pulse"
        style={{
          background: `radial-gradient(circle, ${colors.particleCore} 0%, ${colors.particleOuter} 100%)`,
          boxShadow: colors.particleGlow,
        }}
      />
    </div>,
    document.body,
  );
}

// リングバーストエフェクト
interface RingBurstProps {
  color: string;
  onDone: () => void;
}

function RingBurst({ color, onDone }: RingBurstProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(onDone, 700);
    return () => clearTimeout(timer);
  }, [onDone]);

  // ProgressRingの位置を取得して、その位置に波紋を表示
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // ProgressRingの要素を探す
    const progressRing = document.querySelector('[data-progress-ring]');
    if (!progressRing) return;

    const rect = progressRing.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // 波紋の中心を設定
    el.style.left = `${centerX}px`;
    el.style.top = `${centerY}px`;
  }, []);

  return createPortal(
    <div
      ref={ref}
      className="fixed pointer-events-none animate-task-burst-expand"
      style={{
        width: RING_SIZE + 24,
        height: RING_SIZE + 24,
        marginTop: -(RING_SIZE + 24) / 2,
        marginLeft: -(RING_SIZE + 24) / 2,
        border: `2px solid ${color}`,
        borderRadius: '50%',
        zIndex: 9999,
      }}
    />,
    document.body,
  );
}

// 完了時のお祝いエフェクト
function CompleteCelebration() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 rounded-full opacity-0"
          style={{
            top: '50%',
            left: '50%',
            background: `hsl(220, 95%, ${60 + i * 4}%)`,
            animation: `task-celebrate-burst 0.8s ease-out ${i * 0.04}s forwards`,
            transform: `rotate(${i * 45}deg) translateY(-${RING_SIZE / 2 + 8}px)`,
          }}
        />
      ))}
    </>
  );
}

// プログレスリング
interface ProgressRingProps {
  completed: number;
  total: number;
  bursts: number[];
  onBurstDone: (id: number) => void;
  ringRef: React.RefObject<HTMLDivElement>;
  colors: ReturnType<typeof useProgressColors>;
}

export function ProgressRing({
  completed,
  total,
  bursts,
  onBurstDone,
  ringRef,
  colors,
}: ProgressRingProps) {
  const radius = (RING_SIZE - 7) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - colors.progress);
  const [showCelebration, setShowCelebration] = useState(false);
  const prevCompleted = useRef(completed);

  useEffect(() => {
    if (colors.isComplete && prevCompleted.current < total) {
      const showTimer = setTimeout(() => setShowCelebration(true), 0);
      const hideTimer = setTimeout(() => setShowCelebration(false), 1200);
      prevCompleted.current = completed;
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
      };
    }
    prevCompleted.current = completed;
  }, [completed, colors.isComplete, total]);

  return (
    <div
      ref={ringRef}
      data-progress-ring
      className="relative shrink-0"
      style={{
        width: RING_SIZE,
        height: RING_SIZE,
        zIndex: 10,
        overflow: 'visible',
      }}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="transform -rotate-90 transition-all duration-600"
        style={{
          filter: colors.isComplete
            ? `drop-shadow(0 0 12px hsla(220, 95%, 55%, 0.6))`
            : colors.progress > 0.5
              ? `drop-shadow(${colors.glow.replace(/,/g, '')})`
              : 'none',
        }}
      >
        {/* トラック */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          fill="none"
          stroke="rgba(203,213,225,0.2)"
          strokeWidth="4"
        />
        {/* プログレス */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          fill="none"
          stroke={colors.primary}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-800 ease-cubic-bezier"
          style={{
            stroke: colors.primary,
          }}
        />
      </svg>

      {/* 中央のコンテンツ */}
      <div className="absolute inset-0 flex items-center justify-center transition-all duration-500">
        {colors.isComplete ? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            className="animate-task-complete-pop"
          >
            <path
              d="M4 10.5L8 14.5L16 5.5"
              stroke={colors.primary}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-task-check-draw"
            />
          </svg>
        ) : (
          <span
            className="text-sm font-bold"
            style={{
              color: colors.progress > 0 ? colors.primary : '#94a3b8',
            }}
          >
            {completed}
          </span>
        )}
      </div>

      {/* バーストエフェクト */}
      {bursts.map((id) => (
        <RingBurst
          key={id}
          color={colors.primary}
          onDone={() => onBurstDone(id)}
        />
      ))}

      {/* 完了時のお祝い */}
      {showCelebration && <CompleteCelebration />}
    </div>
  );
}

// カードのライトスイープ
interface CardLightSweepProps {
  active: boolean;
  colors: ReturnType<typeof useProgressColors>;
}

export function CardLightSweep({ active, colors }: CardLightSweepProps) {
  if (!active) return null;

  return (
    <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none z-10">
      <div
        className="absolute top-0 -left-full w-1/2 h-full animate-task-light-sweep"
        style={{
          background: `linear-gradient(90deg,
            transparent 0%,
            hsla(220, 80%, 70%, ${colors.sweepAlpha}) 40%,
            hsla(220, 90%, 75%, ${Number(colors.sweepAlpha) + 0.08}) 50%,
            hsla(220, 80%, 70%, ${colors.sweepAlpha}) 60%,
            transparent 100%)`,
        }}
      />
    </div>
  );
}

// タスク完了アニメーション管理のフック
export function useTaskCompletionAnimation(
  totalTasks: number,
  completedTasks: number,
  ringRef: React.RefObject<HTMLDivElement>,
) {
  const [particles, setParticles] = useState<
    Array<{
      id: number;
      startX: number;
      startY: number;
      targetX: number;
      targetY: number;
    }>
  >([]);
  const [bursts, setBursts] = useState<number[]>([]);
  const [sweepingTaskId, setSweepingTaskId] = useState<number | null>(null);
  const idRef = useRef(0);

  const getRingCenter = useCallback(() => {
    if (!ringRef.current) return { x: 60, y: 60 };
    const rect = ringRef.current.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, [ringRef]);

  const triggerTaskCompletion = useCallback(
    (taskId: number, cardX: number, cardY: number) => {
      // 本日のタスクが0件の場合はアニメーションを発生させない
      if (totalTasks === 0) return;

      setSweepingTaskId(taskId);
      setTimeout(() => setSweepingTaskId(null), 650);

      const ring = getRingCenter();
      const count = 3;

      for (let i = 0; i < count; i++) {
        const id = ++idRef.current;
        setTimeout(() => {
          setParticles((prev) => [
            ...prev,
            {
              id,
              startX: cardX + (Math.random() - 0.5) * 40,
              startY: cardY + (Math.random() - 0.5) * 16,
              targetX: ring.x,
              targetY: ring.y,
            },
          ]);
        }, i * 90);
      }
    },
    [getRingCenter, totalTasks],
  );

  const handleParticleArrive = useCallback(() => {
    setParticles((prev) => prev.slice(1));
    // 本日のタスクが0件の場合は波紋を発生させない
    if (totalTasks > 0) {
      const burstId = ++idRef.current;
      setBursts((prev) => [...prev, burstId]);
    }
  }, [totalTasks]);

  const handleBurstDone = useCallback((id: number) => {
    setBursts((prev) => prev.filter((b) => b !== id));
  }, []);

  const colors = useProgressColors(completedTasks, totalTasks);
  const nextColors = useProgressColors(
    Math.min(completedTasks + 1, totalTasks),
    totalTasks,
  );

  return {
    particles,
    bursts,
    sweepingTaskId,
    colors,
    nextColors,
    triggerTaskCompletion,
    handleParticleArrive,
    handleBurstDone,
  };
}
