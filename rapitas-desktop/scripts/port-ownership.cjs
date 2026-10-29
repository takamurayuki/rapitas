'use strict';
/**
 * port-ownership
 *
 * Decides what dev.js may conclude about whatever already listens on one of
 * rapitas's dev ports, and words the message an operator acts on. Owns only
 * the decision and the wording — it never inspects the system and never kills
 * anything; dev.js supplies the facts and does the acting.
 *
 * Why it exists (2026-10-29): another project's Rails dev server was bound to
 * 127.0.0.1:3000 and ::1:3000 while rapitas's Next dev server held only the
 * wildcard [::]:3000. Windows gives an address-specific bind precedence over
 * a wildcard one, so every loopback request reached the other project and the
 * rapitas window showed its pages. Nothing failed along the way: the identity
 * guard correctly declined to kill a process it judged unrelated, said so in
 * one terse line, and startup continued.
 *
 * NOT a kill decision. `isRapitasOwnedProcess` is known to false-negative on
 * rapitas's OWN orphan from a previous run — a leftover bun.exe is invoked as
 * a bare `bun index.ts` from `~/.bun/bin`, so nothing in it says "rapitas".
 * Treating "not confirmed ours" as "somebody else's" would therefore wedge
 * every cold start after a crash. So the foreign verdict needs POSITIVE
 * evidence: a process rapitas never spawns at all.
 */

/**
 * Process names rapitas actually starts (the frontend's node, the backend's
 * bun, and the local-LLM sidecar). Anything else on one of our ports is some
 * other program, whatever its command line says.
 */
const KNOWN_RAPITAS_PROCESS_NAMES = ['node.exe', 'bun.exe', 'llama-server.exe'];

/**
 * @typedef {object} Occupant
 * @property {number} pid Owning process id / 占有プロセスのPID
 * @property {string|null} [name] Image name, when readable / プロセス名
 * @property {string|null} [commandLine] Full command line, when readable / コマンドライン
 */

/**
 * Whether this occupant is positively somebody else's program.
 *
 * An unreadable name is NOT evidence: Win32_Process returns null for some
 * processes, and guessing there would put a port-conflict message in front of
 * an ordinary restart.
 *
 * @param {Occupant} occupant The listening process / LISTEN しているプロセス
 * @returns {boolean} true when rapitas never starts such a process / rapitas が起動しない種別なら true
 */
function isForeignProgram(occupant) {
  const name = occupant.name;
  if (typeof name !== 'string' || name.trim() === '') return false;
  return !KNOWN_RAPITAS_PROCESS_NAMES.includes(name.toLowerCase());
}

/**
 * Who holds a port, from rapitas's point of view.
 *
 * `reclaimable` covers a mix on purpose: as long as one holder might be ours,
 * killing it can still free the port, so startup must not be given up on.
 * `foreign` means every holder is a program rapitas never starts.
 *
 * @param {object} args
 * @param {Occupant[]} args.occupants Processes LISTENing on the port / LISTEN中のプロセス
 * @param {(pid:number)=>boolean} args.isRapitasOwned Identity predicate / rapitas 由来かの判定
 * @returns {{kind:'free'|'reclaimable'|'foreign', foreign:Occupant[]}} Classification / 判定結果
 */
function classifyOccupancy({ occupants, isRapitasOwned }) {
  if (occupants.length === 0) return { kind: 'free', foreign: [] };
  const foreign = occupants.filter(
    (occupant) => !isRapitasOwned(occupant.pid) && isForeignProgram(occupant),
  );
  return {
    kind: foreign.length === occupants.length ? 'foreign' : 'reclaimable',
    foreign,
  };
}

/**
 * The lines to print when a port is held by another program.
 *
 * States the remedy as well as the fact: during the incident the console said
 * nothing about the other process, so the cause was only findable by reading
 * `Get-NetTCPConnection` by hand.
 *
 * @param {object} args
 * @param {number} args.port The contended port / 競合しているポート
 * @param {Occupant[]} args.foreign Holders that are another program / 他プログラムの占有プロセス
 * @returns {string[]} Lines to log / 出力する行
 */
function describePortConflict({ port, foreign }) {
  const lines = [
    `  ❌ Port ${port} is held by another program, not by rapitas.`,
    '     Starting anyway can serve that program inside the rapitas window',
    "     (2026-10-29: another project's Rails dev server did exactly that).",
  ];
  for (const occupant of foreign) {
    const name = occupant.name ?? 'unknown process';
    // A command line is unreadable for processes owned by another user;
    // printing the raw value there would read as a bug in this message.
    const command = occupant.commandLine ? ` — ${occupant.commandLine}` : '';
    lines.push(`     PID ${occupant.pid}  ${name}${command}`);
  }
  lines.push('     → Stop that process, or move it to another port, then start rapitas again.');
  return lines;
}

module.exports = {
  classifyOccupancy,
  describePortConflict,
  isForeignProgram,
  KNOWN_RAPITAS_PROCESS_NAMES,
};
