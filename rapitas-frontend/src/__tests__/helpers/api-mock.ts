/**
 * api-mock
 *
 * Shared mock builder for the @/utils/api module.
 * Centralises the API_BASE_URL value used across test files.
 */

/**
 * Builds a mock for the `@/utils/api` module.
 *
 * Default URL matches the majority pattern observed across the test suite.
 * Pass an explicit URL when a test requires a different base (e.g. 'http://test').
 *
 * @param url - The API base URL to expose as API_BASE_URL. Defaults to 'http://test:3001'.
 * @returns Module mock compatible with `vi.mock('@/utils/api', () => buildApiMock())`
 */
export function buildApiMock(url = 'http://test:3001') {
  return { API_BASE_URL: url };
}
