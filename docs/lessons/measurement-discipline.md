# Measurement discipline

Every entry here is a number that was reported before it was measured, and was
wrong. They are recorded because the correction is cheap and the habit is not:
a confident wrong number costs more than no number, since it stops the search.

---

## Count the thing you are reporting, not a proxy

A CodeQL remediation was predicted to clear "about 20 high alerts". It cleared 32. The prediction counted **files touched**; the thing being reported was
**alerts**, and one file held four.

> Before quoting a number, name its unit and confirm the query returns that
> unit.

## Do not truncate the input you are counting from

The same estimate missed two call sites because the `grep` that found them was
piped through `head -8`. The truncation was invisible in the output that was
then reasoned over.

> `head` / `tail` are for reading. Never count from a truncated stream — and
> if a listing is long enough to want truncating, that is itself the finding.

## State what a change closed after the scan, not before

A fix was reported as closing six alerts. It closed four. The two it did not
close were `js/xss-through-dom` on a Mermaid renderer: the fix
(`securityLevel: 'strict'`) is correct and necessary, but the analyser does
not model it as a sanitiser, so the DOM-text-to-`innerHTML` path stayed
visible.

> A code fix and an alert closing are different events. Report the first when
> it merges; report the second when the scan has run.

## Read the same source the system reads

A dry run predicted that one project would be blocked by the specification
gate. It passed. The dry run read `docs/requirements.md` from the **working
tree**; the backend reads it from `origin/<defaultBranch>`. Two different
documents.

> When predicting a system's behaviour, read its input through the same path
> it does. Working tree, authoritative branch and built artifact are three
> different things.

## A poll without a wait measures nothing

A fire-and-forget job was triggered, then polled eight times for its result —
with no delay between iterations. All eight completed in about three seconds,
long before the job finished, and the conclusion drawn was "zero tasks were
filed". Three had been filed.

> A poll loop needs a wait, and a loop that exits on "no change" needs to have
> given the change time to happen. Check the timestamp on the result against
> the time you started.

## A range selector must cover the whole vulnerable range

A dependency override was written as `postcss-selector-parser@>=7.0.0 <7.1.6`.
The advisory's range was `< 7.1.6`. A transitive `6.0.10` sat outside the
selector and stayed vulnerable, in a lockfile that also contained the patched
`7.1.6` — so a casual check found the fixed version and stopped.

> Copy the advisory's range; do not narrow it by assumption. Then verify in
> the lockfile that **no** resolved version remains inside it — the presence
> of a patched copy proves nothing about the others.

## Honest reporting of what was not verified

Two habits that cost nothing and prevent re-litigation:

- When a prediction turns out wrong, say so plainly with the number, and say
  what the prediction was based on. "ContextFlow passed; I read the working
  tree and the backend reads origin" is a finding. Quietly moving on is not.
- When a check could not run, record that it did not run rather than letting
  its absence read as a pass. An unverifiable result is recoverable; a result
  recorded as passing when nothing ran is not.

## Do not state a mechanism from memory without checking it

Auto-run was paused mid-workflow and the user was told "the in-flight cycle
runs to completion — pause does not stop it". It does stop it: the task sat
stranded with no agent and no execution record. The claim came from a
remembered note about a _running queue item holding the concurrency slot_ —
a true fact about a different thing.

> A remembered mechanism is a hypothesis. State it as one, or spend the one
> command that settles it. Here `GET /tasks/<id>/executions` returning zero
> rows would have settled it before the sentence was written.

See [dev-loop-hazards.md](dev-loop-hazards.md) for what `pause` actually does.

## Separate what was measured from what was inferred

A screen task was predicted to fail verification. The asymmetry behind the
prediction was real and measured — the task asked for no registration while
the gate demanded one. The failure itself was never observed: the task was
interrupted before verify, and by the time it ran the fix was live and the
agent had registered an entry anyway.

> Report the measurement and the inference as two different things. "The
> conditions disagree, measured" is durable; "it will fail" was a forecast
> that went untested, and saying so costs nothing.

See [running-it-once.md](running-it-once.md) for the full set of findings
from that run, including what it did not establish.

---

See [gates-that-do-not-measure.md](gates-that-do-not-measure.md) for the same
principle applied to the system's own gates rather than to a person's
reporting.
