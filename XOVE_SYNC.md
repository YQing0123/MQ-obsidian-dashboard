# Xove Upstream Synchronization Record

This repository keeps local Dashboard customizations on `main`. Xove is a
separate upstream reference and must never be merged wholesale into this
repository.

## Upstream

- Remote: `https://github.com/TanYinaia/Xove-Dashboard.git`
- Reference snapshot: `ceabf5984a00b3212bd966b76b19ef154263fb26`
- Snapshot date: 2026-08-27

## Applied From Xove

- 0.4.2: Multiple independent countdown cards. The edit bar can add cards up
  to Xove's limit of five; each card has its own event, date, order, and size.

## Local Compatibility Choices

- Countdown data is stored as `countdownCards`, not by replacing the existing
  single `countdown` setting. Existing local settings are migrated on load.
- Each countdown card has a unique `data-mod` identity so local drag, resize,
  order persistence, and delete actions remain independent.
- Local task, project, knowledge-workbench, banner, and vault integration
  features remain owned by this repository and are not overwritten by Xove.

## Update Procedure

1. Run `git fetch xove --prune`.
2. Create `integrate/xove-YYYYMMDD` from `main`.
3. Compare only the requested Xove feature and port it selectively.
4. Build `main.js`, run checks, record the upstream commit and decision here.
5. Merge the verified integration branch back into `main`.
