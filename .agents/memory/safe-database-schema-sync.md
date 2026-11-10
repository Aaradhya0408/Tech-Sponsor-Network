---
name: Safe database schema sync
description: Avoid data loss when Drizzle detects schema drift alongside a new additive change.
---

Do not accept a truncation prompt or use `push-force` merely to apply an unrelated additive schema change. Inspect the proposed schema diff and apply only the intended safe DDL or migration.

**Why:** Drizzle schema sync has detected an unrelated unique-constraint change on the populated campaign applications table and proposed truncating its rows.

**How to apply:** Before syncing schema changes, stop if the tool asks to truncate existing user data; preserve that data and use a targeted migration for the requested table or column.
