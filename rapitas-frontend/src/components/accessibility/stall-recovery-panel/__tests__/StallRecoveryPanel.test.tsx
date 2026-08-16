/**
 * StallRecoveryPanel 統合テスト
 *
 * 開閉イベント → 停滞一覧表示 → アクション選択 → Space承認 → 実行、の段階フローと
 * 「承認前に recover が呼ばれない」「Escでキャンセル」「aria-live更新」
 * 「音声不可時のテキストフォールバック」を検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import StallRecoveryPanel from '../StallRecoveryPanel';
import { OPEN_STALL_RECOVERY_EVENT } from '../stall-recovery.types';
import { useVoiceNarrationStore } from '@/stores/voice-narration-store';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${Object.values(params).join(',')})` : key,
}));

const mockCheck = vi.fn();
const mockRecover = vi.fn();
vi.mock('@/hooks/accessibility', () => ({
  useStallCheck: () => ({ check: mockCheck, recover: mockRecover }),
}));

const mockSpeak = vi.fn();
const mockIsAvailable = vi.fn(() => false);
vi.mock('@/lib/accessibility/speech-narrator', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  isAvailable: () => mockIsAvailable(),
  stop: vi.fn(),
}));

const SAMPLE_REPORT = {
  taskId: 42,
  title: '停滞テストタスク',
  staleMinutes: 45,
  cause: 'エージェント実行が中断されたまま再開されていない可能性があります',
  narration: 'タスク「停滞テストタスク」が45分間停滞しています。',
  suggestedActions: ['resume', 'requeue', 'clear_git_lock'],
};

async function openPanel() {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(OPEN_STALL_RECOVERY_EVENT));
  });
}

describe('StallRecoveryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockReturnValue(false);
    mockCheck.mockResolvedValue({ tasks: [SAMPLE_REPORT], checkedAt: new Date().toISOString() });
    mockRecover.mockResolvedValue({
      success: true,
      action: 'resume',
      message: '中断された実行 #77 を再開しています',
    });
    useVoiceNarrationStore.setState({ enabled: true, rate: 1.0, verbosity: 'standard' });
  });

  it('開くイベントで停滞タスク一覧が表示され、aria-liveに通知が入ること', async () => {
    render(<StallRecoveryPanel />);
    expect(screen.queryByRole('dialog')).toBeNull();

    await openPanel();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /停滞テストタスク/ })).toBeInTheDocument();
    const live = screen.getByRole('status');
    expect(live.textContent).toContain('stalledCount(1)');
    expect(live.textContent).toContain('45分間停滞');
  });

  it('停滞0件のときは noStalledTasks を表示・通知すること', async () => {
    mockCheck.mockResolvedValue({ tasks: [], checkedAt: new Date().toISOString() });
    render(<StallRecoveryPanel />);
    await openPanel();

    expect(screen.getAllByText('noStalledTasks').length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toContain('noStalledTasks');
  });

  it('承認（Space）前には recover が一切呼ばれないこと', async () => {
    render(<StallRecoveryPanel />);
    await openPanel();

    fireEvent.click(await screen.findByRole('button', { name: /停滞テストタスク/ }));
    expect(screen.getByText('actionsLabel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('actions.resume'));
    expect(screen.getByText('confirmPrompt')).toBeInTheDocument();

    // ここまで一覧表示→アクション選択→確認画面まで進んだが、承認していない
    expect(mockRecover).not.toHaveBeenCalled();
  });

  it('確認ステップで Space を押すと recover が実行され結果が読み上げられること', async () => {
    render(<StallRecoveryPanel />);
    await openPanel();

    fireEvent.click(await screen.findByRole('button', { name: /停滞テストタスク/ }));
    fireEvent.click(screen.getByText('actions.resume'));

    await act(async () => {
      fireEvent.keyDown(window, { key: ' ' });
    });

    await waitFor(() => expect(mockRecover).toHaveBeenCalledWith(42, 'resume'));
    expect((await screen.findAllByText(/#77 を再開しています/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toContain('#77 を再開しています');
  });

  it('一覧以外のステップでは Space は実行キーにならないこと（listステップ）', async () => {
    render(<StallRecoveryPanel />);
    await openPanel();
    await screen.findByRole('button', { name: /停滞テストタスク/ });

    await act(async () => {
      fireEvent.keyDown(window, { key: ' ' });
    });
    expect(mockRecover).not.toHaveBeenCalled();
  });

  it('Esc は確認→アクション→一覧→クローズと段階的に戻ること', async () => {
    render(<StallRecoveryPanel />);
    await openPanel();

    fireEvent.click(await screen.findByRole('button', { name: /停滞テストタスク/ }));
    fireEvent.click(screen.getByText('actions.resume'));
    expect(screen.getByText('confirmPrompt')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('actionsLabel')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: /停滞テストタスク/ })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockRecover).not.toHaveBeenCalled();
  });

  it('破壊的アクションには destructiveBadge が表示されること', async () => {
    render(<StallRecoveryPanel />);
    await openPanel();

    fireEvent.click(await screen.findByRole('button', { name: /停滞テストタスク/ }));
    expect(screen.getByText('actions.clear_git_lock')).toBeInTheDocument();
    expect(screen.getByText('destructiveBadge')).toBeInTheDocument();
  });

  it('音声不可（getVoices空相当）でも voiceUnavailable バッジ＋テキスト通知で完結すること', async () => {
    mockIsAvailable.mockReturnValue(false);
    render(<StallRecoveryPanel />);
    await openPanel();

    expect(screen.getByText('voiceUnavailable')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).not.toBe('');
  });

  it('音声有効かつ利用可能なら speak が設定レートで呼ばれること', async () => {
    mockIsAvailable.mockReturnValue(true);
    useVoiceNarrationStore.setState({ enabled: true, rate: 1.5, verbosity: 'standard' });
    render(<StallRecoveryPanel />);
    await openPanel();

    expect(mockSpeak).toHaveBeenCalled();
    const lastCall = mockSpeak.mock.calls.at(-1) as unknown[];
    expect(lastCall[1]).toEqual({ rate: 1.5 });
  });

  it('API失敗時は checkFailed を表示すること', async () => {
    mockCheck.mockResolvedValue(null);
    render(<StallRecoveryPanel />);
    await openPanel();

    expect(screen.getAllByText('checkFailed').length).toBeGreaterThan(0);
  });
});
