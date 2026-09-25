Every PR that changes a published package under `packages/` adds a changeset (`npm run changeset`).
The "Version Packages" PR bumps versions and writes each CHANGELOG; a human merges it, and `release.yml` publishes (gated on the `@convoso` npm org).
The rule starts after the first publish: the initial `0.1.0` of each package ships as committed, with no changeset, because `changeset publish` publishes every public package whose version is not on the registry yet, and a changeset now would bump a version that was never published.
