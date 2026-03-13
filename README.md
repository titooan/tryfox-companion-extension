# TryFox Companion Extension

TryFox Companion Extension is a Firefox add-on that turns supported Treeherder job URLs into `tryfox://` deep links and renders them as QR codes directly in the browser popup. It only activates on `https://treeherder.mozilla.org/` pages, so unrelated sites get no behavior.

This project is based on the original FxQRL repository by xeonchen.

## What It Does

When you open the extension on a supported Treeherder page, it:

- Parses the current Treeherder URL
- Converts it into the matching `tryfox://jobs?...` deep link
- Generates a QR code for that deep link without any network request

Supported cases currently include Treeherder `jobs` URLs using either:

- `revision`
- `author`

## Install Locally In Firefox

To load the extension temporarily for development:

1. Open Firefox.
2. Go to `about:debugging`.
3. Click `This Firefox`.
4. Click `Load Temporary Add-on...`.
5. Select [manifest.json](/Users/titouanthibaud/Documents/Mozilla/Android/tryfox-qr/manifest.json).

Firefox will load the extension immediately. You will need to reload it from `about:debugging` after local code changes or after restarting Firefox.

## Build

The repo now includes a small build automation layer similar in spirit to the TryFox Android project: one local command for packaging, one test command, and GitHub Actions for CI and release artifacts.

Run the test suite with:

```bash
npm test
```

Build the extension package with:

```bash
npm run build
```

This creates:

- `dist/tryfox-companion-extension-<version>.xpi`
- `dist/tryfox-companion-extension.xpi`

## Install A Built Package

The generated `.xpi` is an unsigned development build.

That means:

- It can be loaded for development from `about:debugging`
- It cannot usually be installed permanently in standard release Firefox
- Release Firefox often reports unsigned add-ons as "corrupted"

If you want a permanently installable package, the extension needs to be signed. For local development, use the temporary loading flow from `about:debugging`.

## Manual Packaging

Firefox extensions are packaged as `.zip` or `.xpi` archives containing the extension files at the archive root.

From the project directory, you can create a package with:

```bash
zip -r tryfox-companion-extension.zip manifest.json popup settings icons LICENSE README.md
```

If you want an `.xpi` file instead, use:

```bash
zip -r tryfox-companion-extension.xpi manifest.json popup settings icons LICENSE README.md
```

The automated `npm run build` command uses the same packaging model and writes the archive into `dist/`.

## CI And Release Automation

The repository now includes GitHub Actions workflows that:

- Run the URL translation tests on pushes and pull requests
- Build the `.xpi` artifact in CI
- Publish the built unsigned extension artifact on version-tagged releases
