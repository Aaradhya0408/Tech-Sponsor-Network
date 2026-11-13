---
name: Private App Storage access
description: Replit App Storage access for private files in this project.
---

**Rule:** For API-server access to private objects, request signed URLs through the Replit storage sidecar and fetch them server-side. Do not return signed GET URLs to clients; serve file bytes through authenticated API routes.

**Why:** The API service has the App Storage bucket and sidecar but Google Cloud auth cannot discover a project ID for the Storage SDK in this environment; sidecar-signed reads and writes work.

**How to apply:** Use this for private invoice objects in this project. Keep upload URLs PUT-only and short-lived, verify uploaded bytes before copying into final private paths, and retain creator/admin authorization on every download route.
