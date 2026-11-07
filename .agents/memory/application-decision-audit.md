---
name: Application decision audit
description: Preserve review decisions and their history when administrators change outcomes.
---

Every application status transition should atomically update the current state and append a history record with the previous state, new state, actor, timestamp, and any decision or correction reasons. Compare against the expected previous state so concurrent reviewers cannot silently overwrite one another. After the initial review decision, require a nonblank correction reason for each later transition.

**Why:** Admin review can correct earlier outcomes, but those corrections must stay attributable and concurrent actions must not erase the decision trail.

**How to apply:** Use this pattern for application review and other approval workflows that allow an explicit, auditable correction.
