import { renderHook, act } from '@testing-library/react';
import { useLoginForm } from '../useLoginForm';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useLoginForm', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token: 'abc' }),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return initial state', () => {
    const { result } = renderHook(() => useLoginForm());
    expect(result.current.username).toBe('');
    expect(result.current.password).toBe('');
    expect(result.current.errors).toEqual({});
    expect(result.current.isSubmitting).toBe(false);
  });

  it('should update username and password', () => {
    const { result } = renderHook(() => useLoginForm());

    act(() => {
      result.current.setUsername('testuser');
    });
    expect(result.current.username).toBe('testuser');

    act(() => {
      result.current.setPassword('password123');
    });
    expect(result.current.password).toBe('password123');
  });

  it('should validate empty username', async () => {
    const { result } = renderHook(() => useLoginForm());

    act(() => {
      result.current.setPassword('password123');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(result.current.errors.username).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should validate empty password', async () => {
    const { result } = renderHook(() => useLoginForm());

    act(() => {
      result.current.setUsername('testuser');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(result.current.errors.password).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should validate password minimum length', async () => {
    const { result } = renderHook(() => useLoginForm());

    act(() => {
      result.current.setUsername('testuser');
      result.current.setPassword('12345');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(result.current.errors.password).toContain('6');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should submit form with valid data', async () => {
    const { result } = renderHook(() => useLoginForm());

    act(() => {
      result.current.setUsername('testuser');
      result.current.setPassword('password123');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(fetch).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password123' }),
    });
    expect(result.current.errors).toEqual({});
    expect(result.current.isSubmitting).toBe(false);
  });

  it('should handle server error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ message: 'Invalid credentials' }),
      }),
    );

    const { result } = renderHook(() => useLoginForm());

    act(() => {
      result.current.setUsername('testuser');
      result.current.setPassword('password123');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(result.current.errors.form).toBe('Invalid credentials');
  });

  it('should handle server error with no JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error('parse error')),
      }),
    );

    const { result } = renderHook(() => useLoginForm());

    act(() => {
      result.current.setUsername('testuser');
      result.current.setPassword('password123');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(result.current.errors.form).toBeDefined();
  });

  it('should handle network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error')),
    );

    const { result } = renderHook(() => useLoginForm());

    act(() => {
      result.current.setUsername('testuser');
      result.current.setPassword('password123');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(result.current.errors.form).toBe('Network error');
  });

  it('should call preventDefault on form event', async () => {
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useLoginForm());

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault,
      } as unknown as React.FormEvent);
    });

    expect(preventDefault).toHaveBeenCalled();
  });

  it('should clear errors', async () => {
    const { result } = renderHook(() => useLoginForm());

    // Trigger validation errors
    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(Object.keys(result.current.errors).length).toBeGreaterThan(0);

    act(() => {
      result.current.clearErrors();
    });

    expect(result.current.errors).toEqual({});
  });

  it('should validate whitespace-only username', async () => {
    const { result } = renderHook(() => useLoginForm());

    act(() => {
      result.current.setUsername('   ');
      result.current.setPassword('password123');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });

    expect(result.current.errors.username).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
