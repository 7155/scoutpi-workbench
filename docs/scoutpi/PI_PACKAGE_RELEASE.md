# Pi Package And Gallery Release

ScoutPi Workbench is a public Git repository and a Pi package candidate. These are different publication states:

```text
GitHub public repository
  -> installable now with pi install git:github.com/7155/scoutpi-workbench

npm public package
  -> appears in Pi's official gallery after an explicit npm publish
```

Pi's official gallery indexes npm packages carrying the `pi-package` keyword. Git and local installs are supported by Pi, but they do not by themselves create a gallery listing.

## Package Boundary

The npm tarball is the Pi runtime distribution. It contains:

- seven event/tool extensions under `.pi/extensions`;
- the progressive-disclosure investigation skill;
- the TypeScript runtime modules imported by those extensions;
- the two bounded Python workers;
- public README, license, changelog and security policy.

It intentionally excludes:

- Workbench frontend source and build output;
- tests and harness fixtures;
- agent development logs;
- `.env`, `.scoutpi`, exports, screenshots and local databases;
- lockfiles and local credentials.

Clone the repository when developing or running the full Vue Workbench. Installing the npm package is for the Pi runtime surface.

Pi host libraries remain peer dependencies. The package must not install a second copy of Pi or TypeBox into the extension module boundary.

## Verification Gate

Run:

```bash
pnpm package:verify
```

The verifier:

1. runs `npm pack` into a temporary directory;
2. enforces the package name, size budget, gallery metadata and peer dependencies;
3. rejects development/private paths and machine-specific credential patterns;
4. extracts the actual `.tgz` rather than testing the source checkout;
5. starts all seven packed extensions and the packed skill in a real Pi RPC process;
6. uses an offline dummy model and performs no model request;
7. verifies the operator commands and skill are registered;
8. deletes the temporary archive and runtime state.

Current verified package budget:

```text
entries:       51
packed:        143,845 bytes
unpacked:      520,148 bytes
extensions:    7
skill:         loaded
```

These numbers are measured, not release promises. The verifier enforces an unpacked upper bound and reports current values on every run.

`pnpm check` includes this gate, and `prepublishOnly` runs the complete check again.

## Explicit Release Procedure

Publishing is intentionally not automatic from a developer checkout.

1. Confirm `git status --short` is clean and CI is green.
2. Move completed entries from `Unreleased` to the intended version in `CHANGELOG.md`.
3. Update `package.json#version` and create a focused release commit.
4. Run `pnpm check`, `pnpm audit --prod`, and `npm pack --dry-run --json`.
5. Confirm the npm account and package name with `npm whoami` and `npm view scoutpi-workbench`.
6. Publish explicitly with `npm publish --access public` from a reviewed release commit.
7. Verify `npm view scoutpi-workbench version dist.integrity`.
8. Verify the package appears in `https://pi.dev/packages?name=scoutpi-workbench`.
9. Install it in a clean Pi profile and repeat the RPC smoke before tagging the release.

After publication, operator commands are:

```bash
pi -e npm:scoutpi-workbench
pi install npm:scoutpi-workbench
pi update npm:scoutpi-workbench
pi remove npm:scoutpi-workbench
```

## Security Decision

Pi packages run with the current user's system access. A gallery listing is therefore not an authorization mechanism. Operators must review source, package contents and requested runtime integrations before installation. ScoutPi never self-publishes, self-installs, or changes package configuration through the Workbench.

Primary references:

- [Pi package documentation](https://pi.dev/docs/latest/packages)
- [Pi package catalog](https://pi.dev/packages)
