# @netforge/tabletop

The shared client kit for the Net Forge board-style game templates (tower defense, idle, card battler and monster collector): the room connection and input clock for rules genres, the styled 3D stage, the store, stake and gear wiring, and the HUD shell.

## Install

```sh
npm install @netforge/tabletop
```

Node 20 or later. The package ships TypeScript source (ES modules) for a bundler such as Vite. It is used by template clients (`@netforge/template-tower`, `template-idle`, `template-cards`, `template-collector`). Game code in `src/game.ts` never imports it.

## Example

A board template's client boots with one call. This is the shape the tower defense client uses:

```ts
import { bootBoard } from "@netforge/tabletop";
import { GAME_VERSION, PLACE, TEMPLATE, towerAdapter, towerManifest } from "@netforge/template-tower";

const app = await bootBoard({
  adapter: towerAdapter(),
  manifest: towerManifest(),
  template: TEMPLATE,
  place: PLACE,
  version: GAME_VERSION,
  labels: { title: "COGSPIRE", rules: {}, skus: {}, upgrades: {}, loading: "Winding the spire", help: "Click a tile to build" },
  theme, // HudTheme: accent, gold, ink, dim, panel, bg, font, display, radius
  coin: { name: "Cog", symbol: "COG", logo: null },
  cosmetics: {},
  swatch: () => "#c9a15a",
  ground: { w: 20, h: 12 },
  // plus the template's own draw, input and autopilot hooks (see BoardBootOptions)
});
```

## Key API

- `bootBoard(options)`: connects to the room, builds the stage and the HUD, and wires the store, stake and gear for a rules genre.
- `joinBoard(adapter, join)` and `InputClock`: the room connection and the input clock for rules genres; `roomsEndpoint(params)` picks the room server from the page URL.
- `BoardStage` and `fallbackShape`: the styled 3D stage and placeholder shapes.
- `Hud`, `wireStore`, `$` and `cssColor`: the HUD shell and store panel.
- `wireStake`, `wireGear`, `gearOf` and `wirePot`: the buy-in run, losable gear and pots.
- `mockKit`: the in-page store backend used for local play.
- `hostFlags`, `namedPlayer`, `onHostPlayer`, `postReady`, `storeNote`: how a page talks to the Net Forge studio or to kit play when it is embedded.

To run a board game locally, use `@netforge/kit-play`.

## Docs

- https://forge.netnet.capital/docs/packages/tabletop

## License

MIT. See `LICENSE` and `NOTICE`.
