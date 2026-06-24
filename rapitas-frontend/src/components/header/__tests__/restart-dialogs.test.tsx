/**
 * header/__tests__/restart-dialogs.test.tsx
 *
 * Integration tests for the RestartDialogs component.
 * Tests confirmation dialog rendering with active execution count,
 * cancel/restart button callbacks, and the restarting overlay.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RestartDialogs } from '../restart-dialogs';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('lucide-react', () => ({
  Loader2: ({ className }: { className?: string }) => (
    <div data-testid="loader2-icon" className={className} />
  ),
}));

const defaultProps = {
  restartConfirmDialog: { open: false, activeExecutions: 0 },
  setRestartConfirmDialog: vi.fn(),
  executeRestart: vi.fn().mockResolvedValue(undefined),
  isRestarting: false,
};

describe('RestartDialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when dialog is closed and not restarting', () => {
    const { container } = render(<RestartDialogs {...defaultProps} />);
    // The component renders an empty fragment
    expect(container.firstChild).toBeNull();
  });

  describe('confirmation dialog', () => {
    it('shows the dialog when restartConfirmDialog.open is true', () => {
      render(
        <RestartDialogs
          {...defaultProps}
          restartConfirmDialog={{ open: true, activeExecutions: 3 }}
        />,
      );
      expect(screen.getByText('restartConfirm')).toBeInTheDocument();
    });

    it('displays the activeExecutions count', () => {
      render(
        <RestartDialogs
          {...defaultProps}
          restartConfirmDialog={{ open: true, activeExecutions: 5 }}
        />,
      );
      // The count and tasksUnit are rendered as sibling text nodes in the same <span>
      const warningParagraph = screen.getByText('restartWarning').closest('p');
      expect(warningParagraph?.textContent).toContain('5');
    });

    it('displays the restart warning message', () => {
      render(
        <RestartDialogs
          {...defaultProps}
          restartConfirmDialog={{ open: true, activeExecutions: 2 }}
        />,
      );
      expect(screen.getByText('restartWarning')).toBeInTheDocument();
    });

    it('calls setRestartConfirmDialog with closed state on cancel', () => {
      const setRestartConfirmDialog = vi.fn();
      render(
        <RestartDialogs
          {...defaultProps}
          restartConfirmDialog={{ open: true, activeExecutions: 3 }}
          setRestartConfirmDialog={setRestartConfirmDialog}
        />,
      );
      fireEvent.click(screen.getByText('cancel'));
      expect(setRestartConfirmDialog).toHaveBeenCalledWith({ open: false, activeExecutions: 0 });
    });

    it('calls executeRestart on confirm button click', () => {
      const executeRestart = vi.fn().mockResolvedValue(undefined);
      render(
        <RestartDialogs
          {...defaultProps}
          restartConfirmDialog={{ open: true, activeExecutions: 1 }}
          executeRestart={executeRestart}
        />,
      );
      fireEvent.click(screen.getByText('restart'));
      expect(executeRestart).toHaveBeenCalled();
    });

    it('does not show the dialog when open is false', () => {
      render(
        <RestartDialogs
          {...defaultProps}
          restartConfirmDialog={{ open: false, activeExecutions: 0 }}
        />,
      );
      expect(screen.queryByText('restartConfirm')).not.toBeInTheDocument();
    });
  });

  describe('restarting overlay', () => {
    it('shows the overlay spinner when isRestarting=true', () => {
      render(<RestartDialogs {...defaultProps} isRestarting={true} />);
      expect(screen.getByTestId('loader2-icon')).toBeInTheDocument();
    });

    it('shows the restartingOverlay message', () => {
      render(<RestartDialogs {...defaultProps} isRestarting={true} />);
      expect(screen.getByText('restartingOverlay')).toBeInTheDocument();
    });

    it('shows the restartingMessage text', () => {
      render(<RestartDialogs {...defaultProps} isRestarting={true} />);
      expect(screen.getByText('restartingMessage')).toBeInTheDocument();
    });

    it('does not show the overlay when isRestarting=false', () => {
      render(<RestartDialogs {...defaultProps} isRestarting={false} />);
      expect(screen.queryByText('restartingOverlay')).not.toBeInTheDocument();
    });

    it('can show both dialog and overlay simultaneously', () => {
      render(
        <RestartDialogs
          {...defaultProps}
          restartConfirmDialog={{ open: true, activeExecutions: 2 }}
          isRestarting={true}
        />,
      );
      expect(screen.getByText('restartConfirm')).toBeInTheDocument();
      expect(screen.getByText('restartingOverlay')).toBeInTheDocument();
    });
  });
});
