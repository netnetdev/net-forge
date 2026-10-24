# Contributing to Net Forge

Thank you for helping. Issues and pull requests are welcome here.

## How changes land

This repository is exported from NetNet's internal repository, which stays
the source of truth for the packages. Each export is one commit.

- **Issues** are read and answered here.
- **Pull requests** are reviewed here. An accepted change is applied
  upstream and comes back in the next export, so the pull request is closed
  with a link to the export commit that carries it, not merged directly.
  Your authorship is credited in that commit message.

## Before you open a pull request

Needs Node 22 and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

- Keep a change to one package where you can, with a test that fails
  without it.
- Game templates: change `src/game.ts` through the public API in
  `@netforge/engine` and keep the template's playtest (`test/harness.test.ts`)
  passing.
- Asset library entries must be CC0 and credited in the package NOTICE.
- Write docs and errors in plain, complete sentences.

## Good first places to help

- A clearer error message from the engine's declaration validators.
- A missing example in a package's `llms.txt`.
- A bug in `kit play` on your platform (Windows, Linux, a browser).

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
