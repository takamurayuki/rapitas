import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConfirmDialogProvider, useConfirmDialog } from '../ConfirmDialogProvider';

// ConfirmDialog's default cancel label resolves via next-intl; echo the key back
// (mirrors the shared test mock) so the default cancel button reads 'cancel'.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

/** Helper component that calls confirm() and displays the result. */
function TestConsumer({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirmDialog();

  const handleClick = async () => {
    const result = await confirm('削除しますか？');
    onResult(result);
  };

  return <button onClick={handleClick}>Open confirm</button>;
}

describe('ConfirmDialogProvider', () => {
  it('throws when useConfirmDialog is called outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function NoProvider() {
      useConfirmDialog();
      return null;
    }
    expect(() => render(<NoProvider />)).toThrow(
      'useConfirmDialog must be used within ConfirmDialogProvider',
    );
    spy.mockRestore();
  });

  it('shows dialog when confirm() is called', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmDialogProvider>
        <TestConsumer onResult={onResult} />
      </ConfirmDialogProvider>,
    );

    // Dialog not shown initially
    expect(screen.queryByText('削除しますか？')).toBeNull();

    // Trigger confirm
    await act(async () => {
      fireEvent.click(screen.getByText('Open confirm'));
    });

    expect(screen.getByText('削除しますか？')).toBeInTheDocument();
  });

  it('resolves true when confirm button is clicked', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmDialogProvider>
        <TestConsumer onResult={onResult} />
      </ConfirmDialogProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Open confirm'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('OK'));
    });

    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByText('削除しますか？')).toBeNull();
  });

  it('resolves false when cancel button is clicked', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmDialogProvider>
        <TestConsumer onResult={onResult} />
      </ConfirmDialogProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Open confirm'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('cancel'));
    });

    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByText('削除しますか？')).toBeNull();
  });

  it('accepts ConfirmOptions object', async () => {
    function OptionsConsumer() {
      const confirm = useConfirmDialog();
      const handleClick = async () => {
        await confirm({ message: 'カスタムメッセージ', title: 'タイトル', variant: 'destructive' });
      };
      return <button onClick={handleClick}>Open</button>;
    }

    render(
      <ConfirmDialogProvider>
        <OptionsConsumer />
      </ConfirmDialogProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Open'));
    });

    expect(screen.getByText('カスタムメッセージ')).toBeInTheDocument();
    expect(screen.getByText('タイトル')).toBeInTheDocument();
    // destructive variant — confirm button should have red styling
    expect(screen.getByText('OK').className).toContain('bg-red-600');
  });
});
