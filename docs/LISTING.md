# SameTree CI — Marketplace listing draft (for Robin's one-look, then submit)

**Listing name:** SameTree CI

**Short description (target 40–80 chars):**
Cancels duplicate GitHub Actions runs and audits your billed-minute waste.

**Primary category:** Continuous integration
**Secondary category:** Testing

**Pricing plan:** Free — "Free" plan, $0, per-installation (unit: installation).
Every plan feature: real-time duplicate-run cancellation, nightly
billed-minute audit, weekly waste digest issue.

**Customer support URL:** https://github.com/CoolGlasses/sametree
**Support email:** coacha810@gmail.com
**Privacy policy URL:** https://github.com/CoolGlasses/sametree/blob/main/PRIVACY.md
**Terms URL:** https://github.com/CoolGlasses/sametree/blob/main/TERMS.md

**Long description:**

## Stop paying GitHub to prove the same code twice

When the same commit tree gets checked by more than one workflow run —
a feature PR, a long-lived release PR, and a push, all landing on
identical content — GitHub bills you for every one of them. GitHub's
native `concurrency` groups can't see it: they work per workflow, and
the duplication lives across workflows, refs, and triggers.

SameTree keys on the one thing that actually defines "the same code":
the git tree SHA. Two different commits with identical content share a
tree. When a tree has already completed green for a workflow, SameTree
cancels any later run of that workflow on that tree — in seconds,
before it burns minutes.

## What it does

- **Real-time canceller.** On every workflow run request, SameTree
  resolves the head commit to its tree SHA. If that workflow already
  has a completed success for the same tree, the new run is cancelled
  and the save is recorded. Conservative by design: a tree counts as
  proven only by a completed success, never by an in-flight run, so
  cancelling can never leave a tree unchecked.
- **Nightly waste audit.** Per repo, per day: billed vs actual minutes,
  split into per-job minute rounding, rerun attempts, and
  duplicate-tree runs.
- **Weekly digest issue.** The week's waste with dollar estimates and
  your top workflows by billed minutes, posted as an issue (opt-in
  per repo).

## Privacy

SameTree stores run and job metadata only. It never reads your source
code, your workflow logs, your secrets, or your artifacts. See the
privacy policy for the full list.

## Why this exists

One team audited its own GitHub Actions bill: 1,586 billed minutes for
831 minutes of actual work — and 73% of the bill was checks, most of it
checks proving the same tree twice.

**Logo:** listing-assets/sametree-logo.png (two tree cross-sections, one shared tree)
