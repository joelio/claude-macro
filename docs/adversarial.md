# Adversarial method

Gathering evidence is cheap; being wrong in front of a team is not. Every workflow ends with at least one agent whose only job is to break the result. Pick the pattern by what could be wrong.

## Patterns

| Pattern | When | How |
|---|---|---|
| **Sceptic** | After evidence gathering | Opus re-checks every measured or code finding the decision rests on (at least 12), by id, with a cheap re-check: re-read the line, re-count, re-open the raw data. Upheld only if the re-check reproduces it; there is no default verdict. Verdicts are joined back onto the findings and anything unexamined is marked `not-checked`. Also lists unanswered sub-questions, one alternative explanation per headline finding, and contradictions between streams. |
| **Logic reviewer** | Any report with recommendations | Runs after the claim groups, on Opus, with their verdicts. For each conclusion: premises and their verdicts, whether it follows, hidden assumptions, overgeneralisation, confounders, missing alternatives, and tags stronger than the evidence. In practice this found the most important problems. |
| **Per-recommendation attacker** | Before ranking options | One agent per recommendation argues against it as hard as it honestly can: security, operations, benefit, cheaper alternatives. Each objection is rated `blocker`, `serious`, `minor`, `question` or `refuted`. Blocker, serious and refuted need a citation; the script demotes uncited ones to `question`. Output: survives yes/no and a revised recommendation. |
| **Change challenger** | Before a PR leaves draft | The reviewer (Opus by default) reads all evidence for a code change, re-runs cheap checks, and returns objections by severity, the exact sentences safe to put in the PR (each naming its evidence), verification steps for whoever verifies, engineer-only steps and a verdict: `ship-as-draft`, `fix-first` or `do-not-ship`. |
| **Steelman then test** | A claim you think is nonsense (e.g. an old pentest rationale) | Build the strongest version of the claim first, then test that version against primary sources. Rejecting a weak version proves nothing. |

## Rules for adversaries

- Use a stronger model than the workers by default (Opus over Sonnet), and never a weaker one. Different model, different blind spots. In verify, run the logic group on Opus too.
- Give them all the evidence, including the raw-data paths, so they can re-check rather than argue from summaries.
- Refuting needs evidence as much as asserting does. An objection without a citation is a question, not a finding.
- Severity is about consequence, not confidence: a blocker stops the change, a minor goes in the PR as a note.
- Read the adversary critically too. In one run Opus asserted a fact that earlier evidence had already disproved (that nginx served the files); the fix was to check it against the measured headers.

## Where the adversary's output goes

- Corrections go into the report or PR text, with the verdict counts in the method section.
- `claims_safe_for_pr` sentences are the only numbers that go into a PR description.
- QA steps are for people without cluster access; anything needing `kubectl`, `gcloud` or a shell goes under a separate engineer heading.
- Objections you decide to accept (risk acceptance) are written down where the decision-makers will see them, e.g. the ticket.

## What it caught in practice

- A caching "simulation" that disabled the cache it was meant to measure.
- A recommended nginx directive that was unnecessary and would not have done what was claimed.
- An ordering constraint for a chart library that was the wrong way round.
- A "biggest win" ranking that depended on a traffic figure nobody had; the fix was to go and measure it.
- Guessed usage frequencies presented as numbers; they were removed until real data existed.
