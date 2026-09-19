# Releasing

## One-time setup

1. Create a token that can publish **without a one-time password**. On the npm website:
   - **Classic → Automation** token (simplest), or
   - **Granular access token** with **Bypass 2FA** enabled, **Read and write** on packages, and
     **All packages** selected. A granular token scoped to one package cannot create a *new*
     package, so “All packages” is required for the first publish.

   A *Publish* token will fail in CI with `EOTP`, because GitHub Actions has no authenticator.
2. Add the token to the GitHub repository as the `NPM_TOKEN` secret
   (Settings → Secrets and variables → Actions → New repository secret).
3. Confirm the package name is available: `npm view pi-jev-wiki version` (an E404 means it is free).
4. Confirm `repository`, `homepage`, and `bugs` in `package.json` point at the real repository.

## Release checklist

1. Update `CHANGELOG.md` with the release notes.
2. Bump the version and tag in one step: `npm version patch|minor|major`
   (creates a commit and a `vX.Y.Z` tag).
3. Run the full local check: `npm run test:all` (typecheck + offline unit tests + scale test).
4. Inspect the tarball: `npm pack --dry-run` — expect 34+ files, only `src/`, `skills/`,
   `README.md`, `CHANGELOG.md`, and `LICENSE` (plus `package.json`).
5. Smoke-test the packed artifact:
   ```bash
   tmp=$(mktemp -d) && npm pack --pack-destination "$tmp"
   mkdir -p "$tmp/pkg" && tar -xzf "$tmp"/pi-jev-wiki-*.tgz -C "$tmp/pkg"
   pi -e "$tmp/pkg/package" -p "Call wiki_status and report the provider and wiki root."
   ```
6. Publish: push a version tag (`git tag vX.Y.Z && git push origin vX.Y.Z`) to run
   `.github/workflows/publish.yml` (tests + `npm publish --provenance`), or run that workflow
   manually from the Actions tab (`workflow_dispatch`) to publish the version in `package.json`.
7. Create a GitHub release from the tag with the changelog section.

## What never ships

- `.env` (gitignored and unlisted), `docs/`, `research/`, `scripts/`, `.pi/`, `node_modules/`.
  The `files` whitelist in `package.json` is the single source of truth.

## After publishing

- Verify the gallery entry: `pi install npm:pi-jev-wiki`, then `pi -e npm:pi-jev-wiki` for a throwaway run.
- Confirm the published README renders and the pi manifest (`extensions`, `skills`) resolves.
