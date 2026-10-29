/**
 * ContinuationForm tests
 *
 * The box for telling a finished agent what to do next.
 *
 * It used to be a one-line `<input>`, which is the wrong shape for a
 * paragraph of natural-language instruction — you could not see what you had
 * written (reported 2026-10-23). It is now a textarea, and that changes what
 * Enter has to mean: in a multi-line field Enter belongs to the text, and the
 * button it used to press starts a real agent execution. So the tests here
 * are mostly about NOT running: Enter must not submit, an IME conversion must
 * not submit, and whitespace must not submit.
 */
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContinuationForm } from './ContinuationForm';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

let onContinueExecution: Mock<() => Promise<void>>;
let onSetContinueInstruction: Mock<(v: string) => void>;

beforeEach(() => {
  onContinueExecution = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  onSetContinueInstruction = vi.fn<(v: string) => void>();
});

function renderForm(continueInstruction = 'テストも一緒に直して', isExecuting = false) {
  return render(
    <ContinuationForm
      continueInstruction={continueInstruction}
      onSetContinueInstruction={onSetContinueInstruction}
      onContinueExecution={onContinueExecution}
      isExecuting={isExecuting}
    />,
  );
}

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;

describe('the field itself', () => {
  test('is a textarea, so more than one line is visible', () => {
    renderForm();
    expect(box().tagName).toBe('TEXTAREA');
  });

  test('grows with the text rather than scrolling a single line', () => {
    // Two lines of instruction must not be hidden behind a one-line box.
    renderForm('一行目\n二行目\n三行目');
    expect(box().rows).toBeGreaterThan(1);
  });

  test('passes what was typed straight back up', () => {
    renderForm('');
    fireEvent.change(box(), { target: { value: '続きをお願い' } });
    expect(onSetContinueInstruction).toHaveBeenCalledWith('続きをお願い');
  });
});

describe('what must not start an execution', () => {
  test('a bare Enter writes a newline instead of running', () => {
    // The old one-line field ran on Enter. In a textarea that would make a
    // paragraph impossible to type, and every stray Enter would launch an
    // agent — a slow, billable mistake.
    renderForm();
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onContinueExecution).not.toHaveBeenCalled();
  });

  test('an IME conversion-confirming Enter does not run', () => {
    renderForm();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(onContinueExecution).not.toHaveBeenCalled();
  });

  test('the legacy IME marker does not run either', () => {
    // WebView2 and browsers disagree on which of the two is set; both are
    // how a half-converted Japanese sentence would otherwise be submitted.
    renderForm();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(onContinueExecution).not.toHaveBeenCalled();
  });

  test('whitespace alone does not run', () => {
    renderForm('   ');
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(onContinueExecution).not.toHaveBeenCalled();
  });

  test('the button is unavailable while an execution is already going', () => {
    renderForm('何か', true);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  test('the button is unavailable with nothing written', () => {
    renderForm('');
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('what does start an execution', () => {
  test('Ctrl+Enter runs it', () => {
    renderForm();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(onContinueExecution).toHaveBeenCalledTimes(1);
  });

  test('Cmd+Enter runs it', () => {
    renderForm();
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(onContinueExecution).toHaveBeenCalledTimes(1);
  });

  test('the button runs it', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button'));
    expect(onContinueExecution).toHaveBeenCalledTimes(1);
  });

  test('says which keys do it, so the shortcut is discoverable', () => {
    // A shortcut nobody is told about is a shortcut nobody uses, and this one
    // replaced the Enter people had already learned.
    renderForm();
    expect(screen.getByText('submitHint')).toBeInTheDocument();
  });
});
