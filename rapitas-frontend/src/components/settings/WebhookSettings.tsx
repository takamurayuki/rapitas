'use client';

/**
 * WebhookSettings
 *
 * Slack/Discord webhook URL configuration for external notifications.
 * Follows the same UI pattern as the Local LLM settings section.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Bell, CheckCircle, AlertCircle, Loader2, Send } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

export function WebhookSettings() {
  const [slackUrl, setSlackUrl] = useState('');
  const [discordUrl, setDiscordUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    type: string;
    success: boolean;
    message: string;
  } | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings`);
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (data.slackWebhookUrl) setSlackUrl(data.slackWebhookUrl);
        if (data.discordWebhookUrl) setDiscordUrl(data.discordWebhookUrl);
      }
    } catch {
      // Settings not loaded yet — fields stay empty
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveWebhookUrls = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slackWebhookUrl: slackUrl || null,
          discordWebhookUrl: discordUrl || null,
        }),
      });
      if (res.ok) {
        setTestResult({ type: 'save', success: true, message: '保存しました' });
      } else {
        setTestResult({
          type: 'save',
          success: false,
          message: '保存に失敗しました',
        });
      }
    } catch {
      setTestResult({
        type: 'save',
        success: false,
        message: '保存に失敗しました',
      });
    } finally {
      setSaving(false);
    }
  };

  const testWebhook = async (type: 'slack' | 'discord') => {
    const url = type === 'slack' ? slackUrl : discordUrl;
    if (!url) return;

    setTestResult(null);
    try {
      const payload =
        type === 'slack'
          ? { text: '🔔 Rapitas Webhook テスト通知' }
          : { content: '🔔 Rapitas Webhook テスト通知' };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setTestResult({
        type,
        success: res.ok,
        message: res.ok
          ? 'テスト通知を送信しました'
          : `エラー: HTTP ${res.status}`,
      });
    } catch {
      setTestResult({
        type,
        success: false,
        message: '接続に失敗しました。URLを確認してください。',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Bell className="w-4 h-4 text-violet-500" />
        <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Webhook通知
        </h4>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        タスク完了・PR作成・エラー発生時にSlack/Discordへ自動通知します
      </p>

      {/* Slack */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
          Slack Webhook URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={slackUrl}
            onChange={(e) => setSlackUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />
          <button
            onClick={() => testWebhook('slack')}
            disabled={!slackUrl}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Discord */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
          Discord Webhook URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={discordUrl}
            onChange={(e) => setDiscordUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />
          <button
            onClick={() => testWebhook('discord')}
            disabled={!discordUrl}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={saveWebhookUrls}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        保存
      </button>

      {/* Result feedback */}
      {testResult && (
        <div
          className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
            testResult.success
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          }`}
        >
          {testResult.success ? (
            <CheckCircle className="w-3.5 h-3.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
          {testResult.message}
        </div>
      )}
    </div>
  );
}
