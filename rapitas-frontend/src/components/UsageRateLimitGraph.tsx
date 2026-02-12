"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle, TrendingUp } from "lucide-react";
import { API_BASE_URL } from "@/utils/api";

type RateLimitInfo = {
  provider: string;
  plan: string;
  used: number;
  limit: number;
  period: string;
  resetAt?: string;
};

type RateLimitData = {
  rateLimits: RateLimitInfo[];
};

const PROVIDER_COLORS = {
  claude: {
    bg: "bg-orange-500",
    bgLight: "bg-orange-100 dark:bg-orange-900/30",
    text: "text-orange-600 dark:text-orange-400",
  },
  chatgpt: {
    bg: "bg-green-500",
    bgLight: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-600 dark:text-green-400",
  },
  gemini: {
    bg: "bg-blue-500",
    bgLight: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-600 dark:text-blue-400",
  },
};

const PROVIDER_LABELS = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
};

export function UsageRateLimitGraph() {
  const [rateLimits, setRateLimits] = useState<RateLimitInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRateLimits();
  }, []);

  const fetchRateLimits = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/rate-limits`);
      if (res.ok) {
        const data: RateLimitData = await res.json();
        setRateLimits(data.rateLimits);
      } else {
        setError("使用制限情報の取得に失敗しました");
      }
    } catch (err) {
      setError("使用制限情報の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const formatResetTime = (resetAt: string | undefined): string => {
    if (!resetAt) return "不明";
    const resetDate = new Date(resetAt);
    const now = new Date();
    const diff = resetDate.getTime() - now.getTime();

    if (diff < 0) return "リセット済み";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}日後`;
    } else {
      return `${hours}時間後`;
    }
  };

  const getUsagePercentage = (used: number, limit: number): number => {
    if (limit === 0) return 0;
    return Math.min((used / limit) * 100, 100);
  };

  const getUsageColor = (percentage: number): string => {
    if (percentage >= 90) return "text-red-600 dark:text-red-400";
    if (percentage >= 75) return "text-amber-600 dark:text-amber-400";
    return "text-zinc-600 dark:text-zinc-400";
  };

  if (rateLimits.length === 0 && !isLoading) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-zinc-400" />
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
              使用制限
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              各プロバイダーの現在のプランと使用状況
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-6">
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded mb-2 w-1/3"></div>
                <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="p-6">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {rateLimits.map((limit) => {
            const percentage = getUsagePercentage(limit.used, limit.limit);
            const colors = PROVIDER_COLORS[limit.provider as keyof typeof PROVIDER_COLORS] || PROVIDER_COLORS.claude;
            const usageColor = getUsageColor(percentage);

            return (
              <div key={limit.provider}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                      {PROVIDER_LABELS[limit.provider as keyof typeof PROVIDER_LABELS] || limit.provider}
                    </h3>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors.bgLight} ${colors.text}`}>
                      {limit.plan}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    {limit.period} • リセット: {formatResetTime(limit.resetAt)}
                  </div>
                </div>

                <div className="relative">
                  <div className="h-8 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-hidden">
                    <div
                      className={`h-full ${colors.bg} transition-all duration-300 ease-out`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <div className="absolute inset-0 flex items-center justify-between px-3">
                    <span className={`text-sm font-medium ${percentage > 50 ? 'text-white' : usageColor}`}>
                      {formatNumber(limit.used)} / {formatNumber(limit.limit)}
                    </span>
                    <span className={`text-sm font-medium ${usageColor}`}>
                      {percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {percentage >= 75 && (
                  <div className={`flex items-center gap-1.5 mt-2 text-xs ${percentage >= 90 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>
                      {percentage >= 90
                        ? "使用制限に近づいています"
                        : "使用量が増加しています"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}