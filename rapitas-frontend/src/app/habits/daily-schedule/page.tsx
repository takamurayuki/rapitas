'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { DailyScheduleBlock } from '@/types';
import {
  Plus,
  Edit2,
  Trash2,
  Clock,
  ArrowLeft,
  Bell,
  BellOff,
  Moon,
  Briefcase,
  Dumbbell,
  UtensilsCrossed,
  Train,
  BookOpen,
  Gamepad2,
  HelpCircle,
  Save,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import {
  requestNotificationPermission,
  showDesktopNotification,
} from '@/utils/notification';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DailySchedulePage');

const CATEGORY_OPTIONS = [
  {
    value: 'sleep',
    labelKey: 'categorySleep' as const,
    icon: Moon,
    defaultColor: '#6366F1',
  },
  {
    value: 'work',
    labelKey: 'categoryWork' as const,
    icon: Briefcase,
    defaultColor: '#3B82F6',
  },
  {
    value: 'exercise',
    labelKey: 'categoryExercise' as const,
    icon: Dumbbell,
    defaultColor: '#10B981',
  },
  {
    value: 'meal',
    labelKey: 'categoryMeal' as const,
    icon: UtensilsCrossed,
    defaultColor: '#F59E0B',
  },
  {
    value: 'commute',
    labelKey: 'categoryCommute' as const,
    icon: Train,
    defaultColor: '#8B5CF6',
  },
  {
    value: 'study',
    labelKey: 'categoryStudy' as const,
    icon: BookOpen,
    defaultColor: '#EC4899',
  },
  {
    value: 'hobby',
    labelKey: 'categoryHobby' as const,
    icon: Gamepad2,
    defaultColor: '#06B6D4',
  },
  {
    value: 'other',
    labelKey: 'categoryOther' as const,
    icon: HelpCircle,
    defaultColor: '#94A3B8',
  },
];

const PRESET_COLORS = [
  '#6366F1',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#EF4444',
  '#84CC16',
  '#94A3B8',
];

function getCategoryIcon(category: string) {
  const found = CATEGORY_OPTIONS.find((c) => c.value === category);
  return found?.icon || HelpCircle;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToAngle(minutes: number): number {
  return (minutes / 1440) * 360 - 90; // 0:00 at top
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function getDurationParts(
  startTime: string,
  endTime: string,
): { h: number; m: number } {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);

  // Handle case when it crosses to next day
  if (end <= start) {
    end += 1440;
  }

  // Limit block length to within 24 hours
  const diff = Math.min(end - start, 1440);
  return { h: Math.floor(diff / 60), m: diff % 60 };
}

export default function DailySchedulePage() {
  const t = useTranslations('habits');
  const tc = useTranslations('common');

  const formatDuration = (startTime: string, endTime: string): string => {
    const { h, m } = getDurationParts(startTime, endTime);
    if (h === 0) return t('durationMinutes', { m });
    if (m === 0) return t('durationHours', { h });
    return t('durationHoursMinutes', { h, m });
  };

  const [blocks, setBlocks] = useState<DailyScheduleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<DailyScheduleBlock | null>(
    null,
  );
  const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    label: '',
    startTime: '07:00',
    endTime: '08:00',
    color: '#3B82F6',
    category: 'other',
    isNotify: false,
  });

  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/daily-schedule`);
      if (res.ok) {
        setBlocks(await res.json());
      }
    } catch (e) {
      logger.error('Failed to fetch schedule blocks:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  // Notification timer for blocks with isNotify=true
  useEffect(() => {
    if (blocks.length === 0) return;

    requestNotificationPermission();

    const checkNotifications = () => {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      for (const block of blocks) {
        if (!block.isNotify) continue;
        if (block.startTime === currentTime) {
          const cat = CATEGORY_OPTIONS.find((c) => c.value === block.category);
          showDesktopNotification(`Rapitas - ${block.label}`, {
            body: `${block.startTime}〜${block.endTime} ${cat ? t(cat.labelKey) : ''}`,
            tag: `daily-schedule-${block.id}-${currentTime}`,
          });
        }
      }
    };

    // Check every 30 seconds
    const interval = setInterval(checkNotifications, 30_000);
    checkNotifications();

    return () => clearInterval(interval);
  }, [blocks]);

  const openCreateModal = () => {
    setEditingBlock(null);
    setFormData({
      label: '',
      startTime: '07:00',
      endTime: '08:00',
      color: '#3B82F6',
      category: 'other',
      isNotify: false,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (block: DailyScheduleBlock) => {
    setEditingBlock(block);
    setFormData({
      label: block.label,
      startTime: block.startTime,
      endTime: block.endTime,
      color: block.color,
      category: block.category,
      isNotify: block.isNotify,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.label.trim()) return;

    try {
      const url = editingBlock
        ? `${API_BASE_URL}/daily-schedule/${editingBlock.id}`
        : `${API_BASE_URL}/daily-schedule`;
      const method = editingBlock ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: formData.label.trim(),
          startTime: formData.startTime,
          endTime: formData.endTime,
          color: formData.color,
          category: formData.category,
          isNotify: formData.isNotify,
        }),
      });

      if (res.ok) {
        fetchBlocks();
        setIsModalOpen(false);
      }
    } catch (e) {
      logger.error('Failed to save schedule block:', e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('confirmDeleteBlock'))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/daily-schedule/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchBlocks();
      }
    } catch (e) {
      logger.error('Failed to delete schedule block:', e);
    }
  };

  const handleCategoryChange = (category: string) => {
    const cat = CATEGORY_OPTIONS.find((c) => c.value === category);
    setFormData({
      ...formData,
      category,
      color: cat?.defaultColor || formData.color,
    });
  };

  // Pie chart rendering
  const cx = 200;
  const cy = 200;
  const radius = 170;
  const innerRadius = 70;

  const renderPieChart = () => {
    if (blocks.length === 0) return null;

    return blocks.map((block) => {
      const startMin = timeToMinutes(block.startTime);
      let endMin = timeToMinutes(block.endTime);
      if (endMin <= startMin) endMin += 1440;

      const startAngle = minutesToAngle(startMin);
      const endAngle = minutesToAngle(endMin);

      const isHovered = hoveredBlock === block.id;
      const currentRadius = isHovered ? radius + 8 : radius;

      // Donut arc
      const outerStart = polarToCartesian(cx, cy, currentRadius, startAngle);
      const outerEnd = polarToCartesian(cx, cy, currentRadius, endAngle);
      const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
      const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);

      let sweep = endAngle - startAngle;
      if (sweep < 0) sweep += 360;
      const largeArc = sweep > 180 ? 1 : 0;

      const donutPath = [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${currentRadius} ${currentRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
        `Z`,
      ].join(' ');

      // Label position (middle of arc, at middle radius)
      const midAngle = startAngle + sweep / 2;
      const labelR = (currentRadius + innerRadius) / 2;
      const labelPos = polarToCartesian(cx, cy, labelR, midAngle);

      // Only show label if arc is large enough
      const showLabel = sweep > 15;

      return (
        <g
          key={block.id}
          onMouseEnter={() => setHoveredBlock(block.id)}
          onMouseLeave={() => setHoveredBlock(null)}
          onClick={() => openEditModal(block)}
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
    });
  };

  // Hour markers for the clock
  const renderHourMarkers = () => {
    const markers = [];
    for (let h = 0; h < 24; h++) {
      const angle = minutesToAngle(h * 60);
      const outerP = polarToCartesian(cx, cy, radius + 18, angle);
      const tickStart = polarToCartesian(cx, cy, radius + 4, angle);
      const tickEnd = polarToCartesian(cx, cy, radius + 10, angle);
      const isMajor = h % 6 === 0;

      markers.push(
        <g key={`marker-${h}`}>
          <line
            x1={tickStart.x}
            y1={tickStart.y}
            x2={tickEnd.x}
            y2={tickEnd.y}
            stroke="currentColor"
            strokeWidth={isMajor ? '2' : '1'}
            className="text-zinc-400 dark:text-zinc-500"
          />
          {isMajor && (
            <text
              x={outerP.x}
              y={outerP.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="12"
              fontWeight="600"
              fill="currentColor"
              className="text-zinc-600 dark:text-zinc-300"
            >
              {h}:00
            </text>
          )}
        </g>,
      );
    }
    return markers;
  };

  // Current time indicator
  const renderCurrentTimeIndicator = () => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const angle = minutesToAngle(currentMinutes);
    const outerP = polarToCartesian(cx, cy, radius + 12, angle);
    const innerP = polarToCartesian(cx, cy, innerRadius - 5, angle);

    return (
      <g>
        <line
          x1={innerP.x}
          y1={innerP.y}
          x2={outerP.x}
          y2={outerP.y}
          stroke="#EF4444"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx={outerP.x} cy={outerP.y} r="4" fill="#EF4444" />
      </g>
    );
  };

  // Calculate total scheduled time (each block limited to within 24 hours)
  const totalMinutes = blocks.reduce((sum, block) => {
    const start = timeToMinutes(block.startTime);
    let end = timeToMinutes(block.endTime);

    // Handle case when it crosses to next day
    if (end <= start) {
      end += 1440; // Calculate as next day
    }

    // Calculate individual block duration (limit to max 24 hours)
    const blockDuration = Math.min(end - start, 1440);
    return sum + blockDuration;
  }, 0);

  // Limit total time to within 24 hours
  const cappedTotalMinutes = Math.min(totalMinutes, 1440);

  const totalHours = Math.floor(cappedTotalMinutes / 60);
  const totalMins = cappedTotalMinutes % 60;
  const coveragePercent = Math.round((cappedTotalMinutes / 1440) * 100);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/habits"
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </Link>
          <Clock className="w-8 h-8 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {t('dailyScheduleTitle')}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('dailyScheduleSubtitle')}
            </p>
          </div>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>{t('addBlock')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
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
              {/* Background circle */}
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                className="text-zinc-200 dark:text-zinc-700"
              />
              <circle
                cx={cx}
                cy={cy}
                r={innerRadius}
                fill="currentColor"
                className="text-white dark:text-zinc-800"
              />

              {/* Empty area fill */}
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="currentColor"
                className="text-zinc-100 dark:text-zinc-700/50"
              />
              <circle
                cx={cx}
                cy={cy}
                r={innerRadius}
                fill="currentColor"
                className="text-white dark:text-zinc-800"
              />

              {/* Schedule blocks */}
              {renderPieChart()}

              {/* Inner circle overlay */}
              <circle
                cx={cx}
                cy={cy}
                r={innerRadius}
                fill="currentColor"
                className="text-white dark:text-zinc-800"
              />

              {/* Center text */}
              <text
                x={cx}
                y={cy - 8}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="14"
                fontWeight="700"
                fill="currentColor"
                className="text-zinc-800 dark:text-zinc-100"
              >
                24h
              </text>
              <text
                x={cx}
                y={cy + 12}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="10"
                fill="currentColor"
                className="text-zinc-500 dark:text-zinc-400"
              >
                {t('schedule')}
              </text>

              {/* Hour markers */}
              {renderHourMarkers()}

              {/* Current time indicator */}
              {renderCurrentTimeIndicator()}
            </svg>
          </div>

          {/* Hover tooltip */}
          {hoveredBlock && (
            <div className="mt-3 text-center">
              {(() => {
                const block = blocks.find((b) => b.id === hoveredBlock);
                if (!block) return null;
                const Icon = getCategoryIcon(block.category);
                return (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-lg">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: block.color }}
                    />
                    <Icon className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                      {block.label}
                    </span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {block.startTime}〜{block.endTime}（
                      {formatDuration(block.startTime, block.endTime)}）
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Schedule block list */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
              {t('blockList')}
            </h2>

            {blocks.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
                <p className="text-zinc-500 dark:text-zinc-400">
                  {t('noBlocks')}
                </p>
                <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">
                  {t('noBlocksHint')}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {blocks
                  .sort(
                    (a, b) =>
                      timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
                  )
                  .map((block) => {
                    const Icon = getCategoryIcon(block.category);
                    const isHovered = hoveredBlock === block.id;

                    return (
                      <div
                        key={block.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                          isHovered
                            ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
                            : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-750'
                        }`}
                        onMouseEnter={() => setHoveredBlock(block.id)}
                        onMouseLeave={() => setHoveredBlock(null)}
                      >
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: block.color + '20' }}
                        >
                          <Icon
                            className="w-5 h-5"
                            style={{ color: block.color }}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-900 dark:text-zinc-50 truncate">
                              {block.label}
                            </span>
                            {block.isNotify && (
                              <Bell className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            )}
                          </div>
                          <span className="text-sm text-zinc-500 dark:text-zinc-400">
                            {block.startTime}〜{block.endTime}（
                            {formatDuration(block.startTime, block.endTime)}）
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openEditModal(block)}
                            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(block.id)}
                            className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Category legend */}
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
              {t('categorySummary')}
            </h3>
            <div className="space-y-2">
              {CATEGORY_OPTIONS.map((cat) => {
                const catBlocks = blocks.filter(
                  (b) => b.category === cat.value,
                );
                if (catBlocks.length === 0) return null;

                const totalCatMin = catBlocks.reduce((sum, block) => {
                  const s = timeToMinutes(block.startTime);
                  let e = timeToMinutes(block.endTime);

                  // Handle case when it crosses to next day
                  if (e <= s) {
                    e += 1440;
                  }

                  // Calculate individual block duration (limit to max 24 hours)
                  const blockDuration = Math.min(e - s, 1440);
                  return sum + blockDuration;
                }, 0);

                const h = Math.floor(totalCatMin / 60);
                const m = totalCatMin % 60;
                const pct = Math.round((totalCatMin / 1440) * 100);
                const CatIcon = cat.icon;

                return (
                  <div key={cat.value} className="flex items-center gap-3">
                    <CatIcon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300 w-16">
                      {t(cat.labelKey)}
                    </span>
                    <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: cat.defaultColor,
                        }}
                      />
                    </div>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 w-20 text-right">
                      {h}h{m > 0 ? `${m}m` : ''} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
                {editingBlock ? t('editBlock') : t('newBlock')}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('blockLabel')}
                  </label>
                  <input
                    type="text"
                    value={formData.label}
                    onChange={(e) =>
                      setFormData({ ...formData, label: e.target.value })
                    }
                    placeholder={t('blockLabelPlaceholder')}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    {t('blockCategory')}
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {CATEGORY_OPTIONS.map((cat) => {
                      const CatIcon = cat.icon;
                      const isSelected = formData.category === cat.value;
                      return (
                        <button
                          key={cat.value}
                          type="button"
                          onClick={() => handleCategoryChange(cat.value)}
                          className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-xs ${
                            isSelected
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                              : 'border-zinc-200 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                          }`}
                        >
                          <CatIcon className="w-5 h-5" />
                          {t(cat.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {t('startTime')}
                    </label>
                    <input
                      type="time"
                      value={formData.startTime}
                      onChange={(e) =>
                        setFormData({ ...formData, startTime: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {t('endTime')}
                    </label>
                    <input
                      type="time"
                      value={formData.endTime}
                      onChange={(e) =>
                        setFormData({ ...formData, endTime: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    {tc('color')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          formData.color === color
                            ? 'border-zinc-900 dark:border-white scale-110'
                            : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                  <button
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, isNotify: !formData.isNotify })
                    }
                    className={`p-2 rounded-lg transition-colors ${
                      formData.isNotify
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'
                        : 'bg-zinc-200 dark:bg-zinc-600 text-zinc-400'
                    }`}
                  >
                    {formData.isNotify ? (
                      <Bell className="w-5 h-5" />
                    ) : (
                      <BellOff className="w-5 h-5" />
                    )}
                  </button>
                  <div>
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      {t('pcNotification')}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formData.isNotify
                        ? t('notifyOnDescription')
                        : t('notifyOffDescription')}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                  >
                    {tc('cancel')}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {editingBlock ? tc('update') : tc('create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
