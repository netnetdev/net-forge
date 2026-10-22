/**
 * Tray icons: one small line drawing per weapon kind and passive stat, so
 * the ability tray reads at a glance instead of as two-letter codes. Data
 * driven (by kind and stat), so a generated game's weapons get icons too.
 * 24x24 viewBox, stroked in currentColor.
 */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const WEAPON_ICONS: Readonly<Record<string, string>> = {
  // A burst: a ring with rays.
  nova: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'),
  // A field you carry: two rings.
  aura: svg('<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="4"/>'),
  // Shots: an arrow.
  bolt: svg('<path d="M4 20L18 6M11 6h7v7"/>'),
  // Blades around you: a dot on an orbit.
  orbit: svg('<circle cx="12" cy="12" r="7"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/><circle cx="5" cy="12" r="2.2" fill="currentColor"/>'),
  // A sweep: a fan.
  cone: svg('<path d="M12 20L4 8a11 11 0 0 1 16 0z"/>'),
  // Lightning between enemies.
  chain: svg('<path d="M13 2L6 13h5l-1 9 8-12h-5z"/>'),
  // A falling star.
  meteor: svg('<path d="M3 3l8 8M7 3l6 6M3 7l6 6"/><circle cx="16" cy="16" r="5"/>'),
  // Out and back.
  boomerang: svg('<path d="M5 19c0-8 6-14 14-14-4 3-6 6-6 9 3 0 6-2 6-2-2 5-8 7-14 7z"/>'),
};

export const STAT_ICONS: Readonly<Record<string, string>> = {
  speed: svg('<path d="M4 7h7M2 12h9M4 17h7M13 6l6 6-6 6"/>'),
  maxHealth: svg('<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'),
  magnet: svg('<path d="M6 4v8a6 6 0 0 0 12 0V4M6 8h4M14 8h4"/>'),
  might: svg('<path d="M12 3c2 4-2 5 0 9 1-2 3-2 3-4 2 3 2 9-3 11-5-2-6-7-3-11 0 2 1 3 2 3-1-3 1-6 1-8z"/>'),
  haste: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>'),
  regen: svg('<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="10" stroke-dasharray="2 3"/>'),
  armor: svg('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>'),
  area: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="2"/>'),
  amount: svg('<rect x="3" y="9" width="10" height="10" rx="2"/><path d="M8 5h11v11"/>'),
};

/** Fallback when a kind or stat has no drawing: a plain dot. */
export const DOT_ICON = svg('<circle cx="12" cy="12" r="4" fill="currentColor"/>');
