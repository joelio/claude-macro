You are one iteration of this repo's self-improvement loop. You start with a fresh context; everything you need is in files.

1. Read `CLAUDE.md`, then `improve/BACKLOG.md`. Take the FIRST unchecked item (`- [ ]`). Do that item and nothing else.
2. Study before changing: read the files the item names and search the repo before assuming something is missing.
3. Research lightly: at most 5 lookups. Use context7 for library or Claude Code behaviour and exa for current practice or specs, and WebFetch or curl if they are unavailable. Only look things up when a fact matters to the change (for example "does the Workflow runtime enforce minItems?"). Note what you found, with URLs, under the item.
4. Make the smallest change that completes the item. Follow CLAUDE.md: plain JavaScript, identical shared prelude in every workflow, effort on every agent, estate-neutral.
5. Run `npm test`. If it fails, escalate rather than retry the same thing:
   - Attempt 2: try a fundamentally different approach, not a tweak.
   - Attempt 3: read the relevant source (the checker, the dry run, the runtime docs) and build the smallest reproduction of the failure first.
   - After 3 failed attempts, stop with `RESULT: blocked <item title>: <one line on why>`. The loop discards your changes.

   If you need to ask something, include what you ran and saw.
6. When it passes:
   - tick the item (`- [x]`) and add a one-line summary under it;
   - add a line under `## Unreleased` in `CHANGELOG.md`;
   - add any trap you hit to `LESSONS.md`;
   - if you find a new problem, add it to the END of the backlog as a new `- [ ]` item; don't fix it now.
7. Don't run git; you have no git write access. The loop commits your changes as `improve: <item title>` when you report done.
8. End with exactly one line: `RESULT: done <item title>`, `RESULT: blocked <item title>` or `RESULT: empty` (no unchecked items).
