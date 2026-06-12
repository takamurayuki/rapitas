// NOTE: Sets NODE_ENV=test so logger.ts disables the file sink during test runs.
// Bun 1.3.13 on Windows does not set NODE_ENV automatically for bun test.
process.env.NODE_ENV = 'test';
