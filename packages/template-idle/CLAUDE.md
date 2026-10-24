# CLAUDE.md

This package is BRINEWORKS, a Net Forge game template. Read AGENTS.md before changing this game. It lists the declarations this genre has, the rules the build enforces, and how to validate, playtest and play the game locally.

The five hard rules:

1. Edit only src/game.ts (and src/names.json for the labels players read).
2. Import only from @netforge/engine.
3. Ids are lower_snake_case.
4. Declare at least one earn.rule and exactly one earn.stake.
5. Never write renderers, netcode, physics or bot AI, and never reference assets by URL or file path (use library ids such as "style.lowpoly.frog").
