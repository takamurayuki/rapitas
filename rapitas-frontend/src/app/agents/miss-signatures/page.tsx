/**
 * MissSignaturesPage
 *
 * Route entry for /agents/miss-signatures — the review UI for detection-miss
 * signature suggestions. All state and API wiring live in the client
 * component; this file only mounts it.
 */
import { MissSignaturesClient } from './_components/MissSignaturesClient';

export default function MissSignaturesPage() {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <MissSignaturesClient />
    </div>
  );
}
