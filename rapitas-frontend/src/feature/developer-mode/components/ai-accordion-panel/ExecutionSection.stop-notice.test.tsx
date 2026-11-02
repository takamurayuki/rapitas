/**
 * ExecutionSection.stop-notice.test
 *
 * The #1330 review's third finding was that the stop signal had no reader.
 * Adding `isStopping` / `stopNotice` to the hook would repeat that mistake if
 * nothing rendered them, so these tests walk the wire all the way to the
 * screen: the button's pending state, and each notice reaching the panel.
 */
import { render, screen } from '@testing-library/react';
import { ExecutionSection, type ExecutionSectionProps } from './ExecutionSection';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./ExecutionBody', () => ({ ExecutionBody: () => null }));
vi.mock('./ExecutionCapabilityGuide', () => ({ ExecutionCapabilityGuide: () => null }));
vi.mock('../../hooks/useTaskPrAvailability', () => ({
  useTaskPrAvailability: () => 'unavailable',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const base: ExecutionSectionProps = {
  taskId: 894,
  isRunning: true,
  isCompleted: false,
  isCancelled: false,
  isFailed: false,
  isInterrupted: false,
  isExecuting: true,
  hasSubtasks: false,
  logs: [],
  showLogs: true,
  logViewerStatus: 'running',
  isSseConnected: true,
  executionError: null,
  hasQuestion: false,
  question: '',
  userResponse: '',
  isSendingResponse: false,
  onSetUserResponse: vi.fn(),
  onSendResponse: vi.fn(),
  continueInstruction: '',
  onSetContinueInstruction: vi.fn(),
  onContinueExecution: vi.fn(),
  instruction: '',
  branchName: '',
  baseBranch: '',
  baseBranches: [],
  isGeneratingBranchName: false,
  onSetInstruction: vi.fn(),
  onSetBranchName: vi.fn(),
  onSetBaseBranch: vi.fn(),
  onGenerateBranchName: vi.fn(),
  isStopping: false,
  stopNotice: null,
  onExecute: vi.fn(),
  onStop: vi.fn(),
  onReset: vi.fn(),
  onRerun: vi.fn(),
};

/** The stop button, found by its aria label key (next-intl is stubbed). */
function stopButton(): HTMLElement {
  return screen.getByRole('button', { name: 'stopAria' });
}

describe('the stop button while a stop is in flight', () => {
  it('is enabled and reads "stop" when idle', () => {
    render(<ExecutionSection {...base} />);

    expect(stopButton()).not.toBeDisabled();
    expect(stopButton()).toHaveTextContent('stop');
  });

  it('is disabled and reads "stopping" while the request is in flight', () => {
    // The request is awaited now, so a second click would fire a second stop.
    render(<ExecutionSection {...base} isStopping />);

    expect(stopButton()).toBeDisabled();
    expect(stopButton()).toHaveTextContent('stopping');
  });
});

describe('the stop notice', () => {
  it('shows nothing when the stop was clean', () => {
    render(<ExecutionSection {...base} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells the user when nothing was stopped', () => {
    render(<ExecutionSection {...base} stopNotice={{ kind: 'failed' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('stopFailed');
  });

  it('tells the user when the status could not be reset', () => {
    render(<ExecutionSection {...base} stopNotice={{ kind: 'reset_failed' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('stopResetFailed');
  });

  it("prefers the backend's own wording over the generic text", () => {
    render(
      <ExecutionSection
        {...base}
        stopNotice={{ kind: 'reset_failed', serverMessage: 'サーバー側の説明' }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('サーバー側の説明');
  });
});
