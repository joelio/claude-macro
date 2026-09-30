# Lessons

## Measurement traps

- **`page.route()` disables the HTTP cache** (Playwright docs: "Enabling routing disables http cache"). A caching counterfactual built on it measures nothing. Use real headers, or raw CDP `Fetch.enable` scoped to `resourceType: Document`.
- **`route.fulfill()` returns decoded bodies**, so "transferred" becomes the uncompressed size.
- **`extraHTTPHeaders` go on every request**, including cross-origin module scripts. A custom header then triggers CORS preflights and the CDN blocks the modules. An app WebView sends `loadRequest` headers on the document only; do the same.
- **The `load` event is not "page ready" with dynamic `import()`.** Stimulus eager loading imports controllers after `load`. Measure time to the last script, or wait for network idle.
- **Resource Timing under-reports cross-origin bytes** (`transferSize` is 0 without `Timing-Allow-Origin`). Use CDP `encodedDataLength`.
- **CDP `Network.requestWillBeSent` fires for memory- and disk-cache hits too**, so counting it as "network requests" hides caching. Use transferred bytes (`encodedDataLength`) or `responseReceived.fromDiskCache`/`fromMemoryCache`.
- **KB vs KiB** produced a wrong "47%" that should have been 48.7%. State the unit.
- **CPU throttling slows the main thread only.** Background parse is not throttled, so slow-device parse cost is understated.
- **One machine, tight IQR** means repeatable, not representative. Report deltas, not absolute times, when arms run on different infrastructure.

## Stack traps (seen with Rails behind nginx on Kubernetes; most apply to any nginx or Helm setup)

- nginx with `try_files $uri @app` and no files on disk hands everything to Rails. Headers in the asset block never apply; the `@app` block's do.
- `add_header` without `always` skips error responses, and any `add_header` in a location drops inherited ones.
- `add_header` values can use a `map $status` variable, so you can cache 200/304 and no-store the rest.
- ConfigMaps mounted with `subPath` never update in place, and CI that only sets images never applies them. A merged config change is not a deployed one.
- A `location` with `access_log off` silently drops those requests from the nginx log, even though they were logged before via the fallback location. Check logging parity when you add a location.
- Helm's pod checksum annotations may cover only some ConfigMaps; an upgrade can update nginx config without rolling pods. Test config changes on a fresh preview environment.
- Preview environments that update by merging the PR branch break after an amend and force-push (merge conflict). Recreate the environment instead of updating it.
- A prod page loads everything the importmap eagerly imports. The login page is a fair proxy for the shared head but not for signed-in work.

## Sources and tools

- Exa's free tier rate-limits a parallel fan-out within minutes. Set `EXA_API_KEY` before `scripts/install.sh`. Otherwise agents fall back to curl of primary sources: RFC text, `chromium.googlesource.com/...?format=TEXT` (base64), raw GitHub at a tag.
- context7 is reliable for framework docs (Turbo, Stimulus, Chart.js, cytoscape, Playwright).
- `gcloud`/`bq` need an interactive login; have the human run it with `! gcloud auth login`, then dry-run every query and cap bytes billed.

## How the agents did

- Sonnet workers were accurate on direct measurement and code reads, and candid about their own invalid methods.
- They slipped on cross-referencing: counts off by one or two, a missed call site, a guessed frequency presented as a number.
- The logic agent (no lookups, just premises and conclusions) found the most important problems: overstated evidence tags, two problems merged into one, no user-visible timing.
- The Opus adversary caught real design errors (an unnecessary `proxy_hide_header` plan, a wrong ordering constraint), and once asserted a fact the earlier evidence had already disproved. Read its output as critically as anyone else's.
- The sceptic step pays for itself. Keep it.
- A fresh verify pass over a report that had already been verified still found 4 wrong claims and flipped the option ranking, mostly by joining evidence from later runs. Worth doing before a report is circulated widely.
