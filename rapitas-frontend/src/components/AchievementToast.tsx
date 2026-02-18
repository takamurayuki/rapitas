"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Trophy,
  X,
  Star,
  Zap,
  Award,
  Crown,
  Flame,
  Clock,
  Sun,
  Moon,
  Brain,
  BookOpen,
} from "lucide-react";
import { API_BASE_URL } from "@/utils/api";

type Achievement = {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  rarity: string;
  isUnlocked: boolean;
  unlockedAt: string | null;
};

type AchievementToastProps = {
  achievement: Achievement;
  onClose: () => void;
};

const iconMap: Record<string, typeof Star> = {
  Star,
  Zap,
  Award,
  Crown,
  Flame,
  Clock,
  Sun,
  Moon,
  Brain,
  BookOpen,
  Trophy,
};

const rarityStyles: Record<
  string,
  { bg: string; border: string; glow: string }
> = {
  common: {
    bg: "bg-zinc-100 dark:bg-zinc-800",
    border: "border-zinc-300 dark:border-zinc-600",
    glow: "",
  },
  rare: {
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-400 dark:border-blue-600",
    glow: "shadow-blue-500/20",
  },
  epic: {
    bg: "bg-violet-50 dark:bg-violet-950",
    border: "border-violet-400 dark:border-violet-600",
    glow: "shadow-violet-500/30",
  },
  legendary: {
    bg: "bg-amber-50 dark:bg-amber-950",
    border: "border-amber-400 dark:border-amber-600",
    glow: "shadow-amber-500/40 animate-pulse",
  },
};

function AchievementToast({ achievement, onClose }: AchievementToastProps) {
  const Icon = iconMap[achievement.icon] || Trophy;
  const rarity = rarityStyles[achievement.rarity] || rarityStyles.common;

  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-xl border-2 shadow-xl ${rarity.bg} ${rarity.border} ${rarity.glow} animate-in slide-in-from-right duration-300`}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: `${achievement.color}20` }}
      >
        <Icon className="w-6 h-6" style={{ color: achievement.color }} />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
            {achievement.name}
          </span>
          <span
            className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${
              achievement.rarity === "legendary"
                ? "bg-amber-500 text-white"
                : achievement.rarity === "epic"
                  ? "bg-violet-500 text-white"
                  : achievement.rarity === "rare"
                    ? "bg-blue-500 text-white"
                    : "bg-zinc-500 text-white"
            }`}
          >
            {achievement.rarity}
          </span>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {achievement.description}
        </p>
      </div>
      <button
        onClick={onClose}
        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function AchievementNotifications() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // クライアントサイドで初回マウントを確認
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  // ポーリングで新しい実績を確認
  useEffect(() => {

    let lastCheckedIds: number[] = [];

    const checkAchievements = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/achievements`);
        if (!res.ok) return;
        const data: Achievement[] = await res.json();

        const newlyUnlocked = data.filter(
          (a) =>
            a.isUnlocked &&
            a.unlockedAt &&
            new Date(a.unlockedAt).getTime() > Date.now() - 60000 &&
            !lastCheckedIds.includes(a.id),
        );

        if (newlyUnlocked.length > 0) {
          setAchievements((prev) => [...prev, ...newlyUnlocked]);
          lastCheckedIds = [
            ...lastCheckedIds,
            ...newlyUnlocked.map((a) => a.id),
          ];
        }
      } catch (e) {
        // Silent fail
      }
    };

    // 初回チェック
    checkAchievements();

    // 30秒ごとにチェック
    const interval = setInterval(checkAchievements, 30000);

    return () => clearInterval(interval);
  }, [mounted]);

  const removeAchievement = (id: number) => {
    setAchievements((prev) => prev.filter((a) => a.id !== id));
  };

  if (!mounted || achievements.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-4 right-4 z-9999 space-y-3 max-w-sm">
      {achievements.map((achievement) => (
        <AchievementToast
          key={achievement.id}
          achievement={achievement}
          onClose={() => removeAchievement(achievement.id)}
        />
      ))}
    </div>,
    document.body,
  );
}
