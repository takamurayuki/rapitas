/**
 * TaskChange.test (#1119 stage 6)
 *
 * The card is the confirmation: nothing is applied until its button is pressed,
 * and once applied the same place offers the undo — or says plainly why the
 * undo cannot run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ja from '../../../../../../messages/ja.json';
import { TaskChange } from '../TaskChange';

const hook = {
  proposal: null as null | {
    taskId: number;
    title: string;
    changes: Record<string, unknown>;
    reason: string;
  },
  unclear: [] as string[],
  proposing: false,
  applying: false,
  applied: null as null | { actionId: number; before: Record<string, unknown> },
  undone: false,
  conflicts: [] as string[],
  error: false,
  propose: vi.fn(async () => {}),
  apply: vi.fn(async () => {}),
  undo: vi.fn(async () => {}),
  reset: vi.fn(),
};
vi.mock('../use-task-change', () => ({ useTaskChange: () => hook }));

const renderCard = (handedOver?: string) =>
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <TaskChange handedOver={handedOver} />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  Object.assign(hook, {
    proposal: null,
    unclear: [],
    applied: null,
    undone: false,
    conflicts: [],
    error: false,
  });
  hook.propose.mockClear();
  hook.apply.mockClear();
  hook.undo.mockClear();
});

describe('TaskChange', () => {
  it('a handed-over sentence is proposed, never applied', async () => {
    renderCard('ログインのバグを完了にして');
    await waitFor(() => expect(hook.propose).toHaveBeenCalledWith('ログインのバグを完了にして'));
    expect(hook.apply).not.toHaveBeenCalled();
  });

  it('shows the task and each change in words, and applies only on the button', () => {
    hook.proposal = {
      taskId: 11,
      title: 'Fix the login bug',
      changes: { status: 'done', priority: 'urgent' },
      reason: '直したと言っているので',
    };
    renderCard();
    expect(screen.getByText('Fix the login bug')).toBeTruthy();
    expect(screen.getByText(/状態/)).toBeTruthy();
    expect(screen.getByText(/完了/)).toBeTruthy();
    expect(screen.getByText(/緊急/)).toBeTruthy();
    expect(hook.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'この内容で変更する' }));
    expect(hook.apply).toHaveBeenCalledTimes(1);
  });

  it('after applying, offers the undo', () => {
    hook.proposal = { taskId: 11, title: 'T', changes: { status: 'done' }, reason: '' };
    hook.applied = { actionId: 5, before: { status: 'todo' } };
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(hook.undo).toHaveBeenCalledTimes(1);
  });

  it('says which field blocked the undo', () => {
    hook.proposal = { taskId: 11, title: 'T', changes: { status: 'done' }, reason: '' };
    hook.applied = { actionId: 5, before: { status: 'todo' } };
    hook.conflicts = ['status'];
    renderCard();
    expect(screen.getByText(/元に戻せません: 状態/)).toBeTruthy();
  });

  it('lists what could not be read instead of guessing', () => {
    hook.unclear = ['どのタスクか分かりません'];
    renderCard();
    expect(screen.getByText('どのタスクか分かりません')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'この内容で変更する' })).toBeNull();
  });
});
