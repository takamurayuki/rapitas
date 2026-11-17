/**
 * SaveToNoteButton tests
 *
 * The "ノートに保存" action under ラピ's reply in the copilot panel: shown on
 * text replies only, drafts the note from the answer alone (POST
 * /notes/draft-from-reply), turns into "保存済み" after a save and does not
 * send again, and never reports success when the draft or the save failed.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import type { CopilotMessage } from '../useCopilotChat';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const showToast = vi.fn();
vi.mock('@/components/ui/toast/ToastContainer', () => ({ useToast: () => ({ showToast }) }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const reply: CopilotMessage = {
  id: 'a1',
  role: 'assistant',
  content: 'まず **ログ** を見ます。',
  createdAt: '2026-11-17T00:00:00Z',
};

function renderReply(msg: CopilotMessage = reply) {
  return render(<MessageBubble msg={msg} saveNote={{ taskId: 42 }} />);
}

const DRAFT = { success: true, title: 'ログの見方', content: '## 手順\n\n- ログを見る\n' };

/** The draft endpoint answers with DRAFT; every other call with `rest`. */
function server(rest: (url: string) => { ok: boolean; status?: number } = () => ({ ok: true })) {
  return vi.fn((url: string) => {
    if (url.endsWith('/notes/draft-from-reply')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DRAFT) });
    }
    const r = rest(url);
    return Promise.resolve({ ...r, json: () => Promise.resolve({ success: r.ok }) });
  }) as unknown as typeof fetch;
}

function sent() {
  return vi.mocked(global.fetch).mock.calls.map(([url, init]) => ({
    url: String(url),
    method: (init as RequestInit).method,
    body: JSON.parse(String((init as RequestInit).body)),
  }));
}

describe('SaveToNoteButton', () => {
  beforeEach(() => {
    showToast.mockReset();
    push.mockReset();
    global.fetch = server();
  });

  it('saves once, shows the saved state and does not send again', async () => {
    renderReply();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'saved' })).toBeDisabled());
    // Draft from the answer alone, save the draft as it came back, then link.
    expect(sent()).toEqual([
      {
        url: 'http://test/notes/draft-from-reply',
        method: 'POST',
        body: { answer: 'まず **ログ** を見ます。' },
      },
      {
        url: expect.stringMatching(/^http:\/\/test\/notes\/\d+$/),
        method: 'PUT',
        body: { title: DRAFT.title, content: DRAFT.content },
      },
      {
        url: expect.stringMatching(/\/links$/),
        method: 'POST',
        body: { taskId: 42 },
      },
    ]);
    expect(showToast).toHaveBeenCalledWith('savedToast', 'success', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'saved' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(3);

    // The toast's "開く" goes to the notes page.
    const action = showToast.mock.calls[0][2].action as { onClick: () => void };
    action.onClick();
    expect(push).toHaveBeenCalledWith('/notes');
  });

  it('says the link failed when only the link failed', async () => {
    global.fetch = server((url) => ({ ok: !url.endsWith('/links'), status: 500 }));
    renderReply();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'saved' })).toBeInTheDocument());
    expect(showToast).toHaveBeenCalledWith('savedLinkFailed', 'warning', expect.anything());
  });

  it('stays saved when only the local copy failed, so a retry cannot make a second note', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    try {
      renderReply();
      fireEvent.click(screen.getByRole('button', { name: 'save' }));

      await waitFor(() => expect(screen.getByRole('button', { name: 'saved' })).toBeDisabled());
      expect(showToast).toHaveBeenCalledWith('savedToast', 'success', expect.anything());
      expect(showToast).not.toHaveBeenCalledWith('failed', 'error');
      fireEvent.click(screen.getByRole('button', { name: 'saved' }));
      await new Promise((r) => setTimeout(r, 0));
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      setItem.mockRestore();
    }
  });

  it('saves nothing when the draft failed, shows the failure, and lets the user retry', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) }),
    ) as unknown as typeof fetch;
    renderReply();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('failed', 'error'));
    expect(sent().map((c) => c.method)).toEqual(['POST']);
    expect(showToast).not.toHaveBeenCalledWith('savedToast', expect.anything(), expect.anything());
    expect(screen.getByRole('button', { name: 'save' })).toBeEnabled();

    // Retry once the draft works: now it saves.
    global.fetch = server();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'saved' })).toBeDisabled());
    expect(sent().map((c) => c.method)).toEqual(['POST', 'PUT', 'POST']);
  });

  it('does not show success when the save failed, and lets the user retry', async () => {
    global.fetch = server(() => ({ ok: false, status: 500 }));
    renderReply();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('failed', 'error'));
    expect(showToast).not.toHaveBeenCalledWith('savedToast', expect.anything(), expect.anything());
    expect(screen.queryByRole('button', { name: 'saved' })).toBeNull();
    expect(screen.getByRole('button', { name: 'save' })).toBeEnabled();
  });

  it('is not offered on the user line or the analysis card', () => {
    const { unmount } = renderReply({ ...reply, role: 'user' });
    expect(screen.queryByRole('button', { name: 'save' })).toBeNull();
    unmount();
    renderReply({
      ...reply,
      actionData: {
        type: 'analyze',
        data: { summary: 's', complexity: 'low', estimatedTotalHours: 1, suggestedSubtasks: [] },
      },
    });
    expect(screen.queryByRole('button', { name: 'save' })).toBeNull();
  });
});
