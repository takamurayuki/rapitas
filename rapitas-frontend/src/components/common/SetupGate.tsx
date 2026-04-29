'use client';
/**
 * SetupGate
 *
 * On first launch (or after a wipe of localStorage), checks whether the
 * environment is usable. If the database is unreachable or no AI provider
 * is available, redirects to /setup so the user sees what's missing instead
 * of staring at a broken home screen.
 *
 * Idempotent: once `rapitas:setup-completed=true` is stored, the gate
 * short-circuits without hitting the backend.
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { API_BASE_URL } from '@/utils/api';

const FLAG_KEY = 'rapitas:setup-completed';
const SKIP_PATHS = ['/setup', '/auth'];

export default function SetupGate() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!pathname) return;
    if (SKIP_PATHS.some((p) => pathname.startsWith(p))) return;

    let stored = false;
    try {
      stored = localStorage.getItem(FLAG_KEY) === 'true';
    } catch {
      /* ignore — fall through to status check */
    }
    if (stored) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/system/setup/status`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { setupComplete?: boolean };
        if (data.setupComplete) {
          try {
            localStorage.setItem(FLAG_KEY, 'true');
          } catch {
            /* ignore */
          }
        } else {
          router.replace('/setup');
        }
      } catch {
        // Network error: leave the user where they are; the dedicated
        // backend-error banner already handles this case.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
