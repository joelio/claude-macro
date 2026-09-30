# infra pack

Read-only harnesses and examples for infrastructure drift and change investigations. Install with `scripts/install.sh --pack infra`.

optional-tools: terraform jq kubectl

| Path | What |
|---|---|
| `harness/terraform-plan-diff/` | `terraform plan -lock=false` saved to `OUT_DIR`, then one line per changed resource. Env: `TF_DIR`, `OUT_DIR`. Never applies. |
| `harness/kubectl-diff/` | `kubectl diff --server-side` of a manifest against a cluster: changed objects plus a count. Env: `KUBE_CONTEXT`, `OUT_DIR`. Never applies. |
| `examples/` | Args for investigate (drift) and verify (a plan-diff claim) using placeholders. |

Plan output can contain secrets. Keep `OUT_DIR` in the run folder, never in a repo, and don't paste raw plan text into reports.
