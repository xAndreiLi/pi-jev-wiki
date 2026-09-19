# Releasing

## One-time setup

1. Create an npm account and log in locally: `npm login`, or create an automation token and add it
   to the GitHub repository as the `NPM_TOKEN` secret (used by `.github/workflows/publish.yml`).
2. Confirm the package name is available: `npm view jev-wiki version` (an E404 means it is free).
3. Confirm `repository`, `homepage`, and `bugs` in `package.json` point at the real repository.

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
   mkdir -p "$tmp/pkg" && tar -xzf "$tmp"/jev-wiki-*.tgz -C "$tmp/pkg"
   pi -e "$tmp/pkg/package" -p "Call wiki_status and report the provider and wiki root."
   ```
6. Publish: `npm publish` (unscoped, public by default), or push the tag and let
   `.github/workflows/publish.yml` run `npm publish --provenance`.
7. Push the version commit and tag: `git push && git push --tags`.
8. Create a GitHub release from the tag with the changelog section.

## What never ships

- `.env` (gitignored and unlisted), `docs/`, `research/`, `scripts/`, `.pi/`, `node_modules/`.
  The `files` whitelist in `package.json` is the single source of truth.

## After publishing

- Verify the gallery entry: `pi install npm:jev-wiki`, then `pi -e npm:jev-wiki` for a throwaway run.
- Confirm the published README renders and the pi manifest (`extensions`, `skills`) resolves.
