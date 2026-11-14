---
name: Transactional email delivery
description: Shared rules for safe transactional emails and campaign alerts in Tech Sponsor Network.
---

Keep outbound mail behind one server-side send function that logs every attempt and applies the per-recipient rate limit. Send only to verified addresses, and do not let provider failures roll back or block the user action that triggered the email. Campaign alerts are separate: honor the creator's persisted opt-in and include a signed unsubscribe link.

**Why:** Transactional email is an external side effect; it must be observable and isolated from application writes, while campaign announcements must respect user preference.

**How to apply:** Use the existing shared email service for new message types. Prefer the connected Resend integration in Replit when no direct API key is configured; use a server secret for direct deployment environments.
