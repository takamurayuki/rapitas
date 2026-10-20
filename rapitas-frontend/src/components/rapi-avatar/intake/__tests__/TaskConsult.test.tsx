/**
 * TaskConsult.test
 *
 * The task assistant after it moved off the task detail page and into ラピ.
 *
 * The property that matters is that it is the SAME assistant, about the task
 * you are looking at: she is mounted in the app shell with no props from the
 * page, so the subject comes from the address bar, and getting that wrong
 * means a conversation about the wrong task — or a silent one about nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

let pathname = '/tasks/42?showHeader=true';
let fetched: string[] = [];
let task: Record<string, unknown> | null = {
  id: 42,
  title: '影をもう少し離す',
  status: 'in-progress',
  description: 'd',
  subtasks: [{ status: 'done' }, { status: 'todo' }],
  complexityScore: 3,
  estimatedHours: 2,
  theme: { isDevelopment: true, workingDirectory: 'C:/x' },
};
let shouldFail = false;

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/lib/api-client', () => ({
  apiFetch: async (path: string) => {
    fetched.push(path);
    if (shouldFail) throw new Error('nope');
    return task;
  },
}));

/** The real chat, stubbed down to what it was handed. */
vi.mock('@/components/copilot', () => ({
  CopilotChatPanel: (props: Record<string, unknown>) => (
    <div
      data-testid="copilot"
      data-task-id={String(props.taskId)}
      data-embedded={String(props.embedded)}
      data-context={JSON.stringify(props.nextActionContext)}
    />
  ),
}));

import { TaskConsult, taskIdFromPath } from '../TaskConsult';

beforeEach(() => {
  pathname = '/tasks/42?showHeader=true';
  fetched = [];
  shouldFail = false;
  task = {
    id: 42,
    title: '影をもう少し離す',
    status: 'in-progress',
    description: 'd',
    subtasks: [{ status: 'done' }, { status: 'todo' }],
    complexityScore: 3,
    estimatedHours: 2,
    theme: { isDevelopment: true, workingDirectory: 'C:/x' },
  };
});

describe('finding the subject', () => {
  it.each([
    ['/tasks/42', 42],
    ['/tasks/7?showHeader=true', 7],
    ['/tasks/1234/anything', 1234],
    ['/', null],
    ['/concerns', null],
    ['/tasks', null],
    [null, null],
  ])('reads %s as %s', (path, expected) => {
    expect(taskIdFromPath(path)).toBe(expected);
  });
});

describe('talking about the open task', () => {
  it('hands the chat the task from the address bar', async () => {
    render(<TaskConsult />);
    const chat = await screen.findByTestId('copilot');
    expect(chat.getAttribute('data-task-id')).toBe('42');
    expect(fetched).toEqual(['/tasks/42']);
  });

  // Without this the chat draws its own card chrome inside the bubble: a
  // bordered box in a bordered box.
  it('embeds the chat rather than letting it draw a card', async () => {
    render(<TaskConsult />);
    const chat = await screen.findByTestId('copilot');
    expect(chat.getAttribute('data-embedded')).toBe('true');
  });

  // The page used to build this and pass it down. It is rebuilt here from the
  // task alone, which is the reason this could move at all.
  it('rebuilds the next-action context the page used to supply', async () => {
    render(<TaskConsult />);
    const chat = await screen.findByTestId('copilot');
    expect(JSON.parse(chat.getAttribute('data-context')!)).toEqual({
      status: 'in-progress',
      subtaskTotal: 2,
      subtaskDone: 1,
      complexityScore: 3,
      estimatedHours: 2,
      canRunAgent: true,
    });
  });

  it('says which task it is talking about', async () => {
    render(<TaskConsult />);
    await waitFor(() =>
      expect(screen.getByText('rapiAvatar.consult.about:影をもう少し離す')).toBeTruthy(),
    );
  });

  // She is on every page, and most of them are not a task.
  it('says there is nothing to discuss off a task page', () => {
    pathname = '/dashboard';
    render(<TaskConsult />);
    expect(screen.getByText('rapiAvatar.consult.noTask')).toBeTruthy();
    expect(screen.queryByTestId('copilot')).toBeNull();
    expect(fetched).toEqual([]);
  });

  // An empty chat with no subject would look like the feature is broken.
  it('says so when the task will not load', async () => {
    shouldFail = true;
    render(<TaskConsult />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.consult.loadFailed')).toBeTruthy());
    expect(screen.queryByTestId('copilot')).toBeNull();
  });

  it('reports canRunAgent as false without a working directory', async () => {
    task = { ...task, theme: { isDevelopment: true, workingDirectory: null } };
    render(<TaskConsult />);
    const chat = await screen.findByTestId('copilot');
    expect(JSON.parse(chat.getAttribute('data-context')!).canRunAgent).toBe(false);
  });
});
