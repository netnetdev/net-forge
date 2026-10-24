# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue: on this
repository, open Security, then Report a vulnerability. Include the package
and version, what an attacker can do, and the steps to reproduce it.

You will get an answer within 3 working days. Fixes are made upstream and
published in the next export and npm release, and the advisory credits you
unless you ask otherwise.

## Supported versions

Only the latest published version of each `@netforge/*` package gets
security fixes.

## Scope

In scope: the packages in this repository, including the local room host in
`@netforge/kit-play`, the MCP server in `@netforge/mcp` and the `netforge`
command line.

Things that are by design, not vulnerabilities:

- `kit play` runs a game's own code on your computer with your
  permissions. Run only game code you trust.
- `netforge_validate_game` and `netforge_run_playtest` run it in a Node
  process held by Node's permission model (no file writes, no reads outside
  its own bundle, no child processes or workers) with an environment that
  carries no keys or tokens, a heap cap and a time limit. It still has the
  network, so it is a guard rail, not a VM. A way out of those limits is in
  scope.
- `kit play` binds to 127.0.0.1 unless you pass `--host`.

The hosted Net Forge services are not part of this repository; report
problems with them the same way and they are routed to the right team.
