# Web performance lessons

## Measurement traps

- **CPU throttling slows the main thread only.** Background parse is not throttled, so slow-device parse cost is understated.
- **`page.route()` disables the HTTP cache** (Playwright docs: "Enabling routing disables http cache"). A caching counterfactual built on it measures nothing. Use real headers, or raw CDP `Fetch.enable` scoped to `resourceType: Document`.
- **`route.fulfill()` returns decoded bodies**, so "transferred" becomes the uncompressed size.
- **`extraHTTPHeaders` go on every request**, including cross-origin module scripts. A custom header then triggers CORS preflights and the CDN blocks the modules. An app WebView sends `loadRequest` headers on the document only; do the same.
- **The `load` event is not "page ready" with dynamic `import()`.** Stimulus eager loading imports controllers after `load`. Measure time to the last script, or wait for network idle.
- **Resource Timing under-reports cross-origin bytes** (`transferSize` is 0 without `Timing-Allow-Origin`). Use CDP `encodedDataLength`.
- **CDP `Network.requestWillBeSent` fires for memory- and disk-cache hits too**, so counting it as "network requests" hides caching. Use transferred bytes (`encodedDataLength`) or `responseReceived.fromDiskCache`/`fromMemoryCache`.

## Stack traps (seen with Rails behind nginx on Kubernetes; most apply to any nginx or Helm setup)

- nginx with `try_files $uri @app` and no files on disk hands everything to Rails. Headers in the asset block never apply; the `@app` block's do.
- `add_header` without `always` skips error responses, and any `add_header` in a location drops inherited ones.
- `add_header` values can use a `map $status` variable, so you can cache 200/304 and no-store the rest.
- ConfigMaps mounted with `subPath` never update in place, and CI that only sets images never applies them. A merged config change is not a deployed one.
- A `location` with `access_log off` silently drops those requests from the nginx log, even though they were logged before via the fallback location. Check logging parity when you add a location.
- Helm's pod checksum annotations may cover only some ConfigMaps; an upgrade can update nginx config without rolling pods. Test config changes on a fresh preview environment.
- Preview environments that update by merging the PR branch break after an amend and force-push (merge conflict). Recreate the environment instead of updating it.
- A prod page loads everything the importmap eagerly imports. The login page is a fair proxy for the shared head but not for signed-in work.
