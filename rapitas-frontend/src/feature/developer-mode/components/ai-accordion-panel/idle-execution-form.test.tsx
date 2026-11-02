/**
 * IdleExecutionForm tests
 *
 * The instruction box on a task that has not been run yet.
 *
 * This is the field labelled 「追加指示があれば入力...（任意）」 — the one
 * actually on screen when the idle panel was reported on 2026-10-23, and a
 * different component from ContinuationForm despite the shared name. It takes
 * free-text guidance for the run, and it was a one-line input showing about
 * eight characters of it.
 *
 * It earns its place: steering a run by editing the task's own description
 * instead makes the plan oscillate against the spec, so a per-run instruction
 * that leaves the spec alone is the safer path, not a redundant one.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IdleExecutionForm } from './idle-execution-form';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

function renderForm(instruction = '', onSetInstruction = vi.fn<(v: string) => void>()) {
  render(
    <IdleExecutionForm
      instruction={instruction}
      branchName=""
      baseBranch="develop"
      baseBranches={['develop']}
      onSetInstruction={onSetInstruction}
      onSetBranchName={vi.fn()}
      onSetBaseBranch={vi.fn()}
    />,
  );
  return onSetInstruction;
}

/** The instruction field, by its aria label — the branch inputs are hidden behind 詳細設定. */
const box = () => screen.getByLabelText('instructionAriaLabel') as HTMLTextAreaElement;

describe('the instruction field', () => {
  test('is a textarea, so a multi-sentence instruction is visible', () => {
    renderForm();
    expect(box().tagName).toBe('TEXTAREA');
  });

  test('grows with the text instead of hiding it in one line', () => {
    renderForm('前提を調べて\n設計を書いて\nテストから実装して');
    expect(box().rows).toBeGreaterThan(1);
  });

  test('keeps a newline rather than losing it', () => {
    // In a one-line input Enter had nowhere to go. Here it is content, and
    // the parent must receive it intact.
    const onSet = renderForm();
    fireEvent.change(box(), { target: { value: '一行目\n二行目' } });
    expect(onSet).toHaveBeenCalledWith('一行目\n二行目');
  });

  test('passes an ordinary edit straight up', () => {
    const onSet = renderForm();
    fireEvent.change(box(), { target: { value: 'テストを先に' } });
    expect(onSet).toHaveBeenCalledWith('テストを先に');
  });
});
