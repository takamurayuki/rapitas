# Gates that do not measure what their name claims

A gate exists, runs, reports green, and is not checking the thing it is named
after. It is the most expensive failure shape in this repository, because the
green result actively suppresses the search for the problem.

Nine instances were found in a single session on 2026-10-17. They are listed
with the measurement that exposed each one, because "we should check more
carefully" prevents nothing — the specific check does.

---

## The three questions

Before trusting any gate, answer all three with evidence, not with reading:

1. **Does it run?** Find the call sites. A validator imported by nothing, or a
   required check whose job name no workflow emits, is decoration.
2. **Does it read what ships?** The committed lockfile, the authoritative
   branch, the built artifact — not a freshly resolved tree, not the local
   working copy.
3. **Can it fail?** Construct the exact failure the gate exists to catch and
   watch it go red.

The third is the strongest and the most often skipped. Most of what follows
would have been caught in minutes by deliberately breaking the thing and
checking that the gate noticed.

---

## 1. Required checks naming jobs that do not exist

`main`'s branch protection required four status contexts that no workflow
produced. Every pull request sat at `BLOCKED` for ever, so the only way to
merge was `--admin` — which skips the checks entirely. The protection looked
strict and verified nothing.

**Catch it:** compare the set of required contexts against the set of job
names the workflows actually emit.

```bash
gh api repos/<owner>/<repo>/branches/main/protection/required_status_checks --jq '.contexts[]' | sort -u > /tmp/required
gh pr checks <any-recent-pr> --json name --jq '.[].name' | sort -u > /tmp/emitted
comm -23 /tmp/required /tmp/emitted   # required but never reported
```

A required context that never reports is worse than no gate, because it also
trains everyone to reach for `--admin`.

## 2. An audit that scored a tree nobody ships

The Rust security job ran `cargo update` before `cargo audit`. It audited the
freshly resolved dependency graph, not the committed `Cargo.lock`, so five
vulnerable packages that actually shipped were invisible. The job was green
throughout.

Measured: 587 crates in the lockfile versus 607 after the update step — the
audit was scoring a different program.

**Catch it:** a security job must read the committed lockfile. Diff the crate
count, or the resolved versions, between what the job sees and what the repo
holds.

Nine hours after the step was removed, the same job caught a real critical
(`RUSTSEC-2026-0369`, CVSS 9.1) that Trivy — reading the same `Cargo.lock` —
did not report.

## 3. first-match-wins overrides

`pnpm` applies only the **first** matching selector per package in
`overrides`. Seven stacked `dompurify@...` selectors meant exactly one was
live; the other six were silently dead, and four packages' vulnerability
floors with them.

**Catch it:** verify the resolved version in the lockfile, never in the
config that requests it.

```bash
grep -oE "^  /?<package>@[0-9][^(:]*" pnpm-lock.yaml | sort -u
```

See also [measurement-discipline.md](measurement-discipline.md) for the
related failure of writing a selector that does not cover the whole
vulnerable range.

## 4. `mock.module` omitting an export stops the whole file

Bun's `mock.module` replaces the **entire** module. An export left out of the
mock makes every import of that module throw, so the test file dies with one
unhandled error and all of its tests simply stop existing. The suite reports
`1 fail` and a pass count quietly lower than before.

Hit three times in one session: `gh-client.test.ts` (missing `rm`),
`cli-path-resolver.test.ts` (missing `execFile`), and
`runtime-completeness.test.ts` (missing `isScreenTask`, which cost six tests
— 557 pass / 1 fail / 1 error became 564 pass / 0 fail once mirrored).

**Catch it:** when adding an export to a module, grep for mocks of it.

```bash
grep -rn "mock.module\(.*<module-path>" --include=*.test.ts .
```

**And watch the pass COUNT, not just pass/fail.** A suite that drops from 564
to 557 passes while still reporting "0 fail" is a suite that stopped running
things.

## 5. The checker nobody called

