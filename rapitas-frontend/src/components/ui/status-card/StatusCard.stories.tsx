/**
 * StatusCard Storybook Stories
 *
 * このファイルはStorybookがセットアップされた際に使用できます。
 * Storybookをインストールするには: npx storybook@latest init
 */

import type { Meta, StoryObj } from '@storybook/react';
import { StatusCard } from './StatusCard';
import { Bot, Zap, Sparkles, Clock } from 'lucide-react';

const meta: Meta<typeof StatusCard> = {
  title: 'UI/StatusCard',
  component: StatusCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'AIエージェントのステータスを表示するコンパクトなカードコンポーネント。4つのステータス状態（実行中、入力待ち、エラー、完了）に対応し、適切な色、アイコン、アニメーションを提供します。',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: ['processing', 'waiting_for_input', 'error', 'completed'],
      description: 'ステータス種別',
    },
    message: {
      control: 'text',
      description: '表示メッセージ',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'カードサイズ',
    },
    animated: {
      control: 'boolean',
      description: 'アニメーション有効化',
    },
    className: {
      control: 'text',
      description: '追加のCSSクラス',
    },
  },
};

export default meta;
type Story = StoryObj<typeof StatusCard>;

/**
 * デフォルト（実行中）
 */
export const Default: Story = {
  args: {
    status: 'processing',
  },
};

/**
 * 実行中状態
 */
export const Processing: Story = {
  args: {
    status: 'processing',
    message: 'ファイルを分析しています...',
  },
};

/**
 * 入力待ち状態
 */
export const WaitingForInput: Story = {
  args: {
    status: 'waiting_for_input',
    message: '続行するには承認が必要です',
  },
};

/**
 * エラー状態
 */
export const Error: Story = {
  args: {
    status: 'error',
    message: 'API接続に失敗しました',
  },
};

/**
 * 完了状態
 */
export const Completed: Story = {
  args: {
    status: 'completed',
    message: 'タスクが正常に完了しました',
  },
};

/**
 * サイズ: Small
 */
export const SizeSmall: Story = {
  args: {
    status: 'processing',
    size: 'sm',
    message: '処理中...',
  },
};

/**
 * サイズ: Medium（デフォルト）
 */
export const SizeMedium: Story = {
  args: {
    status: 'processing',
    size: 'md',
    message: '処理中...',
  },
};

/**
 * サイズ: Large
 */
export const SizeLarge: Story = {
  args: {
    status: 'processing',
    size: 'lg',
    message: '処理中...',
  },
};

/**
 * カスタムアイコン: Bot
 */
export const CustomIconBot: Story = {
  args: {
    status: 'processing',
    message: 'AIエージェント実行中',
    icon: <Bot className="w-full h-full animate-bounce" />,
  },
};

/**
 * カスタムアイコン: Zap
 */
export const CustomIconZap: Story = {
  args: {
    status: 'completed',
    message: '高速処理完了',
    icon: <Zap className="w-full h-full" />,
  },
};

/**
 * カスタムアイコン: Sparkles
 */
export const CustomIconSparkles: Story = {
  args: {
    status: 'waiting_for_input',
    message: '魔法をかけています',
    icon: <Sparkles className="w-full h-full" />,
  },
};

/**
 * カスタムアイコン: Clock
 */
export const CustomIconClock: Story = {
  args: {
    status: 'processing',
    message: 'スケジュール処理中',
    icon: <Clock className="w-full h-full" />,
  },
};

/**
 * アニメーション無効
 */
export const NoAnimation: Story = {
  args: {
    status: 'processing',
    message: 'アニメーションなし',
    animated: false,
  },
};

/**
 * カスタムクラス適用
 */
export const WithCustomClass: Story = {
  args: {
    status: 'completed',
    message: 'カスタムスタイル適用',
    className: 'shadow-lg',
  },
};

/**
 * アクセシビリティ: カスタムaria-label
 */
export const WithAriaLabel: Story = {
  args: {
    status: 'processing',
    message: 'ファイルアップロード中',
    ariaLabel: 'AIエージェントがファイルをアップロードしています。しばらくお待ちください。',
  },
};

/**
 * 全ステータスの比較表示
 */
export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <StatusCard status="processing" message="実行中のタスク" />
      <StatusCard status="waiting_for_input" message="ユーザー入力待ち" />
      <StatusCard status="error" message="エラーが発生しました" />
      <StatusCard status="completed" message="タスク完了" />
    </div>
  ),
};

/**
 * 全サイズの比較表示
 */
export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div>
        <span className="text-xs text-gray-500 mb-1 block">Small</span>
        <StatusCard status="processing" size="sm" message="処理中" />
      </div>
      <div>
        <span className="text-xs text-gray-500 mb-1 block">Medium</span>
        <StatusCard status="processing" size="md" message="処理中" />
      </div>
      <div>
        <span className="text-xs text-gray-500 mb-1 block">Large</span>
        <StatusCard status="processing" size="lg" message="処理中" />
      </div>
    </div>
  ),
};

/**
 * ダークモード対応確認
 */
export const DarkMode: Story = {
  parameters: {
    backgrounds: { default: 'dark' },
  },
  render: () => (
    <div className="dark p-6 bg-zinc-900 rounded-lg">
      <div className="flex flex-col gap-4">
        <StatusCard status="processing" message="ダークモード: 実行中" />
        <StatusCard status="waiting_for_input" message="ダークモード: 入力待ち" />
        <StatusCard status="error" message="ダークモード: エラー" />
        <StatusCard status="completed" message="ダークモード: 完了" />
      </div>
    </div>
  ),
};

/**
 * レスポンシブ対応確認
 */
export const Responsive: Story = {
  render: () => (
    <div className="w-full max-w-xs">
      <StatusCard
        status="processing"
        message="これは非常に長いメッセージで、テキストが途中で切り捨てられることを確認するためのテストです"
      />
    </div>
  ),
};
