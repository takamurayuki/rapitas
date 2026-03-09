describe('createLogger', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates a logger with the given name prefix', async () => {
    // In test env (not production), default level is "debug", so all levels should log
    process.env.NODE_ENV = 'test';
    delete process.env.NEXT_PUBLIC_LOG_LEVEL;

    // Re-import to pick up env changes
    vi.resetModules();
    const { createLogger } = await import('../logger');

    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger('TestModule');
    logger.info('hello');

    expect(spy).toHaveBeenCalledWith('[TestModule]', 'hello');
  });

  it('logs debug messages when level is debug', async () => {
    process.env.NEXT_PUBLIC_LOG_LEVEL = 'debug';
    vi.resetModules();
    const { createLogger } = await import('../logger');

    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logger = createLogger('App');
    logger.debug('debug msg');

    expect(spy).toHaveBeenCalledWith('[App]', 'debug msg');
  });

  it('suppresses debug when level is info', async () => {
    process.env.NEXT_PUBLIC_LOG_LEVEL = 'info';
    vi.resetModules();
    const { createLogger } = await import('../logger');

    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logger = createLogger('App');
    logger.debug('should not appear');

    expect(spy).not.toHaveBeenCalled();
  });

  it('logs warn and error when level is warn', async () => {
    process.env.NEXT_PUBLIC_LOG_LEVEL = 'warn';
    vi.resetModules();
    const { createLogger } = await import('../logger');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const logger = createLogger('App');
    logger.info('no');
    logger.warn('yes');
    logger.error('yes');

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[App]', 'yes');
    expect(errorSpy).toHaveBeenCalledWith('[App]', 'yes');
  });

  it('suppresses all output when level is silent', async () => {
    process.env.NEXT_PUBLIC_LOG_LEVEL = 'silent';
    vi.resetModules();
    const { createLogger } = await import('../logger');

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createLogger('App');
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('passes multiple arguments to console methods', async () => {
    process.env.NEXT_PUBLIC_LOG_LEVEL = 'debug';
    vi.resetModules();
    const { createLogger } = await import('../logger');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('Err');
    const errObj = new Error('fail');
    logger.error('something failed', errObj, 42);

    expect(spy).toHaveBeenCalledWith('[Err]', 'something failed', errObj, 42);
  });
});
