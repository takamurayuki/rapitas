# What running it once found

Five defects shipped through full test suites, code review and a merge, and
were found within minutes of putting a real project through the pipeline. They
are collected here because they share a property no amount of reading would
have surfaced: **every part was correct and the seams were not.**

Two runs so far:

- ContextFlow's auto-run, three `[UI]` screen tasks, 2026-10-17 — three
  defects, below.
- batontime from scratch, 2026-10-18 — two more, in [the second
  run](#a-second-run-batontime-2026-10-18). It never reached a screen task.

---

## Two correct modules, one broken seam

`toScreenTaskPayload` asks a screen task to register `featureEntries` **only
when the screen hosts features** — a screen no `画面導線` line names is told,
in as many words, that none do. `applyFeatureReachability` demanded an entry
from **every** `[UI]` task.

Both were right on their own. Both had tests. Both had the reasoning written
into their doc comments, and the second one's rationale explicitly set out to
avoid this exact failure for other task kinds:

> A blanket rule would fail the environment task — which runs before any
> screen exists — and every feature task for work its screen task owed. The
> failure would land on changes that could not have fixed it.

It fixed that for other task kinds and reintroduced it inside `[UI]`.

Measured the moment a real task arrived — counting mentions of the field
across each task's description, goals and criteria against the rule each
would be verified under:

| Task                | Hosts      | Asked to register | Verified with `requireEntries` |
| ------------------- | ---------- | ----------------- | ------------------------------ |
| `[UI] ログイン`     | nothing    | **0 mentions**    | **true**                       |
| `[UI] ソース管理`   | F-01, F-02 | 3 mentions        | true                           |
| `[UI] パターン一覧` | F-03       | 3 mentions        | true                           |

**The check that would have caught it:** for any pair of modules where one
imposes an obligation and the other enforces it, write down the condition each
uses and compare them. Here one keyed on "does this screen host features" and
the other on "is this a screen task". Unit tests cannot see that, because each
is correct against its own condition.

Fixed in #1032 by making the enforcement read the obligation from the task
itself, so there is one condition rather than two.

## A cap that counted what could never be consumed

The per-theme backlog cap counted every unstarted task, including those
`autoRunExcluded` — which auto-run never selects. One project's six unstarted
tasks were all excluded, so its headroom was permanently zero. Once screens
gated features it could file nothing at all, for ever.

Invisible until screens became a prerequisite: before that, a full cap only
meant features filed more slowly.

**The check:** a limit justified by throughput must count only what flows.

Fixed in #1020.

## A self-restart that had never fired

Eight careful gates, the last being "HEAD actually moved" — with nothing in
the system fetching the checkout. Eight merges landed in one session while the
backend stayed on the commit it booted with.

**The check:** for any "has X changed" gate, confirm something changes X.

Fixed in #1024. See
[dev-loop-hazards.md](dev-loop-hazards.md#merged-code-is-not-running-code).

---

## The positive finding: the instruction's format becomes the artifact's

The same run produced clean evidence that writing the expected shape **into
the task** is what produces that shape.

`[UI] ログイン` hosts no feature, so its task mentioned `featureEntries` zero
times. The agent registered one anyway — inferring the obligation from its
reachability criterion — in a shape it invented:

```json
{ "id": "login", "file": "apps/web/src/app/login/page.tsx", "path": "/login" }
```

`id` is a screen name, not a feature id, and there is no `marker`. The reader
ignores the extra keys and the check passes, so nothing complains — and the
entry does not correspond to any feature.

`[UI] ソース管理` hosts F-01 and F-02, so its task spelled the shape out. Its
research phase mentioned `featureEntries` **14 times** before any code was
written, and the result was exactly the requested shape:

```json
{ "id": "F-01", "file": "apps/web/src/app/sources/page.tsx", "marker": "source-connect-slack" }
```

It also appended rather than replacing, as its constraint asked, and added a
test asserting each registered marker exists in the screen.

**The rule:** when a task must produce a specific artifact shape, put the
shape in the task. An agent will satisfy a goal it can see; left to infer the
mechanism, it invents one that passes the check without meaning what the check
assumes it means.

## How the three tasks ended

All three reached `done/completed`. The registered entries, in the order the
tasks appended them:

```
login  apps/web/src/app/login/page.tsx      (no marker)   ← the uninstructed one
F-01   apps/web/src/app/sources/page.tsx    source-connect-slack
F-02   apps/web/src/app/sources/page.tsx    source-mask-result
F-09   apps/web/src/app/sources/page.tsx    source-connect-gmail
F-10   apps/web/src/app/sources/page.tsx    source-connect-drive
F-03   apps/web/src/app/patterns/page.tsx   pattern-list
```

Three things worth keeping from that shape:

- **The append constraint held three times running.** No task removed another
  task's entry, which is the failure mode a shared config file invites.
- **Every instructed task produced `F-NN` plus a marker.** The one drifting
  row is the one that was asked for nothing — the same contrast as above, now
  with a third data point.
- **Two entries were volunteered.** `[UI] ソース管理` registered F-09 and F-10
  as well as the F-01 and F-02 it was told about, because it built those
  inputs while building the screen. The requirements document's flow section
  never mentions them, so the implementation is now ahead of the document —
  worth knowing before reading the registered set as a statement of intent.

A `[UI]` task also added a link from the root page to the screen it built,
satisfying "reachable from a running app" by connecting the route rather than
by declaring it. That is the behaviour whose absence produced the original
failure.

## A gate behaving correctly, for contrast

Immediately after the run, the conditions for the self-deploy (#1024) were
met except one: the backend was mid-execution on the next task. It did not
fire, and `activeExecutions: 1` is why. In a document full of gates that pass
without checking, a gate that declines to act while work is in flight is the
shape to aim for — it refuses on a condition that is actually measured.

Its other half — firing at a genuine quiet point — remains covered by unit
tests only, because the project kept finding work.

---

## A second run: batontime, 2026-10-18

A brand-new project, started to measure the chain rather than to fix anything
in particular. It never reached a screen task. Both findings are in the first
task the chain files, and both were invisible to that task's own tests.

### A criterion no one could satisfy

`project-bootstrap-task.ts` emitted a constraint and an acceptance criterion
that contradict each other, in the same payload:

| Field      | Text                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| constraint | worktree 内で依存インストールを行う場合…禁止される。その場合はプロジェクトルートで用意する |
| criterion  | 依存インストールのコマンドが exit 0 で完了したことが verify.md に記録されている            |

The implementer runs in a worktree, so the constraint always fires. It raised
a question and stopped — correctly; recording an exit code it never measured
would have been a lie. And because `requirement-intake-job.ts` returns
`environment_pending` and files nothing else until the bootstrap task
finishes, one unsatisfiable criterion froze the entire project.

Measured, and this is the part reading would not have given: the escape hatch
the constraint points at is also closed. `pnpm install --lockfile-only` in the
generated project's **own root** — not a worktree — is refused by the install
guard with "this checkout shares node_modules with its project root through a
link". No agent can satisfy that criterion anywhere.

**The check:** for each acceptance criterion, name the command that produces
its evidence and the directory it runs in. If that command is one the agent is
forbidden to run, or one only a human can run, the criterion will never go
green — the verifier will report "unverified" and the integrity gate will
bounce it for ever. This is the mirror image of a gate that cannot fail, and
it is just as quiet: a task stuck in `awaiting_question` looks like a task
making progress.

### A criterion a copy satisfies

Unable to install, the implementer copied `node_modules/.pnpm/lock.yaml` to
`pnpm-lock.yaml` and said so plainly. The criterion asked only that a lockfile
「が差分に含まれている」, and nothing compared it against the manifest — so a
copied, stale or unrelated lockfile passes.

This is [gates-that-do-not-measure.md](gates-that-do-not-measure.md) arriving
as an acceptance criterion rather than as CI: the artifact's **presence** was
checked and its **correspondence** was not.

**The check:** when a criterion names an artifact, ask what else would satisfy
it. If an empty file, a copy, or last month's version passes, the criterion is
about presence and needs a correspondence clause.

Both fixed in #1050; the affected task's stored criteria were edited to the
reachable form and the task resumed.

---

## What the first run did NOT establish

Recorded so a later reader does not over-credit it:

- **The gate was never seen to fail in anger.** `requireEntries` passed every
  task that reached it, because every instructed one registered. That it
  blocks a task that did not register is covered by unit tests only.
- **The prediction that `[UI] ログイン` would fail was never tested.** It was
  interrupted before reaching verify under the old rule, and by the time it
  ran, the fix was live — and the agent had registered an entry regardless, so
  it might well have passed either way. The asymmetry in the table above is
  measured; the harm it would have caused is not.
