---
name: API response contracts
description: Keep server response serializers aligned with generated API schemas.
---

When a route validates its outgoing payload with a generated Zod response schema, serialize every required schema field even if the immediate screen does not display it. A database write can succeed and still become an HTTP 500 if response parsing fails.

**Why:** Application creation exposed that the generated response required the creator's submitted message and payment-rule acknowledgement, while the initial serializer returned only summary fields.

**How to apply:** Treat OpenAPI-generated response schemas as runtime contracts for both create and list endpoints; verify server serializers against them in integration tests.
