# SameTree CI — Privacy Policy

_Last updated: November 14, 2026_

SameTree CI is a GitHub App that cancels duplicate GitHub Actions runs and
audits billed-minute waste. This policy describes exactly what it handles.

## What SameTree receives

When installed on a repository, GitHub sends SameTree `workflow_run`
webhook events for that repository. From those events and the GitHub API,
SameTree processes:

- Workflow run and job metadata: run IDs, workflow IDs, commit and tree
  SHAs, statuses, conclusions, attempt numbers, and start/completion
  timestamps.
- Repository identifiers: repository ID, owner login, and repository name.
- Installation identifiers: the GitHub App installation ID and the
  installing account's login.

## What SameTree never receives or stores

- **No source code.** SameTree never clones, downloads, or reads
  repository contents.
- **No workflow logs.** It reads run/job metadata only.
- **No secrets, environment variables, or artifacts.**
- **No personal data** beyond the account login that owns the
  installation.

## How the data is used

Run metadata is used for one purpose: deciding whether a newly requested
workflow run duplicates a run that already proved the same commit tree,
and computing billed-minute aggregates (totals, rounding waste, rerun
waste, duplicate-tree waste) for the nightly audit and weekly digest.
Aggregates are stored per repository per day.

## Retention and deletion

Metadata is retained while the App is installed so waste trends can be
reported over time. When the App is uninstalled, GitHub notifies SameTree
and the installation's stored data is deleted. You may also request
deletion at any time via the support contact below.

## Sharing

Data is never sold, shared with third parties, or used for advertising.

## Contact

Support and privacy questions: **coacha810@gmail.com**
