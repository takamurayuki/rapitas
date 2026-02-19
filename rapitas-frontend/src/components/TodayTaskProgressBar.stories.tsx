import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import TodayTaskProgressBar from './TodayTaskProgressBar';

const meta = {
  title: 'Components/TodayTaskProgressBar',
  component: TodayTaskProgressBar,
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#000000' },
        { name: 'light', value: '#ffffff' },
      ],
    },
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-black p-8">
        {/* Grid Overlay */}
        <div className="pointer-events-none fixed inset-0 bg-[url('https://www.transparenttextures.com/patterns/grid-me.png')] opacity-[0.03]" />
        <div className="relative z-10 mx-auto max-w-4xl">
          <div className="mb-8 border-l-4 border-amber-600 py-2 pl-6">
            <h1 className="font-mono text-2xl font-black tracking-tighter text-slate-100">
              PROGRESS_BAR_STORIES{' '}
              <span className="text-amber-500">// STORYBOOK</span>
            </h1>
          </div>
          <div className="space-y-8">
            <Story />
          </div>
        </div>
      </div>
    ),
  ],
  argTypes: {
    completedCount: {
      control: { type: 'number', min: 0, max: 20 },
      description: 'Number of completed tasks',
    },
    totalCount: {
      control: { type: 'number', min: 0, max: 20 },
      description: 'Total number of tasks',
    },
  },
} satisfies Meta<typeof TodayTaskProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    completedCount: 2,
    totalCount: 5,
  },
};

export const AllCompleted: Story = {
  args: {
    completedCount: 5,
    totalCount: 5,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Shows the FABULOUS animation when all tasks are completed (100%)',
      },
    },
  },
};

export const AllTodo: Story = {
  args: {
    completedCount: 0,
    totalCount: 5,
  },
};

export const InProgress: Story = {
  args: {
    completedCount: 3,
    totalCount: 8,
  },
};

export const NoTasksToday: Story = {
  args: {
    completedCount: 0,
    totalCount: 0,
  },
};

export const SingleTask: Story = {
  args: {
    completedCount: 1,
    totalCount: 1,
  },
};

export const ManyTasks: Story = {
  args: {
    completedCount: 12,
    totalCount: 20,
  },
};

export const HighEfficiency: Story = {
  args: {
    completedCount: 18,
    totalCount: 20,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows high productivity state (90% complete)',
      },
    },
  },
};

// インタラクティブストーリー（タスクを完了させてアニメーションを確認）
export const Interactive: any = {
  render: () => {
    const [completedCount, setCompletedCount] = useState(2);
    const totalCount = 10;

    const incrementCompleted = () => {
      if (completedCount < totalCount) {
        setCompletedCount(completedCount + 1);
      }
    };

    const decrementCompleted = () => {
      if (completedCount > 0) {
        setCompletedCount(completedCount - 1);
      }
    };

    const resetProgress = () => {
      setCompletedCount(0);
    };

    const completeAll = () => {
      setCompletedCount(totalCount);
    };

    return (
      <div className="space-y-6">
        <div className="mb-4 font-mono text-sm uppercase tracking-widest text-slate-500">
          [INTERACTIVE] PROGRESS CONTROL PANEL
        </div>

        <TodayTaskProgressBar
          completedCount={completedCount}
          totalCount={totalCount}
        />

        <div className="mt-8 space-y-4">
          <p className="mb-4 font-mono text-xs text-slate-600">
            INSTRUCTIONS: Use control buttons to simulate task completion and
            observe particle effects
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={incrementCompleted}
              className="bg-amber-500 px-4 py-2 font-mono text-xs font-bold uppercase text-black transition-all hover:bg-amber-400 active:scale-95"
            >
              COMPLETE TASK [+1]
            </button>
            <button
              onClick={decrementCompleted}
              className="bg-slate-800 px-4 py-2 font-mono text-xs font-bold uppercase text-slate-400 transition-all hover:bg-slate-700 active:scale-95"
            >
              UNDO TASK [-1]
            </button>
            <button
              onClick={resetProgress}
              className="bg-rose-900 px-4 py-2 font-mono text-xs font-bold uppercase text-rose-200 transition-all hover:bg-rose-800 active:scale-95"
            >
              RESET ALL [0]
            </button>
            <button
              onClick={completeAll}
              className="bg-green-900 px-4 py-2 font-mono text-xs font-bold uppercase text-green-200 transition-all hover:bg-green-800 active:scale-95"
            >
              COMPLETE ALL [100%]
            </button>
          </div>

          <div className="mt-4 flex items-center gap-4 font-mono text-xs text-slate-600">
            <span>
              CURRENT_PROGRESS: {completedCount}/{totalCount}
            </span>
            <span>
              EFFICIENCY: {Math.floor((completedCount / totalCount) * 100)}%
            </span>
          </div>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo with controls to test animations and effects',
      },
    },
  },
};
