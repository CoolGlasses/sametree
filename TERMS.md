# SameTree CI — Terms of Service

_Last updated: November 14, 2026_

## The service

SameTree CI is a GitHub App that (a) cancels a GitHub Actions workflow
run when the same workflow has already completed successfully on the
identical git commit tree, and (b) reports billed-minute usage and waste
estimates for installed repositories.

## Estimates

All dollar figures SameTree reports are estimates computed from GitHub's
published per-minute rates and observed run durations. They are provided
for planning only and are not a guarantee of savings or of any GitHub
invoice amount.

## Cancellation behaviour

SameTree cancels a run only when a prior run of the same workflow on the
same repository completed with a **success** conclusion for the identical
commit tree. It never cancels the first run of a tree, and it never
cancels a run on the basis of an in-progress run. You are responsible for
deciding whether this behaviour fits your workflows; installing the App
is that decision. To stop all cancellations, uninstall the App — the
effect is immediate.

## Availability

The service is provided "as is", without warranties of any kind. The
publisher's liability for any claim arising from use of the service is
limited to the amount you paid for the service in the preceding twelve
months (for the free plan, that amount is zero).

## The free plan

The current plan is free. If paid plans are introduced in the future,
they will be offered through GitHub Marketplace under its terms, and no
existing free installation will be charged without an explicit purchase
through GitHub.

## Contact

**coacha810@gmail.com**
