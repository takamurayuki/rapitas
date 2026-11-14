/**
 * RapiPrompt.test
 *
 * The box you write to ラピ in. What happens to a sentence after it is sent
 * is the conversation's job (see useRapiConversation.test); what is held
 * here is the box itself: how big it is, how it sends, and that it cannot
 * be edited while a sentence is on its way.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import { MIN_INPUT_PX, RapiPrompt } from '../RapiPrompt';

function Box({
  onSend = vi.fn(),
  onCancel = vi.fn(),
  sending = false,
  initial = '',
}: {
  onSend?: () => void;
  onCancel?: () => void;
  sending?: boolean;
  initial?: string;
}) {
  const [text, setText] = useState(initial);
  return (
    <RapiPrompt
      text={text}
      onChange={setText}
      sending={sending}
      onSend={onSend}
      onCancel={onCancel}
    />
  );
}

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;

describe('sending', () => {
  it('sends on Enter', () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} initial="なにか" />);
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('breaks the line on Shift+Enter instead', () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} initial="なにか" />);
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends with the button too, once there is something to send', () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    const button = screen.getByLabelText('rapiAvatar.prompt.send') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(box(), { target: { value: 'なにか' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe('while a sentence is on its way', () => {
  it('will not let the box be edited', () => {
    render(<Box sending />);
    expect(box().disabled).toBe(true);
  });

  it('offers a way out', () => {
    const onCancel = vi.fn();
    render(<Box sending onCancel={onCancel} />);
    fireEvent.click(screen.getByText('rapiAvatar.prompt.cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('the size of the box', () => {
  /** jsdom lays nothing out, so the content height is supplied. */
  const withContentHeight = (px: number) => {
    Object.defineProperty(box(), 'scrollHeight', { value: px, configurable: true });
    return box();
  };

  // It started as one 12px line, which read as a search field and was
  // reported as too cramped to write a request in (2026-11-14).
  it('starts three lines tall', () => {
    render(<Box />);
    expect(box().rows).toBe(3);
    expect(box().className).toContain('text-sm');
  });

  it('does not shrink below those three lines when the content is short', () => {
    render(<Box />);
    fireEvent.change(withContentHeight(20), { target: { value: 'あ' } });
    expect(box().style.height).toBe(`${MIN_INPUT_PX}px`);
  });

  it('grows to fit what was typed', () => {
    render(<Box />);
    fireEvent.change(withContentHeight(120), { target: { value: 'ふたつ\nみっつ\nよっつ' } });
    expect(box().style.height).toBe('120px');
  });

  it('stops growing before it eats the panel', () => {
    render(<Box />);
    fireEvent.change(withContentHeight(400), { target: { value: 'とても長い文章' } });
    expect(box().style.height).toBe('200px');
    expect(box().style.overflowY).toBe('auto');
  });
});
