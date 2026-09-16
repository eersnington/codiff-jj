# Distribution

## Release repository

Publish Codiff releases to [eersnington/codiff-jj](https://github.com/eersnington/codiff-jj/releases).
Use `--repo eersnington/codiff-jj` with GitHub CLI release commands; local CLI defaults may point upstream.

Desktop and CLI update checks use the fork's latest published release. They compare
semantic versions, not `main` commits. The Electron update feed also targets the fork.
Update notices are cached in `~/.codiff/update-state-codiff-jj.json`, separately from
the upstream app's cache.

## Build

Codiff uses Electron Forge. The product name is `Codiff`, the URL scheme is
`codiff`, and the existing bundle ID is `dev.nkzw-tech.codiff`.

```sh
pnpm make
pnpm make:ci
pnpm make:mac
```

For a signed, notarized macOS build, configure your Apple credentials and a
Developer ID certificate in the local keychain:

```sh
export APPLE_ID='apple-id@example.com'
export APPLE_PASSWORD='app-specific-password-or-keychain-profile'
export APPLE_TEAM_ID='TEAMID12345'
export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID12345)'
pnpm make:mac
```

## Release workflow

`.github/workflows/build-app.yml` runs for `v*` tags in this fork. It verifies that
the tag is `v<package.json version>`, creates a draft release, builds Linux and
Windows artifacts, uploads them, and publishes the release. Pushing `main` does
not publish a desktop release. macOS builds are local because they require a
Developer ID certificate.

When uploading a signed macOS build, use the version in the matching zip:

```sh
gh release upload v<version> \
  out/make/zip/darwin/arm64/Codiff-darwin-arm64-<version>.zip \
  --repo eersnington/codiff-jj
```

If the release is still a draft, publish it when its artifacts are ready:

```sh
gh release edit v<version> --repo eersnington/codiff-jj --draft=false --latest
```

Verify that the uploaded zip downloads from:

```text
https://github.com/eersnington/codiff-jj/releases/download/v<version>/Codiff-darwin-arm64-<version>.zip
```

Compare its SHA-256 with the local zip using `shasum -a 256`.

## Installation

Download the app from the fork's GitHub Releases. A Homebrew tap for this fork
is not configured.

After installing the app, run `Codiff > Install Terminal Helper`. This installs
the packaged `codiff` launcher into the first writable location among
`/opt/homebrew/bin`, `/usr/local/bin`, and `~/.local/bin`.
The launcher runs independently of checkout dependencies.

## Website deployment

`.github/workflows/deploy-web.yml` deploys changes on `main` to
`https://codiff.eers.dev`. Website deployment is independent of desktop releases.
