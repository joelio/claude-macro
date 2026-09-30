# Citation method

Every claim that reaches a human carries its evidence. Agents return citations as data (schema fields), not prose, so a reviewer can check them without re-running the work.

## Evidence tags

| Tag | Means | Example |
|---|---|---|
| `measured` | Observed by running something: browser, curl, query, benchmark | "211 requests on a cold load (n=3, identical)" |
| `code` | Read or counted in a repo at a known commit | "`controllers/index.js:7` eager-loads every controller" |
| `sourced` | From history (git, PRs, tickets) or a published source | "RFC 9111 §5.2.2.5 forbids storing no-store responses" |
| `inferred` | Reasoned from the above, not observed | "Returning users would hit the cache" |

A tag stronger than the evidence is a defect. Grep counts are `code`, not `measured`. A number derived by subtraction is `inferred`, even when its inputs were measured.

## A citation is a source plus a quote

```json
{ "source": "https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.5",
  "quote": "a cache MUST NOT store any part of either the immediate request or the response",
  "via": "exa" }
```

- **No quote, no "confirmed".** A URL alone proves nothing.
- Keep quotes short and verbatim. Truncate with `…`, never paraphrase inside quotes.
- For code: `path/to/file.rb:12-18` at a named commit or branch, quoting the line.
- For data: the file and field (`results.json warm1.total.encoded`), or the query file and output row.
- When sources disagree, cite both and say which wins and why.

## Source ladder (prefer higher)

1. Specs and standards: RFCs, W3C/WHATWG, OWASP ASVS/WSTG at a tagged version.
2. Source code at a pinned version: installed gems, `node_modules`, Chromium/WebKit/nginx source.
3. Official docs: nginx.org, MDN, developer.chrome.com, vendor docs (via context7 for libraries).
4. Vendor blogs and changelogs with dates.
5. Anything else, labelled as such. Never cite a model's memory.

## Fetching when tools fail

- exa rate-limits a fan-out within minutes. Fall back to fetching the primary text directly:
  - RFCs: `https://www.rfc-editor.org/rfc/rfcNNNN.txt`
  - Chromium docs and source: `https://chromium.googlesource.com/<path>?format=TEXT` (base64, decode it)
  - GitHub at a tag: `https://raw.githubusercontent.com/<org>/<repo>/<tag>/<path>`
  - Gems and packages: read the installed copy and cite its path and version.
- Save fetched sources under the work directory so a reviewer can re-check the quote offline.

## Quote check

`investigate` and `verify` run a mechanical quote check before the adversary. It finds each quote in its saved source, in the file at the named commit, or at the URL. Its results are `found`, `wrong-line`, `not-found` or `source-missing`; a missing source is reported, never counted as found. A claim whose quote wasn't found can't support a safe claim. This catches both quotes a model made up and text injected through a fetched page.

## Verdicts

Verification agents return one of `confirmed`, `partly`, `wrong`, `unverifiable`, with the exact corrected wording when not confirmed. A report is updated from the corrections, and the counts go into the report's method section ("123 claims: 68 confirmed, 47 partly, 5 wrong, 3 unverifiable").

## Numbers

- Method, n, median with IQR or min-max. State the unit (KB = 1,000 bytes or KiB).
- Deterministic values (byte counts) need n=1 but say so.
- Timings on one machine are repeatable, not representative. Report A/B deltas when arms run on different infrastructure.
- Bootstrap CIs over p-values when ranges do not overlap; p-values add nothing there.
