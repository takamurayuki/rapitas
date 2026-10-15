import { renderHook, act } from '@testing-library/react';
import { useAsyncOperation, useMultiAsyncOperation } from '../common/useAsyncOperation';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});

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

    const { result } = renderHook(() => useAsyncOperation(async () => 'success', { onSuccess }));

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

    expect(result.current.error).toBe('errorOccurred');
  });

  it('should allow directly setting data via setData', () => {
    const { result } = renderHook(() => useAsyncOperation(async () => 'data'));

    act(() => {
      result.current.setData('manual');
    });

    expect(result.current.data).toBe('manual');
  });

  it('should allow directly setting error via setError', () => {
    const { result } = renderHook(() => useAsyncOperation(async () => 'data'));

    act(() => {
      result.current.setError('manual error');
    });

    expect(result.current.error).toBe('manual error');
  });
});

describe('useMultiAsyncOperation', () => {
  it('initializes each operation with empty state', () => {
    const { result } = renderHook(() =>
      useMultiAsyncOperation({
        fetchA: async () => 'a',
        fetchB: async () => 1,
      }),
    );

    expect(result.current.states.fetchA).toEqual({ data: null, isLoading: false, error: null });
    expect(result.current.states.fetchB).toEqual({ data: null, isLoading: false, error: null });
  });

  it('sets isLoading true while executing, then stores the result', async () => {
    let resolve: (value: string) => void;
    const promise = new Promise<string>((r) => {
      resolve = r;
    });
    const { result } = renderHook(() => useMultiAsyncOperation({ fetchA: async () => promise }));

    let executePromise!: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute('fetchA');
    });

    expect(result.current.states.fetchA.isLoading).toBe(true);

    await act(async () => {
      resolve!('done');
      await executePromise;
    });

    expect(result.current.states.fetchA).toEqual({ data: 'done', isLoading: false, error: null });
  });

  it('stores an Error message on failure without disturbing other keys', async () => {
    const { result } = renderHook(() =>
      useMultiAsyncOperation({
        fetchA: async () => {
          throw new Error('boom');
        },
        fetchB: async () => 'ok-b',
      }),
    );

    await act(async () => {
      await result.current.execute('fetchB');
    });
    await act(async () => {
      await result.current.execute('fetchA');
    });

    expect(result.current.states.fetchA).toEqual({
      data: null,
      isLoading: false,
      error: 'boom',
    });
    expect(result.current.states.fetchB.data).toBe('ok-b');
  });

  it('falls back to the translated message for non-Error throws', async () => {
    const { result } = renderHook(() =>
      useMultiAsyncOperation({
        fetchA: async () => {
          throw 'string error';
        },
      }),
    );

    await act(async () => {
      await result.current.execute('fetchA');
    });

    expect(result.current.states.fetchA.error).toBe('errorOccurred');
  });

  it('passes arguments through to the keyed operation', async () => {
    // useMultiAsyncOperation constrains operations to `(...args: unknown[]) =>
    // Promise<unknown>`, so the mock must match that shape at the type level.
    const operation = vi.fn(
      async (...args: unknown[]) => (args[0] as number) + (args[1] as number),
    );
    const { result } = renderHook(() => useMultiAsyncOperation({ sum: operation }));

    await act(async () => {
      await result.current.execute('sum', 3, 4);
    });

    expect(operation).toHaveBeenCalledWith(3, 4);
    expect(result.current.states.sum.data).toBe(7);
  });

  it('reset(key) clears only that operation state', async () => {
    const { result } = renderHook(() =>
      useMultiAsyncOperation({
        fetchA: async () => 'a',
        fetchB: async () => 'b',
      }),
    );

    await act(async () => {
      await result.current.execute('fetchA');
      await result.current.execute('fetchB');
    });

    act(() => {
      result.current.reset('fetchA');
    });

    expect(result.current.states.fetchA).toEqual({ data: null, isLoading: false, error: null });
    expect(result.current.states.fetchB.data).toBe('b');
  });

  it('resetAll clears every operation state', async () => {
    const { result } = renderHook(() =>
      useMultiAsyncOperation({
        fetchA: async () => 'a',
        fetchB: async () => 'b',
      }),
    );

    await act(async () => {
      await result.current.execute('fetchA');
      await result.current.execute('fetchB');
    });

    act(() => {
      result.current.resetAll();
    });

    expect(result.current.states.fetchA).toEqual({ data: null, isLoading: false, error: null });
    expect(result.current.states.fetchB).toEqual({ data: null, isLoading: false, error: null });
  });
});
