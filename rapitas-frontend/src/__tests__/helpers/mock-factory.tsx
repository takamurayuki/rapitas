/**
 * mock-factory
 *
 * Generic self-repairing mock factory for external modules.
 * Stubs every real export automatically using a caller-supplied stub builder.
 * Not responsible for specific stub shapes — callers inject those via makeStub.
 */

/**
 * Builds a complete mock of an external module by stubbing every real export.
 *
 * The self-repairing property comes from enumerating the real module's exports
 * at runtime via importOriginal, so newly-added exports never break tests.
 *
 * @param importOriginal - Vitest's importOriginal callback (supplies the real module)
 * @param makeStub - Factory called per export key; returns the stub value. Receives (key, testId) where testId = overrides[key] ?? key.
 * @param overrides - Key → custom testId string. Unnamed keys fall back to the key name itself.
 * @returns Mocked module object with every export replaced by the stub
 * @throws Propagates any rejection from importOriginal (missing module → immediate failure)
 */
export async function buildModuleMock(
  importOriginal: () => Promise<unknown>,
  makeStub: (key: string, testId: string) => unknown,
  overrides: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const actual = (await importOriginal()) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mocked[key] = makeStub(key, overrides[key] ?? key);
  }

  return mocked;
}
