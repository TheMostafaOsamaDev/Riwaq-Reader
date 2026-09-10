# Contributing to Riwaq

Thanks for taking a look. This file is the short version — what to run, and the
few conventions that are not obvious from reading the code.

Toolchain setup (Rust, Android SDK, platform packages) lives in
[`docs/setup.md`](docs/setup.md). Module boundaries and data flow live in
[`docs/architecture.md`](docs/architecture.md).

## Getting set up

```bash
pnpm install
pnpm tauri dev      # desktop, with Vite HMR
pnpm android:dev    # Android, on a device or emulator
```

If `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, you are on pnpm 10 or
newer and missing the esbuild build-script approval. Use pnpm 9, which is what
CI pins.

## Before you push

```bash
pnpm check
```

That is format, lint, typecheck, build and tests — the same four things CI
runs, in the same order, so a green `pnpm check` means a green PR. Individually:

| Command | What it does |
| --- | --- |
| `pnpm format` | Rewrites files to the house style (Biome) |
| `pnpm lint` | Static checks beyond what the typechecker sees |
| `pnpm build` | `tsc` then `vite build` — this is the typecheck |
| `pnpm test` | Vitest, ~450 tests, about a second |

Rust changes also want `cargo check --all-targets` inside `src-tauri/`.

## Code style

Formatting is not a matter of taste here — [Biome](https://biomejs.dev) decides,
and CI enforces it. Install the Biome editor extension (VS Code will offer it;
the settings in `.vscode/` turn on format-on-save) and you will never think
about it again. If a diff shows up that is only whitespace, you have not run the
formatter.

`biome.json` also turns several lint rules **off**, each with a comment saying
why. Those are a backlog, not a standard — if you are fixing one of those
categories properly, turning the rule back on in the same PR is welcome.

Two conventions the tools cannot check for you:

- **Layers.** Never write a bare `z-index`. Take a name from `Z` (app-wide) or
  `Z_LOCAL` (ordering inside one component) in `src/styles/tokens.ts`. A test
  fails the build if a literal appears anywhere in `src/`.
- **Logical properties.** Use `margin-inline-start`, not `margin-left`. The app
  ships an Arabic RTL interface, and this is the part that makes it work
  structurally rather than by patching. There are currently zero physical
  left/right properties in the CSS; keep it that way.

## Translations

`src/i18n/ar.ts` is typed against `Messages`, so a missing or renamed key is a
compile error rather than an English string leaking into the Arabic UI. Add
your key to `en.ts` first and let `tsc` tell you what else to fill in.

## Commits

Conventional-commit prefixes (`feat:`, `fix:`, `refactor:`, `docs:`, …). Say
what changed and why it changed; the diff already says how.

Large mechanical commits — a formatter run, a bulk rename — go in on their own,
never mixed with a behavioural change, and get added to
`.git-blame-ignore-revs`. To make your local `git blame` respect that file:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

GitHub's web UI reads it without any setup.

## Tests

The suite is fast and covers the stores, parsers and geometry helpers. React
components are largely untested, so a change to one is carried by `tsc` and by
running the app. If you are restructuring a component's state rather than
moving it, a test first is worth the time.
