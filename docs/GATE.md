### 1. SameTree — duplicate-run canceller + billed-minutes waste auditor (28/30)

**1. Pain + payer.** Orgs paying GitHub per billed minute while the same commit tree is checked two or three times — feature PR, long-lived release PR, and push — plus per-job minute-rounding waste. **Coordinator-verified firsthand** — one team's published audit of its own org (https://www.puglieseweb.com/blog/optimising-github-actions-builds-cost-and-feedback):
- "400 runs, 1,283 jobs, 1,586 billed minutes for 831 minutes of actual work. The round-up alone was 48%."
- "Seventy-three per cent of the bill was checks, and most of that was checks proving the same tree twice" — a full check suite re-ran "on a tree the feature PR had finished checking sixty seconds earlier," 22 times in one day, 37% of the bill.
- "That sounds like nothing until a single active repository is burning 16,000 minutes a month."
The team hand-built the measurement with `gh` scripts against the jobs/billing APIs — the workaround is the product spec. Datadog/Mergify CI pricing (below) proves teams pay for CI analytics generally.

**2. Price point.** Datadog CI Pipeline Visibility $8/committer/mo annual, $12 on-demand (vendor pricing page opened by researcher) — visibility only, no action. Mergify CI Insights bundled at $21/user/mo. **Proposed: $39/mo flat per org (≤10 repos), $49 above.** Flat beats per-committer past ~5 committers, and neither incumbent *acts*: this one cancels duplicate runs in real time, so ROI is a line item — billed minutes not bought.

**3. Money rail.** GitHub Marketplace App — RAIL VERIFIED firsthand (final section). Free listing → 100 installs → verified-publisher org → paid plans. One caveat: the specific jobs/billing usage API surface was evidenced by the audit post itself but not separately opened in GitHub's API docs — treat the API detail as corroborated, not doc-verified.

**4. App-fit.** Two server-only jobs. (a) Real-time: duplication is *cross-trigger* — the same tree arriving via feature PR, release-PR `synchronize`, and push are different workflows/refs, so GitHub's native per-workflow `concurrency` groups cannot see it; only a webhook server holding a (tree-SHA → checks already passed) map across the org can cancel the second run in seconds. Honest limit: teams whose only duplication is within one workflow get this free from native `concurrency` — the pitch is strictly cross-workflow/cross-PR duplication. (b) Scheduled: nightly billed-minutes computation (per-job `ceil` rounding, rerun waste, duplicate-tree waste, per repo/workflow/author) needs persistent multi-month state no Action has.

**5. Build shape.** Webhooks `pull_request`, `push`, `workflow_run` requested/completed. On request: hash tree SHA, look up prior completed checks, cancel redundant in-progress runs via Actions API. Nightly cron: pull the day's jobs, compute billed vs actual, store daily aggregates. Weekly digest issue: top waste lanes with $ values. State: run/job metadata only — no logs, no code. One worker + cron. **Not TOO BIG.**

**6. Hosting cost.** ~$5–6/mo droplet from day one (secondary-corroborated price; DigitalOcean's own pricing page not opened by anyone on this hunt — see rail section). Nightly-batch API polling fits one small box.

---

