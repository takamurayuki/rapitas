import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowConfigCard } from './WorkflowConfigCard';
import type { UserSettings } from '@/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const BASE_SETTINGS: UserSettings = {
  id: 1,
  aiTaskAnalysisDefault: false,
  autoResumeInterruptedTasks: false,
  autoExecuteAfterCreate: false,
  autoGenerateTitle: false,
  autoGenerateTitleDelay: 3,
  autoCreateAfterTitleGeneration: false,
  autoFetchTaskSuggestions: true,
  autoApprovePlan: false,
  autoApproveSubtaskPlan: true,
  autoComplexityAnalysis: false,
  activeMode: 'both',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('WorkflowConfigCard', () => {
  it('renders the workflow-disabled toggle label and description', () => {
    render(
      <WorkflowConfigCard settings={BASE_SETTINGS} isSaving={false} onUpdateSettings={vi.fn()} />,
    );
    expect(screen.getByText('workflowDisabledGlobally')).toBeTruthy();
    expect(screen.getByText('workflowDisabledGloballyDescription')).toBeTruthy();
  });

  it('turns the global toggle on from an unset/false state', () => {
    const onUpdateSettings = vi.fn();
    render(
      <WorkflowConfigCard
        settings={BASE_SETTINGS}
        isSaving={false}
        onUpdateSettings={onUpdateSettings}
      />,
    );

    const switches = screen.getAllByRole('switch');
    // Third switch (auto-approve, auto-complexity, then workflow-disabled).
    fireEvent.click(switches[2]);

    expect(onUpdateSettings).toHaveBeenCalledWith({ workflowDisabledGlobally: true });
  });

  it('turns the global toggle back off when already enabled', () => {
    const onUpdateSettings = vi.fn();
    render(
      <WorkflowConfigCard
        settings={{ ...BASE_SETTINGS, workflowDisabledGlobally: true }}
        isSaving={false}
        onUpdateSettings={onUpdateSettings}
      />,
    );

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[2]);

    expect(onUpdateSettings).toHaveBeenCalledWith({ workflowDisabledGlobally: false });
  });

  it('disables all toggles while saving', () => {
    render(
      <WorkflowConfigCard settings={BASE_SETTINGS} isSaving={true} onUpdateSettings={vi.fn()} />,
    );
    for (const el of screen.getAllByRole('switch')) {
      expect((el as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
