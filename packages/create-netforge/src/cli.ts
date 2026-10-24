#!/usr/bin/env node
// create-netforge [folder] [--template <id>] [--yes] [--pm npm|pnpm|yarn|bun] [--no-install] [--no-git] [--list] [--json]
// Reached as `npm create netforge@latest`, `npx create-netforge` and `kit-play new`.

import { nodeIo, runCreate } from "./main.js";

const code = await runCreate(process.argv.slice(2), nodeIo());
process.exit(code);
