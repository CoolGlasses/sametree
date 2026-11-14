# SameTree

A GitHub App that stops your CI from proving the same code twice.

When the same commit **tree** gets checked by more than one workflow run —
a feature PR, a long-lived release PR, and a push, all landing on identical
content — GitHub happily bills you for every one of them. GitHub's native
`concurrency` groups can't see it: they work per-workflow, and the
duplication lives *across* workflows, refs, and triggers.

SameTree can see it, because it keys on the one thing that actually defines
"the same code": the git **tree SHA**. Two different commits with identical
content share a tree. When a tree has already completed green for a
workflow, SameTree cancels any later run of that workflow on that tree —
in seconds, before it burns minutes.

## What it does

1. **Real-time canceller.** On every `workflow_run` request, SameTree
   resolves the head commit to its tree SHA. If that workflow already has a
   completed *success* for the same tree, the new run is cancelled and the
   save is recorded. Conservative by design: a tree only counts as proven
   by a completed success, never by an in-flight run — cancelling can
   never leave a tree unchecked.
2. **Nightly waste audit.** Per repo, per day: billed vs actual minutes,
   split into the three waste lanes — per-job minute rounding (GitHub
   bills every job rounded up), rerun attempts, and duplicate-tree runs.
3. **Weekly digest issue.** The week's waste with dollar estimates and the
   top workflows by billed minutes, posted as an issue per repo (opt-in
   per repo).

State is run/job metadata only. SameTree never reads your code, your
logs, or your files.

## Why this exists

One team audited its own GitHub Actions bill
([the audit](https://www.puglieseweb.com/blog/optimising-github-actions-builds-cost-and-feedback)):
1,586 billed minutes for 831 minutes of actual work — the per-job round-up
alone was 48% — and 73% of the bill was checks, "most of that checks
proving the same tree twice": a full suite re-ran on a tree the feature PR
had finished checking sixty seconds earlier, 22 times in one day.

## Running it

```bash
cp .env.example .env   # app id, private key path, webhook secret
npm start              # webhook server (POST /webhooks, GET /health)
npm run audit          # nightly aggregation (cron)
npm run digest         # weekly digest issues (cron)
npm test               # test suite
```

Zero runtime dependencies: Node 18+ standard library only.

## Permissions it asks for

- **Actions: read & write** — list runs/jobs for the audit; cancel
  duplicate runs.
- **Issues: read & write** — post the weekly digest issue.
- **Metadata: read** — baseline.

Events: `workflow_run` only.

## Status

0.1.0 — built and unit/integration-tested. Live installation begins once
hosting is provisioned (the App needs an always-on public webhook
endpoint).
