/**
 * StatusIcon
 *
 * Maps a GitHub Actions status/conclusion pair to its icon: spinner while
 * running, check-in-circle on success, x-in-circle on failure. Used at the
 * run, job, and step levels — size is controlled via `className`.
 */
import { CheckCircle2, XCircle, Loader2, Clock, MinusCircle, CircleDot } from 'lucide-react';

interface StatusIconProps {
  /** Run/job/step status: queued | in_progress | completed. / 実行状態 */
  status: string;
  /** Final conclusion when completed: success | failure | cancelled | ... / 完了時の結果 */
  conclusion: string | null;
  /** Tailwind size/utility classes; defaults to `h-4 w-4`. / サイズ等のクラス */
  className?: string;
}

/**
 * Render the status icon for a run, job, or step.
 *
 * @param props - status / conclusion / optional className / 状態・結果・クラス
 * @returns The matching lucide icon / 対応するアイコン
 */
export function StatusIcon({ status, conclusion, className = 'h-4 w-4' }: StatusIconProps) {
  if (status !== 'completed') {
    return status === 'queued' ? (
      <Clock className={`${className} text-zinc-400`} />
    ) : (
      <Loader2 className={`${className} animate-spin text-amber-500`} />
    );
  }
  switch (conclusion) {
    case 'success':
      return <CheckCircle2 className={`${className} text-emerald-500`} />;
    case 'failure':
      return <XCircle className={`${className} text-red-500`} />;
    case 'cancelled':
      return <MinusCircle className={`${className} text-zinc-400`} />;
    default:
      return <CircleDot className={`${className} text-zinc-400`} />;
  }
}
