# What running it once found

Three defects shipped through full test suites, code review and a merge, and
were found within minutes of putting one real task through the pipeline. They
are collected here because they share a property no amount of reading would
have surfaced: **every part was correct and the seams were not.**

The run: ContextFlow's auto-run, three `[UI]` screen tasks, 2026-10-17.

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

## What this run did NOT establish

Recorded so a later reader does not over-credit it:

- **The gate was never seen to fail in anger.** `requireEntries` passed both
  tasks that reached it, because both registered. That it blocks a task that
  did not register is covered by unit tests only.
- **The prediction that `[UI] ログイン` would fail was never tested.** It was
  interrupted before reaching verify under the old rule, and by the time it
  ran, the fix was live — and the agent had registered an entry regardless, so
  it might well have passed either way. The asymmetry in the table above is
  measured; the harm it would have caused is not.
