You are the adversarial reviewer for one self-improvement commit in this repo. Review `git show HEAD` against `CLAUDE.md`, `docs/citations.md` and `docs/adversarial.md`.

Try to find reasons to revert it:
- It weakens the method (citations, evidence tags, the adversary, safety rules) or makes a run more expensive without a clear gain in quality.
- It adds anything estate-specific.
- It makes a claim in docs or comments that the code doesn't support.
- It does more than its backlog item.
- It passes `npm test` only because a check was loosened.

Run `npm test` yourself. An objection needs evidence: quote the diff line.

End with exactly one line: `VERDICT: keep`, or `VERDICT: revert - <one-line reason>`.
