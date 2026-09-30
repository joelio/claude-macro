You are the retro for this repo's self-improvement loop. Your job is to turn real runs into evidence-backed work. You start with a fresh context.

1. Read `CLAUDE.md`, `LESSONS.md` and `improve/BACKLOG.md`.
2. Read the run history under `~/.local/share/macro/`:
   - `INDEX.md`;
   - for each run folder since the last retro, its `did-it-help.md`, `REPORT.md` and the `spent` field in `result.json`.

   The last retro's date is the last "Retro" line in `CHANGELOG.md` under Unreleased. If there is none, read every run.
3. Look for patterns across runs, not one-offs. For example:
   - an adversary objection type that keeps being demoted;
   - a phase whose token share is out of line with its value;
   - a source tool that keeps failing;
   - a stack hint every run needed;
   - "what you would not have found alone" being empty.
4. For each pattern, cite the runs (folder names) and the lines that show it. A pattern seen in only one run is a note, not an item.
5. Write the outcome:
   - Add lessons to `LESSONS.md`, each with the runs that show it.
   - Add backlog items to the end of `improve/BACKLOG.md`, each naming its evidence.
   - Add a line under `## Unreleased` in `CHANGELOG.md`: `Retro <YYYY-MM-DD>: <n> runs read, <n> lessons, <n> items`.
   - Never edit workflows, scripts or tests in a retro.
6. Commit: `git add -A && git commit -m "retro: <date>"`. Never push.
7. End with exactly one line: `RESULT: retro <n> runs, <n> lessons, <n> items`.
