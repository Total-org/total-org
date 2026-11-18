# Scheduled releases

Written 7 November 2026. How Total ships now, in plain words.

## When releases happen

Twice a day, at about **09:00 and 21:00 India time**, GitHub looks at `main` and decides whether
to release it. It runs on GitHub's computers, so your laptop can be off. GitHub sometimes starts a
scheduled job 5 to 30 minutes late; that is normal.

A release is always the next **small** version (0.12.0 → 0.12.1 → 0.12.2 …). Bigger steps, such
as 0.13 or 1.0, stay your decision: you still do those by hand. Once the version reaches 1.0, the
schedule stops releasing until a file named `.github/release-minor-approved` is added to the repo.

## What has to be true before it releases

All of these, every time:

1. **Something new.** At least one change since the last release that reaches users. Changes only
   to the docs, the website, the GitHub setup or the root notes (README, CHANGELOG, CLAUDE.md,
   to-do.md), or any CLAUDE.md (the agents' rules), do not count. If nothing counts, the slot skips quietly.
2. **The checks on `main` are green.** Every test job on the newest commit of `main` finished and
   passed, including the long Mac end-to-end tests and the speed tests. If they are still running,
   the slot waits for the next one.
3. **Old books still give the same figures.** GitHub installs the last release, makes two
   companies with it (the sample "Demo Traders" and a generated trading company with a few
   thousand entries), and notes every report: trial balance, profit and loss, balance sheet, who
   owes and whom you owe, stock summary, and GSTR-1 and GSTR-3B for every month. Then it opens the
   same books with the new version, which updates them, and notes the reports again. **If any
   figure moved, it does not release** (unless you approved it, below). It also checks that the
   update ran cleanly, that the file is not damaged, that the change history still verifies, and
   that a backup of the books restores and checks OK.
4. **Nobody asked to hold it.** No open pull request carries the label `release-blocker`.

When a slot skips for a reason (not the quiet kinds), GitHub opens one issue called
**"Scheduled release skipped"** with the reason, and adds a comment each time it skips again. The
issue closes itself after the next release goes out.

## Your one click before each release

Since 19 November 2026 (readiness review R5), every release waits for you before it goes out,
including the twice-a-day ones. When a slot has built the Mac and Windows files, GitHub stops at
the step that signs them and e-mails you: **"Review pending deployments"**. Open the run, choose
**production-release**, and click **Approve and deploy**. GitHub then signs the release and
publishes it. Until you click, nobody sees it.

- While a release waits for you, the next slots wait too (they do not open the "skipped" issue).
- **Reject means "not now"**, not "never". The release stays a draft and nobody sees it, but its
  version is already on `main`, so every later slot stops at "last release complete" and says so
  in the "Scheduled release skipped" issue, twice a day, until that same version is published.
  To publish it after all: open the run and click **Re-run failed jobs** (only the signing step
  runs again, not the hours of building), then approve. To ship a fix instead: merge the fix, then
  release the next small version by hand (`npm version patch && git push --follow-tags`); it also
  waits for your click, and the slots carry on from it.
- If nobody answers for 30 days, GitHub gives up on the run and the release stays a draft, the
  same as a reject.
- The signing key is kept in the **production-release** environment, which only you can approve
  and which only runs from `main` and from version tags. A change on any other branch cannot
  reach it.

After a release, GitHub checks that the release page has the Mac and Windows files and that the
website's update feed shows the new version on both addresses — `irminflow.com/api/latest` and the old
`devjindal.tech/api/latest` (copies installed before 8 Nov 2026 still ask the old one). Installed copies of
Total learn about updates from that feed.

## How to hold a release

Open (or pick) a pull request and add the label **`release-blocker`**. While that pull request is
open with the label, no scheduled release happens. Remove the label, or close the pull request, to
let releases go again.

## How to approve a change in figures

If a change is meant to move figures in existing books (for example a GST correction), add the
label **`figures-approved`** to that pull request. The next slot will then release even though the
figures moved. The run summary on GitHub lists every figure that changed (old value and new value),
so you can see exactly what you approved. One approved pull request covers every difference in that
release's batch, so look at the list.

## If a release breaks halfway

If building or signing a release fails after its version tag was made (or you rejected it), the
release stays a draft and nobody sees it. The next slots then skip and the issue says so. If only
the signing failed, **Re-run failed jobs** on that run is quickest. Otherwise: **Actions → Release →
Run workflow**, keep the branch on `main`, type the tag (for example `v0.12.1`) and run it. It waits
for your click again before it publishes. This works on a **draft** only: Release refuses a version
that is already published, so the files people have downloaded are never replaced. A release is
never published without its signed check file (`total-manifest.json`).

## Trying the gate without releasing

On GitHub: **Actions → Scheduled release → Run workflow**, keep **dry run** ticked. It runs every
check and shows the result in the run summary, but never changes the version or releases anything.

## GitHub settings that protect releases

These are set by you in GitHub, not in the code. Do them in one sitting, in this order:

1. **Move the signing key.** Settings → Environments → **production-release** → Environment
   secrets → add `RELEASE_MANIFEST_KEY` (the same key as today). Then Settings → Secrets and
   variables → Actions → delete the repository secret `RELEASE_MANIFEST_KEY`. Then delete the
   unused **release-signing** environment. Releases work before and after this move; after it, only
   a run you approve can use the key.
2. **Protect `main`.** Settings → Rules → Rulesets → New branch ruleset, target `main`, turn on
   **Restrict deletions** and **Block force pushes**. Do **not** turn on "Require a pull request
   before merging" yet: GitHub's built-in robot token cannot be let past it, so the twice-a-day
   release could no longer push its version commit (to-do.md §3 says what it needs first).
3. **Protect the version tags.** New tag ruleset, target `v*`, turn on **Restrict updates**,
   **Restrict deletions** and **Block force pushes**. Leave "Restrict creations" off: the release
   robot creates each new tag.
4. **Immutable releases.** Settings → General → Releases → turn on **immutable releases**, so the
   files of a published release can never be swapped. (Total's releases stay drafts until signed,
   and drafts can still be filled, so this does not get in the way.)

`.github/CODEOWNERS` names you for the release machinery (`.github/`, `scripts/release/`,
`package.json`, `package-lock.json`, `src/main/releaseKeys.json`). "Require review from code
owners" is part of the pull-request rule in step 2, so it waits with it. GitHub never asks you to
review your own pull requests, and the agents open theirs under your account, so until then the
file only asks for your review on pull requests from other people.
