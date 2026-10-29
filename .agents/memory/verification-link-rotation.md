---
name: Verification link rotation
description: Resend behavior for pending email-verification links.
---

When issuing a new verification link for an unverified account, invalidate any earlier pending links for that account.

**Why:** A resend should leave one current link usable and prevent older delivered links from unexpectedly verifying the account.

**How to apply:** Keep token replacement transactional with creation of the new hashed token; preserve this behavior if resend or email delivery flows change.
