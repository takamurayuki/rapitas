/**
 * Windows でランチャーが起動した子と、所有を確認できる子孫の優先度を下げる。
 * 子の起動は待たせず、PowerShell での列挙は一度に1件だけ実行する。
 */
import { execFile } from 'child_process';
import { createLogger } from '../../config/logger';

const log = createLogger('agents:windows-process-priority');
const APPLY_TIMEOUT_MS = 10_000;
// 次の列挙にまとめる要求には、先行する補助プロセス1件分の待ち時間を許す。
const MAX_REQUEST_AGE_MS = 2 * APPLY_TIMEOUT_MS;
// PowerShell に渡す単一の環境変数を Windows の長さ上限以内に保つ。
const MAX_BATCH_SIZE = 128;
const REQUEST_ENV = 'RAPITAS_WINDOWS_PRIORITY_REQUESTS';
// カーネルの作成時刻は Date.now() より最大1クロック刻み古く観測され得る。
const CREATION_CLOCK_TICK_MS = 16;

export interface WindowsPriorityRequest {
  pid: number;
  parentPid: number;
  startedAt: number;
  returnedAt: number;
}

// CIM の CreationDate はマイクロ秒精度。Process のハンドルを開いてから
// StartTime を照合し、同じハンドルを保持したまま PriorityClass を設定する。
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$requests = ConvertFrom-Json $env:RAPITAS_WINDOWS_PRIORITY_REQUESTS
$byPid = @{}
$byParent = @{}
foreach ($row in (Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate)) {
  if ($null -eq $row.CreationDate) { continue }
  $id = [int]$row.ProcessId
  $parent = [int]$row.ParentProcessId
  $byPid[$id] = $row
  if (!$byParent.ContainsKey($parent)) {
    $byParent[$parent] = [System.Collections.Generic.List[object]]::new()
  }
  $byParent[$parent].Add($row)
}

function Set-OwnedTree($row, $ownerPid) {
  $id = [int]$row.ProcessId
  if ($id -eq $ownerPid -or $id -le 0) { return }
  $birth = $row.CreationDate.ToUniversalTime().Ticks
  $proc = $null
  try {
    $proc = Get-Process -Id $id -ErrorAction Stop
    $null = $proc.Handle
    if ($proc.HasExited -or [Math]::Abs($proc.StartTime.ToUniversalTime().Ticks - $birth) -gt 9) {
      Write-Output "skip $($id): process ended or identity changed"
      return
    }
    try {
      $proc.PriorityClass = [Diagnostics.ProcessPriorityClass]::BelowNormal
    } catch {
      Write-Output "skip $($id): priority change failed ($($_.Exception.Message))"
    }
    foreach ($child in $byParent[$id]) {
      if ([int]$child.ProcessId -ne $id -and $child.CreationDate.ToUniversalTime().Ticks -ge $birth) {
        Set-OwnedTree $child $ownerPid
      }
    }
  } catch {
    Write-Output "skip $($id): process unavailable ($($_.Exception.Message))"
  } finally {
    if ($null -ne $proc) { $proc.Dispose() }
  }
}

foreach ($request in $requests) {
  $id = [int]$request.pid
  $root = $byPid[$id]
  $earliest = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$request.startedAt - ${CREATION_CLOCK_TICK_MS}).UtcDateTime.Ticks
  $latest = [DateTimeOffset]::FromUnixTimeMilliseconds(1 + [long]$request.returnedAt).UtcDateTime.Ticks
  if ($null -eq $root -or [int]$root.ParentProcessId -ne $request.parentPid) {
    Write-Output "skip $($id): child absent or parent changed"
    continue
  }
  $birth = $root.CreationDate.ToUniversalTime().Ticks
  if ($birth -lt $earliest -or $birth -ge $latest) {
    Write-Output "skip $($id): creation time outside launch window (ticks from start=$($birth - $earliest), ticks from return=$($birth - $latest))"
    continue
  }
  Set-OwnedTree $root $request.parentPid
}
`;
const ENCODED_SCRIPT = Buffer.from(SCRIPT, 'utf16le').toString('base64');

/** PowerShell の起動を直列化する。引数の差し替えは試験用。 */
export function createWindowsPriorityQueue(run: typeof execFile = execFile, now = Date.now) {
  const pending: WindowsPriorityRequest[] = [];
  let busy = false;

  function drain(): void {
    const current = now();
    const requests = pending.splice(0, MAX_BATCH_SIZE).filter((request) => {
      if (current - request.returnedAt <= MAX_REQUEST_AGE_MS) return true;
      log.debug({ pid: request.pid }, 'Windows 優先度の適用要求が期限切れ');
      return false;
    });
    if (requests.length === 0) {
      advance();
      return;
    }
    try {
      run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SCRIPT],
        {
          env: { ...process.env, [REQUEST_ENV]: JSON.stringify(requests) },
          windowsHide: true,
          timeout: APPLY_TIMEOUT_MS,
          maxBuffer: 256 * 1024,
        },
        (err, stdout) => {
          if (err || stdout.trim()) log.debug({ err, stdout }, 'Windows 優先度の適用結果');
          advance();
        },
      );
    } catch (err) {
      log.debug({ err }, 'Windows 優先度の補助プロセスを起動できなかった');
      advance();
    }
  }

  function advance(): void {
    busy = pending.length > 0;
    if (busy) queueMicrotask(drain);
  }

  return (request: WindowsPriorityRequest): void => {
    if (request.pid <= 0 || request.pid === request.parentPid) return;
    pending.push(request);
    if (!busy) advance();
  };
}

export const queueWindowsPriority = createWindowsPriorityQueue();
