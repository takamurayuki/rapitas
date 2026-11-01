# Lessons

Failures worth not repeating, grouped by the shape that caused them rather
than by the day they happened. Chronologies age badly; shapes recur.

This is not the [runbook](../RUNBOOK.md). The runbook answers "the build is
broken, what do I do" — symptom, diagnosis, fix. These pages answer "why did
nothing tell us", and each entry ends in a check that would have caught it.

| Page                                                         | What it covers                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [gates-that-do-not-measure.md](gates-that-do-not-measure.md) | Checks that run, report green, and are not measuring the thing they are named after   |
| [running-it-once.md](running-it-once.md)                     | Five defects that survived full test suites and died within minutes of a real run     |
| [measurement-discipline.md](measurement-discipline.md)       | Numbers reported before they were measured, and how each was wrong                    |
| [dev-loop-hazards.md](dev-loop-hazards.md)                   | Environment traps: stale primary checkout, shell encoding, PowerShell, route prefixes |

---

## The one pattern behind most of it

Nine separate gates were found inert in a single session on 2026-10-17: a
required check naming jobs that do not exist, an audit scoring a tree nobody
ships, overrides where only the first selector applies, test files that stop
silently, a validator nothing calls, a reader with no writer, a counter
counting what can never be consumed, a change detector with no change source,
and a scenario harness that fails at setup and calls it a scenario failure.

They share one property: **the green result suppressed the search**. None of
them was hard to find once looked at. What kept them hidden was that
everything appeared to be working.

Three questions, answered with evidence rather than by reading the code,
would have caught nearly all of them:

1. **Does it run?** Find the call sites, or the job names the workflows emit.
2. **Does it read what ships?** The committed lockfile, the authoritative
   branch, the built artifact.
3. **Can it fail?** Break the thing it exists to catch and watch it go red.

The third is the one that gets skipped, and the one that would have paid for
itself fastest.

There is a fourth that only applies once a pipeline has more than one stage:
**run one real thing through it end to end.** Five further defects were found
that way, each of which had passed its own tests, because each was correct and
only the seams between them were not — [running-it-once.md](running-it-once.md).

A fifth belongs to anything that hands work to an agent: **name the command
that produces each acceptance criterion's evidence, and the directory it runs
in.** A criterion whose command the agent is forbidden to run never goes
green, and a task parked on that question looks exactly like a task making
progress.

## How to add to these pages

Add an entry when a failure was invisible, not merely annoying. The test is
whether someone could hit it again without noticing — if the failure announced
itself loudly, the runbook is the right home.

Each entry should carry the measurement that exposed it. "Be careful about X"
prevents nothing; the command that shows X is wrong prevents it again.
