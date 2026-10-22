/**
 * The example gallery: ready-made looks per style, each a library model and an optional
 * appearance, with a name, a short line and a thumbnail (rendered by `pnpm shoot thumbs`).
 * The Launcher shows these as "pick a starting look". Plain data with no imports, so the
 * Launcher can bundle it without the rest of the library; library.ts validates it.
 */
export interface GalleryItem {
  readonly id: string;
  readonly name: string;
  readonly line: string;
  readonly model: string;
  readonly appearance?: { readonly tint?: string; readonly accent?: string; readonly scale?: number; readonly parts?: readonly string[] };
  readonly thumb: string;
}

export const GALLERY: Readonly<Record<string, readonly GalleryItem[]>> = {
  lowpoly: [
    {
      id: "wayfinder",
      name: "Wayfinder",
      line: "Explorer with a pack",
      model: "style.lowpoly.adventurer",
      thumb: "thumbs/lowpoly/wayfinder.png"
    },
    {
      id: "trooper",
      name: "Trooper",
      line: "Armored rifle hero",
      model: "style.lowpoly.soldier",
      thumb: "thumbs/lowpoly/trooper.png"
    },
    {
      id: "townie",
      name: "Townie",
      line: "Small cartoon hero",
      model: "style.lowpoly.mini_female_a",
      thumb: "thumbs/lowpoly/townie.png"
    },
    {
      id: "monarch",
      name: "Monarch",
      line: "Crowned ruler",
      model: "style.lowpoly.monarch",
      thumb: "thumbs/lowpoly/monarch.png"
    },
    {
      id: "gloop",
      name: "Gloop",
      line: "Grinning green slime",
      model: "style.lowpoly.slime_green",
      thumb: "thumbs/lowpoly/gloop.png"
    },
    {
      id: "wisp",
      name: "Wisp",
      line: "Floating sheet ghost",
      model: "style.lowpoly.ghost",
      thumb: "thumbs/lowpoly/wisp.png"
    },
    {
      id: "ember_whelp",
      name: "Ember Whelp",
      line: "Small winged dragon",
      model: "style.lowpoly.dragon_whelp",
      appearance: {
        tint: "#ff7a3d"
      },
      thumb: "thumbs/lowpoly/ember_whelp.png"
    },
    {
      id: "cap_lord",
      name: "Cap Lord",
      line: "Giant mushroom boss",
      model: "style.lowpoly.mushroom_king",
      thumb: "thumbs/lowpoly/cap_lord.png"
    },
    {
      id: "static_fox",
      name: "Static Fox",
      line: "Blue fox with a charge",
      model: "style.lowpoly.shiba",
      appearance: {
        tint: "#5ec8ff",
        parts: [
          "antenna",
          "tail_bolt"
        ]
      },
      thumb: "thumbs/lowpoly/static_fox.png"
    },
    {
      id: "bolt_walker",
      name: "Bolt Walker",
      line: "Walking robot",
      model: "style.lowpoly.robot_walker",
      thumb: "thumbs/lowpoly/bolt_walker.png"
    },
    {
      id: "horned_brute",
      name: "Horned Brute",
      line: "Red demon brute",
      model: "style.lowpoly.demon",
      thumb: "thumbs/lowpoly/horned_brute.png"
    },
    {
      id: "big_wheel",
      name: "Big Wheel",
      line: "Truck on giant wheels",
      model: "style.lowpoly.monster_truck",
      thumb: "thumbs/lowpoly/big_wheel.png"
    },
    {
      id: "iron_tortoise",
      name: "Iron Tortoise",
      line: "Tracked battle tank",
      model: "style.lowpoly.tank",
      thumb: "thumbs/lowpoly/iron_tortoise.png"
    },
    {
      id: "sprint",
      name: "Sprint",
      line: "Open-wheel racer",
      model: "style.lowpoly.race_car",
      thumb: "thumbs/lowpoly/sprint.png"
    },
    {
      id: "hover_speeder",
      name: "Hover Speeder",
      line: "Hovering scout ship",
      model: "style.lowpoly.speeder_a",
      thumb: "thumbs/lowpoly/hover_speeder.png"
    },
    {
      id: "crystal",
      name: "Crystal",
      line: "Big glowing crystal",
      model: "style.lowpoly.crystal",
      thumb: "thumbs/lowpoly/crystal.png"
    }
  ],
  pixel: [
    {
      id: "knight",
      name: "Knight",
      line: "Armored hero",
      model: "style.pixel.knight",
      thumb: "thumbs/pixel/knight.png"
    },
    {
      id: "wizard",
      name: "Wizard",
      line: "Purple-robed caster",
      model: "style.pixel.wizard",
      thumb: "thumbs/pixel/wizard.png"
    },
    {
      id: "slime",
      name: "Slime",
      line: "Green slime",
      model: "style.pixel.slime",
      thumb: "thumbs/pixel/slime.png"
    },
    {
      id: "ghost",
      name: "Ghost",
      line: "Floating ghost",
      model: "style.pixel.ghost",
      thumb: "thumbs/pixel/ghost.png"
    },
    {
      id: "astronaut",
      name: "Astronaut",
      line: "Green space hero",
      model: "style.pixel.astro_green",
      thumb: "thumbs/pixel/astronaut.png"
    },
    {
      id: "tank_bot",
      name: "Tank Bot",
      line: "Blue robot",
      model: "style.pixel.tank_bot",
      thumb: "thumbs/pixel/tank_bot.png"
    },
    {
      id: "sports_car",
      name: "Sports Car",
      line: "Red racer",
      model: "style.pixel.sports_car",
      thumb: "thumbs/pixel/sports_car.png"
    },
    {
      id: "chest",
      name: "Chest",
      line: "Treasure chest",
      model: "style.pixel.chest",
      thumb: "thumbs/pixel/chest.png"
    }
  ],
  ps1: [
    {
      id: "wayfinder",
      name: "Wayfinder",
      line: "Explorer with a pack",
      model: "style.ps1.adventurer",
      thumb: "thumbs/ps1/wayfinder.png"
    },
    {
      id: "trooper",
      name: "Trooper",
      line: "Armored rifle hero",
      model: "style.ps1.soldier",
      thumb: "thumbs/ps1/trooper.png"
    },
    {
      id: "townie",
      name: "Townie",
      line: "Small cartoon hero",
      model: "style.ps1.mini_female_a",
      thumb: "thumbs/ps1/townie.png"
    },
    {
      id: "monarch",
      name: "Monarch",
      line: "Crowned ruler",
      model: "style.ps1.monarch",
      thumb: "thumbs/ps1/monarch.png"
    },
    {
      id: "gloop",
      name: "Gloop",
      line: "Grinning green slime",
      model: "style.ps1.slime_green",
      thumb: "thumbs/ps1/gloop.png"
    },
    {
      id: "wisp",
      name: "Wisp",
      line: "Floating sheet ghost",
      model: "style.ps1.ghost",
      thumb: "thumbs/ps1/wisp.png"
    },
    {
      id: "ember_whelp",
      name: "Ember Whelp",
      line: "Small winged dragon",
      model: "style.ps1.dragon_whelp",
      appearance: {
        tint: "#ff7a3d"
      },
      thumb: "thumbs/ps1/ember_whelp.png"
    },
    {
      id: "cap_lord",
      name: "Cap Lord",
      line: "Giant mushroom boss",
      model: "style.ps1.mushroom_king",
      thumb: "thumbs/ps1/cap_lord.png"
    },
    {
      id: "static_fox",
      name: "Static Fox",
      line: "Blue fox with a charge",
      model: "style.ps1.shiba",
      appearance: {
        tint: "#5ec8ff",
        parts: [
          "antenna",
          "tail_bolt"
        ]
      },
      thumb: "thumbs/ps1/static_fox.png"
    },
    {
      id: "bolt_walker",
      name: "Bolt Walker",
      line: "Walking robot",
      model: "style.ps1.robot_walker",
      thumb: "thumbs/ps1/bolt_walker.png"
    },
    {
      id: "horned_brute",
      name: "Horned Brute",
      line: "Red demon brute",
      model: "style.ps1.demon",
      thumb: "thumbs/ps1/horned_brute.png"
    },
    {
      id: "big_wheel",
      name: "Big Wheel",
      line: "Truck on giant wheels",
      model: "style.ps1.monster_truck",
      thumb: "thumbs/ps1/big_wheel.png"
    },
    {
      id: "iron_tortoise",
      name: "Iron Tortoise",
      line: "Tracked battle tank",
      model: "style.ps1.tank",
      thumb: "thumbs/ps1/iron_tortoise.png"
    },
    {
      id: "sprint",
      name: "Sprint",
      line: "Open-wheel racer",
      model: "style.ps1.race_car",
      thumb: "thumbs/ps1/sprint.png"
    },
    {
      id: "hover_speeder",
      name: "Hover Speeder",
      line: "Hovering scout ship",
      model: "style.ps1.speeder_a",
      thumb: "thumbs/ps1/hover_speeder.png"
    },
    {
      id: "crystal",
      name: "Crystal",
      line: "Big glowing crystal",
      model: "style.ps1.crystal",
      thumb: "thumbs/ps1/crystal.png"
    }
  ],
  voxel: [
    {
      id: "wayfinder",
      name: "Wayfinder",
      line: "Explorer with a pack",
      model: "style.voxel.adventurer",
      thumb: "thumbs/voxel/wayfinder.png"
    },
    {
      id: "trooper",
      name: "Trooper",
      line: "Armored rifle hero",
      model: "style.voxel.soldier",
      thumb: "thumbs/voxel/trooper.png"
    },
    {
      id: "townie",
      name: "Townie",
      line: "Small cartoon hero",
      model: "style.voxel.mini_female_a",
      thumb: "thumbs/voxel/townie.png"
    },
    {
      id: "monarch",
      name: "Monarch",
      line: "Crowned ruler",
      model: "style.voxel.monarch",
      thumb: "thumbs/voxel/monarch.png"
    },
    {
      id: "gloop",
      name: "Gloop",
      line: "Grinning green slime",
      model: "style.voxel.slime_green",
      thumb: "thumbs/voxel/gloop.png"
    },
    {
      id: "wisp",
      name: "Wisp",
      line: "Floating sheet ghost",
      model: "style.voxel.ghost",
      thumb: "thumbs/voxel/wisp.png"
    },
    {
      id: "ember_whelp",
      name: "Ember Whelp",
      line: "Small winged dragon",
      model: "style.voxel.dragon_whelp",
      appearance: {
        tint: "#ff7a3d"
      },
      thumb: "thumbs/voxel/ember_whelp.png"
    },
    {
      id: "cap_lord",
      name: "Cap Lord",
      line: "Giant mushroom boss",
      model: "style.voxel.mushroom_king",
      thumb: "thumbs/voxel/cap_lord.png"
    },
    {
      id: "static_fox",
      name: "Static Fox",
      line: "Blue fox with a charge",
      model: "style.voxel.shiba",
      appearance: {
        tint: "#5ec8ff",
        parts: [
          "antenna",
          "tail_bolt"
        ]
      },
      thumb: "thumbs/voxel/static_fox.png"
    },
    {
      id: "bolt_walker",
      name: "Bolt Walker",
      line: "Walking robot",
      model: "style.voxel.robot_walker",
      thumb: "thumbs/voxel/bolt_walker.png"
    },
    {
      id: "horned_brute",
      name: "Horned Brute",
      line: "Red demon brute",
      model: "style.voxel.demon",
      thumb: "thumbs/voxel/horned_brute.png"
    },
    {
      id: "iron_tortoise",
      name: "Iron Tortoise",
      line: "Tracked battle tank",
      model: "style.voxel.tank",
      thumb: "thumbs/voxel/iron_tortoise.png"
    },
    {
      id: "sprint",
      name: "Sprint",
      line: "Open-wheel racer",
      model: "style.voxel.race_car",
      thumb: "thumbs/voxel/sprint.png"
    },
    {
      id: "hover_speeder",
      name: "Hover Speeder",
      line: "Hovering scout ship",
      model: "style.voxel.speeder_a",
      thumb: "thumbs/voxel/hover_speeder.png"
    },
    {
      id: "crystal",
      name: "Crystal",
      line: "Big glowing crystal",
      model: "style.voxel.crystal",
      thumb: "thumbs/voxel/crystal.png"
    }
  ]
};
