'use client';

import { installApiCredentials } from '@/lib/api-credentials';

// NOTE: Installed at module scope, not in a useEffect. An effect runs after
// the first render, and requests fired during that render would still go out
// without the session cookie — read unscoped, and populate caches with another
// workspace's rows. Module evaluation happens before any component body. It is
// a no-op during SSR (no `window`) and idempotent.
installApiCredentials();

/**
 * ApiCredentialsInitializer
 *
 * Mount once, as early as possible: it makes requests to this app's own
 * backend carry the session cookie. Renders nothing.
 */
export default function ApiCredentialsInitializer() {
  return null;
}
