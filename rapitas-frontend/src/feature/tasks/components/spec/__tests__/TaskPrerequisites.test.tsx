/**
 * TaskPrerequisites.test
 *
 * The tasks a task waits for (#1559), as the detail shows and edits them:
 * each with whether it is done, saved by task number, and a refusal from the
 * server (a cycle, an unknown task) shown as the server words it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const showToast = vi.fn();
vi.mock('@/components/ui/toast/ToastContainer', () => ({ useToast: () => ({ showToast }) }));

import { TaskPrerequisites, parseTaskNumbers } from '../TaskPrerequisites';

const puts: unknown[] = [];
let putStatus = 200;

beforeEach(() => {
  puts.length = 0;
  putStatus = 200;
  showToast.mockReset();
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify(
          putStatus === 200
            ? { prerequisites: [{ id: 13, title: '画面', status: 'todo' }] }
            : { error: 'お互いを待つことになり、どれも始められません' },
        ),
        { status: putStatus },
      );
    }
    return new Response(
      JSON.stringify({ prerequisites: [{ id: 12, title: 'API', status: 'done' }] }),
      { status: 200 },
    );
  });
});

describe('reading task numbers', () => {
  it('takes numbers with or without #, separated any way, once each', () => {
    expect(parseTaskNumbers('12, #13 14、12 x')).toEqual([12, 13, 14]);
  });
});

describe('the prerequisites in the detail', () => {
  it('lists each one with whether it is done', async () => {
    await act(async () => {
      render(<TaskPrerequisites taskId={20} />);
    });
    const row = document.querySelector('[data-prerequisite="12"]') as HTMLElement;
    expect(row.textContent).toContain('API');
    expect(row.textContent).toContain('prerequisiteDone');
  });

  it('saves the numbers typed', async () => {
    await act(async () => {
      render(<TaskPrerequisites taskId={20} />);
    });
    fireEvent.change(screen.getByLabelText('prerequisitesInput'), { target: { value: '#13' } });
    await act(async () => {
      fireEvent.click(screen.getByText('prerequisitesSave'));
    });
    expect(puts).toEqual([{ dependsOn: [13] }]);
    expect(document.querySelector('[data-prerequisite="13"]')).toBeTruthy();
  });

  it('shows the server’s reason when it refuses', async () => {
    putStatus = 400;
    await act(async () => {
      render(<TaskPrerequisites taskId={20} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('prerequisitesSave'));
    });
    expect(showToast).toHaveBeenCalledWith('お互いを待つことになり、どれも始められません', 'error');
  });
});
