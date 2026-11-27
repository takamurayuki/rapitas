/**
 * 共通ランチャーで起動した実プロセスとシェルの孫が、期限内に低優先度へ到達することを確認する。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import os from 'node:os';
import { execFile, type ExecFileOptions } from 'child_process';
import { spawnLowPriority, execFileLowPriority, LOW_PRIORITY } from './process-priority';
import { createWindowsPriorityQueue } from './windows-process-priority';

const SELF = process.pid;
const WINDOWS = process.platform === 'win32';
let originalPriority = 0;
let previousFlag: string | undefined;

beforeAll(() => {
  previousFlag = process.env.RAPITAS_VERIFY_QUIET;
  delete process.env.RAPITAS_VERIFY_QUIET;
  originalPriority = os.getPriority(SELF);
  if (WINDOWS) os.setPriority(SELF, 0);
});

afterAll(() => {
  if (WINDOWS) os.setPriority(SELF, originalPriority);
  if (previousFlag === undefined) delete process.env.RAPITAS_VERIFY_QUIET;
  else process.env.RAPITAS_VERIFY_QUIET = previousFlag;
});

function probe(watchedParent: boolean, expected: number): string {
  return `const os = require('node:os');
    const deadline = Date.now() + 12000;
    const parent = ${watchedParent};
    const timer = setInterval(() => {
      const childNice = os.getPriority();
      const parentNice = parent ? os.getPriority(process.ppid) : null;
      if ((childNice !== ${expected} || (parent && parentNice !== ${expected})) && Date.now() < deadline) return;
      console.log(JSON.stringify({ childNice, parentNice, pid: process.pid, parentPid: process.ppid }));
      clearInterval(timer);
    }, 40);`.replace(/\s+/g, ' ');
}

interface Observation {
  childNice: number;
  parentNice: number | null;
  pid: number;
  parentPid: number;
}

function runSpawn(command: string, args: string[], shell: boolean): Promise<Observation> {
  return new Promise((resolve, reject) => {
    const child = spawnLowPriority(
      command,
      args,
      { shell, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      'RAPITAS_VERIFY_QUIET',
      { platform: process.platform },
    );
    let out = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        if (code !== 0) throw new Error(`優先度の観測プロセスが終了 (${code}): ${stderr}`);
        resolve(JSON.parse(out) as Observation);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function expectedChild(parent: number): number {
  return WINDOWS ? LOW_PRIORITY : Math.min(19, parent + LOW_PRIORITY);
}

describe('実プロセスの優先度', () => {
  test('直接起動した子は期限内に低優先度へ到達する', async () => {
    const parent = os.getPriority(SELF);
    const expected = expectedChild(parent);
    const observation = await runSpawn(process.execPath, ['-e', probe(false, expected)], false);
    console.log('直接起動の観測', observation);
    expect(observation.childNice).toBe(expected);
    expect(os.getPriority(SELF)).toBe(parent);
  }, 17_000);

  test('シェルとその孫が期限内に低優先度へ到達する', async () => {
    const parent = os.getPriority(SELF);
    const expected = expectedChild(parent);
    const code = probe(true, expected);
    // POSIX のシェルが末尾コマンドを自分自身に置き換えないよう後続処理を残す。
    const suffix = WINDOWS ? '' : '; exit $?';
    const observation = await runSpawn(`"${process.execPath}" -e "${code}"${suffix}`, [], true);
    console.log('シェルと孫の観測', observation);
    expect(observation.parentPid).not.toBe(SELF);
    expect(observation.parentNice).toBe(expected);
    expect(observation.childNice).toBe(expected);
    expect(os.getPriority(SELF)).toBe(parent);
  }, 17_000);

  test('execFile の子も期限内に低優先度へ到達する', async () => {
    const parent = os.getPriority(SELF);
    const expected = expectedChild(parent);
    const res = await execFileLowPriority(
      process.execPath,
      ['-e', probe(false, expected)],
      { windowsHide: true },
      'RAPITAS_VERIFY_QUIET',
      { platform: process.platform },
    );
    const observation = JSON.parse(res.stdout) as Observation;
    console.log('execFile の観測', observation);
    expect(observation.childNice).toBe(expected);
    expect(os.getPriority(SELF)).toBe(parent);
  }, 17_000);

  test('優先度フラグの無効時は子の優先度を変えない', async () => {
    const parent = os.getPriority(SELF);
    process.env.RAPITAS_VERIFY_QUIET = 'off';
    try {
      const observation = await runSpawn(process.execPath, ['-e', probe(false, parent)], false);
      expect(observation.childNice).toBe(parent);
    } finally {
      delete process.env.RAPITAS_VERIFY_QUIET;
    }
  }, 17_000);
});

test.skipIf(!WINDOWS)(
  'Windows のツリー適用は親と再利用 PID を対象から外し、所有する子孫を順に降格する',
  async () => {
    const fixture = String.raw`
$birth = [DateTimeOffset]::FromUnixTimeMilliseconds(1000).UtcDateTime
function New-Row($id, $parent, $created) {
  [pscustomobject]@{ ProcessId = $id; ParentProcessId = $parent; CreationDate = $created }
}
$rows = @(
  (New-Row 80 81 $birth),
  (New-Row 81 80 $birth),
  (New-Row 82 81 $birth.AddTicks(10)),
  (New-Row 83 82 $birth.AddTicks(20)),
  (New-Row 84 81 $birth.AddTicks(30)),
  (New-Row 85 81 $birth.AddTicks(-10)),
  (New-Row 86 80 $birth.AddMilliseconds(-17)),
  (New-Row 87 99 $birth),
  (New-Row 88 81 $birth.AddTicks(40)),
  (New-Row 89 81 $birth.AddTicks(50)),
  (New-Row 90 80 $birth.AddMilliseconds(-8)),
  (New-Row 91 80 $birth.AddMilliseconds(18))
)
function Get-CimInstance { $rows }
function Get-Process {
  param([int]$Id)
  if ($Id -eq 88) { throw 'access denied' }
  $sample = ($rows | Where-Object { $_.ProcessId -eq $Id }).CreationDate
  if ($Id -eq 84) { $sample = $sample.AddTicks(100000) }
  $p = [pscustomobject]@{ Id = $Id; Birth = $sample.AddTicks(8); Opened = $false; HasExited = ($Id -eq 89) }
  Add-Member -InputObject $p -MemberType ScriptProperty -Name Handle -Value { $this.Opened = $true; 1 }
  Add-Member -InputObject $p -MemberType ScriptProperty -Name StartTime -Value {
    if (!$this.Opened) { throw 'handle was not opened' }
    $this.Birth
  }
  Add-Member -InputObject $p -MemberType ScriptProperty -Name PriorityClass -Value { $null } -SecondValue {
    [Console]::WriteLine("set $($this.Id) $args")
  }
  Add-Member -InputObject $p -MemberType ScriptMethod -Name Dispose -Value {}
  $p
}
`;
    const stdout = await new Promise<string>((resolve, reject) => {
      const run = (
        file: string,
        args: string[],
        options: ExecFileOptions,
        done: (err: Error | null, output: string) => void,
      ) => {
        const encoded = args.at(-1)!;
        const script = Buffer.from(encoded, 'base64').toString('utf16le');
        const input = Buffer.from(fixture + script, 'utf16le').toString('base64');
        return execFile(file, [...args.slice(0, -1), input], options, (err, output) => {
          const text = String(output);
          done(err, text);
          if (err) reject(err);
          else resolve(text);
        });
      };
      const queue = createWindowsPriorityQueue(run as typeof execFile, () => 1001);
      for (const pid of [80, 81, 86, 87, 90, 91]) {
        queue({ pid, parentPid: 80, startedAt: 1000, returnedAt: 1001 });
      }
    });
    expect(stdout.match(/set \d+ BelowNormal/g)).toEqual([
      'set 81 BelowNormal',
      'set 82 BelowNormal',
      'set 83 BelowNormal',
      'set 90 BelowNormal',
    ]);
    expect(stdout).toContain('skip 84: process ended or identity changed');
    expect(stdout).toContain('skip 86: creation time outside launch window');
    expect(stdout).toContain('skip 87: child absent or parent changed');
    expect(stdout).toContain('skip 88: process unavailable');
    expect(stdout).toContain('skip 89: process ended or identity changed');
    expect(stdout).toContain('skip 91: creation time outside launch window');
  },
  15_000,
);
