/**
 * RapiThreadFeel.test
 *
 * How ラピ's thread feels while you talk (nav62, same as the mobile app):
 * a sentence she has read carries a stamp and one she has not (on its way,
 * failed or cancelled) does not — see RapiReadStamp.test for when and which; while she works, three waving dots stand in for the
 * words; and her Markdown replies are drawn at chat density.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('../../../intake', () => ({
  TaskWatch: () => null,
  TaskIntake: () => null,
  TaskAsk: () => null,
  TaskConsult: () => null,
  TaskTidy: () => null,
  TaskRoadmap: () => null,
}));
vi.mock('../../../intake/change', () => ({ TaskChange: () => null }));

import { RapiThread } from '../RapiThread';
import type { RapiMessage } from '../conversation-types';

function line(partial: Partial<RapiMessage> & Pick<RapiMessage, 'id' | 'role' | 'text'>) {
  return { clientId: `c${partial.id}`, inHistory: false, ...partial } as RapiMessage;
}

const stamps = () => document.querySelectorAll('[data-chat-received]');

describe('read stamp', () => {
  it('marks the sentences she has read, not the ones taken back', () => {
    render(
      <RapiThread
        sending={false}
        rethinkAsPlan={() => {}}
        messages={[
          line({ id: 1, role: 'user', text: '受け付けた', inHistory: true, readAs: 'chat' }),
          line({ id: 2, role: 'user', text: '失敗した', inHistory: false }),
          // NOTE: in the history but not read yet (on its way): no stamp since nav63.
          line({ id: 3, role: 'user', text: '送信中', inHistory: true }),
        ]}
      />,
    );
    expect(stamps()).toHaveLength(1);
    const accepted = screen.getByText('受け付けた').closest('div.relative');
    expect(accepted?.querySelector('[data-chat-received]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'copilot.chatFeel.received' })).toBeInTheDocument();
    // The stamp is beside the line, so the line still reads as what was said.
    expect(screen.getByText('受け付けた').textContent).toBe('受け付けた');
  });

  it('never stamps her own lines', () => {
    render(
      <RapiThread
        sending={false}
        rethinkAsPlan={() => {}}
        messages={[
          line({ id: 0, role: 'assistant', text: 'こんにちは', inHistory: true, localOnly: true }),
        ]}
      />,
    );
    expect(stamps()).toHaveLength(0);
  });
});

describe('typing dots', () => {
  it('shows three dots and no words while she works', () => {
    render(
      <RapiThread
        sending
        rethinkAsPlan={() => {}}
        messages={[line({ id: 1, role: 'user', text: 'こんにちは', inHistory: true })]}
      />,
    );
    const typing = document.querySelector('[data-rapi-typing]');
    expect(typing).not.toBeNull();
    expect(typing?.querySelectorAll('[data-chat-typing-dot]')).toHaveLength(3);
    expect(typing?.textContent).toBe('');
    expect(screen.getByRole('status', { name: 'rapiAvatar.prompt.thinking' })).toBeInTheDocument();
  });

  it('is gone once she has answered', () => {
    render(<RapiThread sending={false} rethinkAsPlan={() => {}} messages={[]} />);
    expect(document.querySelector('[data-rapi-typing]')).toBeNull();
  });
});

describe('her replies', () => {
  it('draws Markdown at chat density instead of showing the marks', async () => {
    render(
      <RapiThread
        sending={false}
        rethinkAsPlan={() => {}}
        messages={[
          line({
            id: 3,
            role: 'assistant',
            text: '## 進め方\n\nまず **資料** から。\n\n- 下書き\n- 図',
          }),
        ]}
      />,
    );
    // MarkdownView is loaded on demand (next/dynamic); a cold transform can take a while.
    const strong = await screen.findByText('資料', undefined, { timeout: 10_000 });
    expect(strong.tagName).toBe('STRONG');
    expect(screen.getByRole('heading', { name: '進め方' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(document.querySelector('[data-density="chat"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('**');
    // Markdown lays out its own blocks; pre-wrap would add the source's blank lines.
    const bubble = document.querySelector('[data-rapi-line="assistant"]');
    expect(bubble?.className).not.toContain('whitespace-pre-wrap');
  });
});
