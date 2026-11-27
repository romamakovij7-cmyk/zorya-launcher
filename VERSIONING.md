# Zorya Launcher versioning

Version format: `MAJOR.MINOR.PATCH.BUILD`:

- `0.1.1` — the first public release.
- **Bug fix only** → increase the **fourth** number: `0.1.1` → `0.1.1.1` → `0.1.1.2`.
- **New feature / visible addition** → increase the **third** number and reset the build: `0.1.1.3` → `0.1.2`.
- **Major rewrite** → increase the first number and reset the rest: `1.0.0`.

The site's **Download** button always resolves the newest GitHub release through the API,
so no site edit is needed when a version changes.

## How to publish a new version

1. Write the new public version into the `VERSION` file and set
   `build.extraMetadata.version` in `package.json` to the same value
   (`package.json`'s own `version` stays three-part semver — electron-builder
   refuses four parts).
2. `npm run dist` — produces `release/Zorya-Launcher-Setup-<semver>.exe`;
   the release script renames it to the public version.
3. `GH_TOKEN=<token> python scripts/release_version.py` — creates the `v<version>` tag,
   uploads the installer, and pushes the source tree to `main`.
4. If the site changed too: `cd ../zorya-site-fixed && python scripts/publish_site.py`.

The offline Horizon bundle stays on the `v0.1.1` release (only the launcher installer
moves between versions), so the direct-start download URL remains stable.
