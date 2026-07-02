import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

// Modal uses useEffect for Esc key handling; no additional mocks needed.

describe('ConfirmDialog', () => {
  const baseConfig = { message: 'テストメッセージ' };
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(
      <ConfirmDialog open={false} config={baseConfig} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders message when open=true', () => {
    render(
      <ConfirmDialog open={true} config={baseConfig} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.getByText('テストメッセージ')).toBeInTheDocument();
  });

  it('renders default button labels', () => {
    render(
      <ConfirmDialog open={true} config={baseConfig} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('キャンセル')).toBeInTheDocument();
  });

  it('renders custom button labels', () => {
    const config = { message: 'msg', confirmLabel: '削除', cancelLabel: '戻る' };
    render(<ConfirmDialog open={true} config={config} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('削除')).toBeInTheDocument();
    expect(screen.getByText('戻る')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    const config = { message: 'msg', title: 'タイトル' };
    render(<ConfirmDialog open={true} config={config} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('タイトル')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    render(
      <ConfirmDialog open={true} config={baseConfig} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText('OK'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(
      <ConfirmDialog open={true} config={baseConfig} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('applies destructive style to confirm button when variant=destructive', () => {
    const config = { message: 'msg', variant: 'destructive' as const };
    render(<ConfirmDialog open={true} config={config} onConfirm={onConfirm} onCancel={onCancel} />);
    const confirmBtn = screen.getByText('OK');
    expect(confirmBtn.className).toContain('bg-red-600');
  });

  it('applies default style to confirm button when variant is omitted', () => {
    render(
      <ConfirmDialog open={true} config={baseConfig} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const confirmBtn = screen.getByText('OK');
    expect(confirmBtn.className).toContain('bg-zinc-900');
  });

  it('renders message with whitespace-pre-wrap for line breaks', () => {
    const config = { message: 'line1\nline2' };
    const { container } = render(
      <ConfirmDialog open={true} config={config} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const p = container.querySelector('p');
    expect(p).not.toBeNull();
    expect(p?.className).toContain('whitespace-pre-wrap');
    expect(p?.textContent).toBe('line1\nline2');
  });
});
