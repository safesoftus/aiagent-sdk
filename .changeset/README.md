Every PR that changes a published package under `packages/` adds a changeset (`npm run changeset`).
The "Version Packages" PR bumps versions and writes each CHANGELOG; a human merges it, `scripts/sdk/sync-public.sh --push` mirrors it to the public repo safesoftus/aiagent-sdk, and that repo's release workflow publishes (this repo's `release.yml` is a dry-run check only).
`0.1.0` of each package is on npm, so the rule applies to every change from here on.
