---
name: netforge-add-content
description: Add or change content in a Net Forge game's src/game.ts, such as a new enemy, weapon, upgrade, earn rule, store item or spawn pacing. Use when the user asks to add an enemy, a boss, a weapon, a power-up, a reward or to rebalance a Net Forge game.
---

# Add content to a Net Forge game

All content is declared in `src/game.ts` with functions imported from
`@netforge/engine`. Look up any declaration before using it:
`netforge_explain_api { "name": "weapon" }` or
`netforge_search_docs { "query": "spawn director curves" }`.

## Common declarations (action templates)

```ts
import { earn, prefab, weapon } from "@netforge/engine";

// An enemy. model is an asset library id, never a URL.
prefab("brute", { model: "style.lowpoly.orc_brute", health: 160, speed: 2.2, radius: 0.8, damage: 18, ai: "tank", mass: 6, drops: ["ember_mid"] });

// A weapon that fires by itself, with level-up steps.
weapon("spark_bolt", { kind: "bolt", damage: 14, cooldown: 0.6, range: 14, speed: 24, pierce: 1, knockback: 2,
  levels: [{ count: 1 }, { damage: "+40%" }, { cooldown: "-20%" }] });

// A reward: pays when the event happens n times in a run.
earn.rule("first_light", { when: "wave.cleared", n: 2, pay: 5, oncePer: "run" });
```

Board templates (tower defense, idle, cards, collector) use their own
declarations, such as `tower(...)`, `waves(...)`, `plant(...)`, `card(...)`,
`creature(...)` and `move(...)`. Read the template's own `src/game.ts` for
the pattern and copy it.

## Checklist

1. New ids are lower_snake_case and unique per kind.
2. Anything an enemy drops is a declared pickup prefab.
3. A new enemy appears only when the spawn `director({ pool })` (or the
   template's own spawner) names it.
4. Run `netforge_validate_game` and fix every error it returns; each error
   has the likely line and a hint.
5. Run `netforge_run_playtest` and act on its findings.

Docs: https://forge.netnet.capital/docs
