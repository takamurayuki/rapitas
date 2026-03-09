import { renderHook, act } from '@testing-library/react';
import { useAsyncOperation } from '../useAsyncOperation';

describe('useAsyncOperation', () => {
  it('should have correct initial state', () => {
    const { result } = renderHook(() => useAsyncOperation(async () => 'data'));

    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should set loading state during execution', async () => {
    let resolve: (value: string) => void;
    const promise = new Promise<string>((r) => {
      resolve = r;
    });

    const { result } = renderHook(() => useAsyncOperation(async () => promise));

    let executePromise: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolve!('done');
      await executePromise;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBe('done');
  });

  it('should handle errors', async () => {
    const { result } = renderHook(() =>
      useAsyncOperation(async () => {
        throw new Error('test error');
      }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBe('test error');
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should call onSuccess callback', async () => {
    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useAsyncOperation(async () => 'success', { onSuccess }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(onSuccess).toHaveBeenCalledWith('success');
  });

  it('should call onError callback', async () => {
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncOperation(
        async () => {
          throw new Error('fail');
        },
        { onError },
      ),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should reset state', async () => {
    const { result } = renderHook(() => useAsyncOperation(async () => 'data'));

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.data).toBe('data');

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should pass arguments to operation', async () => {
    const operation = vi.fn(async (a: number, b: number) => a + b);

    const { result } = renderHook(() => useAsyncOperation(operation));

    await act(async () => {
      await result.current.execute(3, 4);
    });

    expect(result.current.data).toBe(7);
    expect(operation).toHaveBeenCalledWith(3, 4);
  });

  it('should clear error on new execution', async () => {
    let shouldFail = true;
    const { result } = renderHook(() =>
      useAsyncOperation(async () => {
        if (shouldFail) throw new Error('fail');
        return 'ok';
      }),
    );

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBe('fail');

    shouldFail = false;
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe('ok');
  });

  it('should handle non-Error throws', async () => {
    const { result } = renderHook(() =>
      useAsyncOperation(async () => {
        throw 'string error';
      }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBe('エラーが発生しました');
  });
});
