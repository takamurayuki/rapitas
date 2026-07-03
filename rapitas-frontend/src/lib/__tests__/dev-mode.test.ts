import { isDevHost } from '../dev-mode';

describe('isDevHost', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    // NODE_ENV is technically readonly in the type defs — cast through unknown.
    (process.env as unknown as Record<string, string>).NODE_ENV = originalEnv ?? 'test';
    vi.restoreAllMocks();
  });

  function stubHostname(hostname: string) {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      hostname,
    } as Location);
  }

  it('returns true when NODE_ENV is development', () => {
    (process.env as unknown as Record<string, string>).NODE_ENV = 'development';
    expect(isDevHost()).toBe(true);
  });

  it('returns true for localhost hostname even outside development', () => {
    (process.env as unknown as Record<string, string>).NODE_ENV = 'production';
    stubHostname('localhost');
    expect(isDevHost()).toBe(true);
  });

  it('returns true for 127.0.0.1 hostname', () => {
    (process.env as unknown as Record<string, string>).NODE_ENV = 'production';
    stubHostname('127.0.0.1');
    expect(isDevHost()).toBe(true);
  });

  it('returns true for a *.local hostname', () => {
    (process.env as unknown as Record<string, string>).NODE_ENV = 'production';
    stubHostname('mymachine.local');
    expect(isDevHost()).toBe(true);
  });

  it('returns false for a production hostname', () => {
    (process.env as unknown as Record<string, string>).NODE_ENV = 'production';
    stubHostname('rapitas.example.com');
    expect(isDevHost()).toBe(false);
  });
});
