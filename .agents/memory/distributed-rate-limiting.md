---
name: Distributed request throttling
description: Why request limits use shared Postgres buckets and hashed identifiers.
---

Keep rate-limit counters in shared Postgres storage rather than process memory. Hash route, IP, and identity scope keys before persistence so limits work across API replicas without storing raw IP addresses or email addresses.

**Why:** A serverless or horizontally scaled API may route repeated attempts to different instances, so local in-memory counters do not reliably enforce a shared limit.

**How to apply:** Add new abuse-sensitive routes through the shared rate-limit middleware and keep its table/index definitions aligned with the database schema.