`checkSpecConsistency` knew whether a generated specification could be
implemented — every feature's acceptance criteria, a concrete screen route
per feature, covered input sources. It was wired into the generation wizard's
review round and **into nothing else**. The job that actually files
implementation tasks never ran it, so a document that failed the check still
produced a full backlog.

**Catch it:** a validator's value lives at its call sites. Before trusting
one, grep for them, and confirm the caller is on the path that matters.

## 6. A reader with no writer

`featureEntries` in `rapitas.runtime.json` drives the runtime-smoke
reachability check. The repository contained a parser for it, a validator for
it, and the verdict-folding that consumes it — and **nothing that ever wrote
one**. With the field absent the check returns `unknown`, and `unknown` passed
the verdict through. The gate had never evaluated anything for any project.

**Catch it:** for any configuration a gate reads, find the code that writes
it. If nothing does, the gate is inert regardless of how good the reader is.

**And justify every "unknown" separately.** Treating "nobody declared this"
and "the file could not be read" as one verdict is what let this hide: the
second genuinely must fail open, the first must not.

## 7. Counting what will never happen

The per-theme backlog cap existed, by its own comment, to keep task filing
"proportional to throughput". It counted every unstarted task — including
those marked `autoRunExcluded`, which auto-run never selects.

Measured: all six of one project's unstarted tasks were excluded, so its
headroom was permanently zero. Once screens gated features, that project
could file nothing at all, for ever, with no exit that did not involve a
human.

**Catch it:** a limit justified by throughput must count only what flows
through. List what the counter includes and ask of each kind: can this ever
be consumed?

## 8. A trigger that could not fire

The backend's self-restart sat behind eight careful gates, the last being
"HEAD actually moved". Nothing fetched the checkout, so HEAD never moved and
the restart had never fired once. Eight merges landed in one session while
the running process stayed on the commit it booted with.

**Catch it:** for any "has X changed since we started" gate, confirm that
something in the system changes X. A change detector with no change source is
permanently false.

## 9. A red job whose workflow concludes success

`Fault Injection E2E` had been failing on every branch for months. Two of its
seven scenarios fail at **setup** — `POST /tasks` returns 500 — so they never
reach the fault they exist to inject. The workflow still concludes `success`,
and the job is not required, so it is red on every pull request and everyone
has learned to ignore it. Two scenarios have been reporting nothing for
months.

**Catch it:** a scenario harness must distinguish a setup failure from the
fault it injects, and report them differently. An advisory job that is
permanently red is how real signals get trained out of people.

Tracked as issue #1000.

---

## The mirror image: failing for something that is not a defect

A gate can also be wrong in the other direction, and it ends in the same
place — people learning to ignore it.

The format check fails on a worktree whose working copy was expanded with
CRLF, because `prettier`'s default `endOfLine=lf` disagrees with it. The
**committed** content is LF and correctly formatted; nothing is wrong with
what ships. Measured on task 1215: nine files reported, run `6b344875`. The
project has no `.gitattributes` pinning `eol=lf`, so any worktree created
under `core.autocrlf=true` reproduces it.

Notable for how it was found: the system filed this against itself as a
concern, which is the behaviour this whole page is asking for.

**Catch it:** a check must read what ships. For anything line-ending or
encoding sensitive, that means the committed bytes, not the working copy —
the same rule as "an audit must read the committed lockfile" above, applied
to a different kind of input.

Tracked as issue #1315.

## Inputs nobody consumes

The same shape appears without a gate. The generation prompt required a
`# 画面一覧` section — screen names, purposes, UI elements, transitions — and
**no backend code read it**. Only `# 機能要件` was parsed into tasks.

The result: a project declared seven screens, filed zero of them as tasks, and
each feature's own design legitimately placed the UI outside its scope. Twelve
features were completed and merged; the shipped application contained two
`.tsx` files and exactly one of the twelve was reachable.

**Catch it:** every section a template demands should have a consumer. Grep
for the section heading; if the only hits are the prompt that asks for it and
a test fixture, nothing reads it.
