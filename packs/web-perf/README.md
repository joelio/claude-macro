# web-perf pack

Harness and examples for web performance and HTTP caching investigations. Install with `scripts/install.sh --pack web-perf`.

optional-tools: docker bq gcloud

| Path | What |
|---|---|
| `harness/browser/` | Playwright + CDP: cold-load profile, real warm-cache test, throttled WebView emulation. Env: `ASSET_MATCH`, `ASSET_PREFIX`, `EMBED_HEADER`, `WEBVIEW_UA`, `CLEAR_COOKIES`, `CHROME_PATH`, `OUT_DIR`. Each output records browser, OS, CPU and load. |
| `harness/bench-import/` | A/B module import benchmark: fresh browser per run, seeded interleave, bootstrap CI. `PKG_DIR`, `FILE_A`, `FILE_B`, `SEED`, `N`, `OUT_DIR`. |
| `harness/nginx-headers/` | Run your nginx configs in Docker against a stand-in upstream and assert status and headers from a cases file (`cases.example.tsv`). |
| `harness/bigquery/` | Parameterised GCP load-balancer log query: downloads and bytes of one asset by client type. |
| `examples/` | Args for investigate, verify and change-evidence from a real page-weight investigation. |
| `LESSONS.md` | Browser, CDP, nginx, Helm and Kubernetes traps. Read before measuring. |

Every script's header comment lists its arguments. Raw data goes to `OUT_DIR`, never into a repo.
