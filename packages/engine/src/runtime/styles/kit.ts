/**
 * What an art style gives the runtime and a template (game-runtime.md §10).
 * One interface for every style, two halves, every member optional:
 *
 *  - render hooks, applied by createRenderStack({ style }) (render/stack.ts
 *    is the one place that looks a style up): `stack`/`look` presets, and
 *    `attach`, a per-renderer session that may wrap or replace the frame,
 *    add post stages, and reshade particles;
 *  - world builders a template asks for (`field`, `pillar`, `shape`...).
 *
 * A template draws anything a kit leaves out its own way, so a style can
 * grow one piece at a time and a template never breaks on a missing piece.
 */
import type { BufferGeometry, Camera, Material, Node, Object3D, PassNode, Scene, Texture, UniformNode, Vector2, WebGPURenderer } from "three/webgpu";
import type { RendererHandle } from "../renderer.js";
import type { Atmosphere } from "../render/atmosphere.js";
import type { ParticleShade } from "../render/particles.js";
import type { PostFX } from "../render/post.js";
import type { Look, LookPreset } from "../render/presets.js";
import type { QualityTier } from "../render/quality.js";
import type { RenderStackOptions } from "../render/stack.js";

/** Words a template passes so one kit can dress different places: "meadow" (EMBERWATCH's night field), "yard" (VOLTYARD's lot). */
export type WorldTheme = string;

/** The play field: a square of half size `half` m with a wall `wallHeight` tall, and `outside` m of dressed ground past it. */
export interface FieldSpec {
  readonly half: number;
  readonly wallHeight: number;
  readonly outside: number;
  readonly theme: WorldTheme;
  /** Draw the wall (default true). */
  readonly wall?: boolean;
  /** Pillars standing in the field, so ground clutter keeps clear of them. */
  readonly pillars?: readonly PillarSpec[];
}

/** One pillar or post (sim metres). */
export interface PillarSpec {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

/** A pillar as drawn: its body (own material, so the template can fade it), the pieces on top, and where its flame burns (null: none). */
export interface StyledPillar {
  readonly body: Object3D;
  readonly fade: readonly Material[];
  readonly top: readonly Object3D[];
  readonly flame: readonly [number, number, number] | null;
}

/** A shape a template draws instanced (bolts, blades, chunks, props). */
export interface StyleShape {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

/** Template machinery shapes a style may redraw. */
export type StyleShapeName = "bolt" | "lance" | "blade" | "pellet" | "shard" | "chunk" | "rock" | "stump" | "barrel" | "crate" | "lantern" | "flame";

/** Overrides for the render stack under one look preset, plus the style's opinion on sun shadows. */
export interface StyleStack extends Partial<Pick<RenderStackOptions, "lighting" | "atmosphere" | "grade" | "makeParticles">> {
  /** Sun shadows suit the style (a template may still turn them off for speed). */
  readonly shadows?: boolean;
}

/** What a style's session is attached to (one renderer, one scene). */
export interface StyleContext {
  readonly handle: RendererHandle;
  readonly renderer: WebGPURenderer;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly tier: QualityTier;
  /** The look preset in use. */
  readonly preset: LookPreset;
  /** The stack's post (grade, hurt pulse, vignette), when there is one. */
  readonly post?: PostFX;
  /** The stack's fog and sky, when there is one. */
  readonly atmosphere?: Atmosphere;
  /** Library id to URL (the template's LibraryClient), for the style's own textures. Absent or null: no library, use fallbacks. */
  readonly resolve?: (id: string) => string | null;
}

/** What the post stages can read: the scene pass, sampleable at any uv. */
export interface StylePostInput {
  /** Scene colour (linear HDR) as a texture node: `.sample(uv)` reads a neighbour. */
  readonly color: Node<"vec4"> & { sample(uv: Node<"vec2">): Node<"vec4"> };
  /** Scene depth (0..1 perspective depth) as a texture node. */
  readonly depth: Node<"vec4"> & { sample(uv: Node<"vec2">): Node<"vec4"> };
  /** One render pixel in uv units. */
  readonly texel: UniformNode<"vec2", Vector2>;
  readonly near: UniformNode<"float", number>;
  readonly far: UniformNode<"float", number>;
}

/** Post-graph hooks, in graph order: called whenever the post stack rebuilds its node graph. */
export interface StylePost {
  /** Configure the scene pass before anything samples it (extra MRT outputs, draw hooks). */
  scenePass?(pass: PassNode): void;
  /** HDR stage before bloom and grade: the colour to use instead of the scene pass. */
  scene?(input: StylePostInput): Node<"vec4">;
  /** Change the HDR colour (after bloom and outline, before the grade). */
  color?(rgb: Node<"vec3">, pass: PassNode): Node<"vec3">;
  /** Display stage, after tone mapping (sRGB 0..1): lines, paper, print. */
  display?(color: Node<"vec4">, input: StylePostInput): Node<"vec4">;
}

/** What a ground decal's look can read (GroundDecals). */
export interface DecalLookInput {
  readonly uv: Node<"vec2">;
  /** Radius from the centre, 0..1 at the quad's edge. */
  readonly r: Node<"float">;
  /** Angle around the centre, radians, with the decal's random seed added. */
  readonly angle: Node<"float">;
  /** 0 scorch, 1 splat, 2 ring. */
  readonly kind: Node<"float">;
  /** 0 at birth, 1 at the end of its life. */
  readonly t: Node<"float">;
  readonly color: Node<"vec3">;
  /** The engine's own shape mask, 0..1 (for styles that keep the shapes). */
  readonly shape: Node<"float">;
  /** Peak opacity times alive. */
  readonly opacity: Node<"float">;
}

/** What a shockwave ring's look can read (GroundRings). */
export interface RingLookInput {
  readonly uv: Node<"vec2">;
  readonly r: Node<"float">;
  readonly t: Node<"float">;
  readonly alive: Node<"float">;
  readonly color: Node<"vec3">;
}

/** A decal or ring look's answer: colour and opacity nodes, and the blend to draw with. */
export interface LookOutput {
  readonly color: Node<"vec3">;
  readonly opacity: Node<"float">;
  readonly blending?: "add" | "normal";
}

export type DecalLook = (n: DecalLookInput) => LookOutput;
export type RingLook = (n: RingLookInput) => LookOutput;

/**
 * Surfaces templates build themselves and may ask the style for: ground
 * (a natural field), floor (paving), wall, stone, and glow (a pool of
 * light on the ground, white with alpha, which the template tints).
 */
export type SurfaceKind = "ground" | "floor" | "wall" | "stone" | "glow";

export interface SurfaceOptions {
  /** Metres one repeat of the texture covers (the template sets repeat). */
  readonly tile?: number;
  /** A hint at what the place is ("forest field", "power yard"). */
  readonly mood?: string;
}

/** One style attached to one renderer and scene (StyleKit.attach). */
export interface StyleSession {
  /** Draw a frame in the style: `draw` is the stack's own render (post or straight to the canvas). Omitted: the stack draws. */
  render?(draw: () => void): void;
  /** Post stages (the stack keeps post on at every tier when the kit says `needsPost`). */
  readonly post?: StylePost;
  /** Shapes and colours for the GPU particles (sparks, puffs, stars). */
  readonly particles?: ParticleShade;
  /** Shading for ground decals (scorches, splats) and shockwave rings. */
  readonly decals?: DecalLook;
  readonly rings?: RingLook;
  /** Every frame, before drawing (real seconds since the page opened). */
  frame?(seconds: number): void;
  /** The game switched look preset. */
  setPreset?(preset: LookPreset): void;
  /** A texture for a template-built surface, or null to keep the template's own. */
  surface?(kind: SurfaceKind, opts?: SurfaceOptions): Texture | null;
  /** The render size in device pixels changed. */
  setSize?(width: number, height: number): void;
  /** The quality tier changed. */
  setQuality?(tier: QualityTier): void;
  dispose(): void;
}

export interface StyleKit {
  readonly id: string;
  /** Render stack overrides for a look preset (merged over `look`, under the template's own options). */
  stack?(preset: LookPreset): StyleStack;
  /** The style's whole version of a look preset: lighting, atmosphere and grade together. */
  look?(preset: LookPreset): Look;
  /** The style's picture lives in post: keep post on at the low tier (without bloom). */
  readonly needsPost?: boolean;
  /** Bloom by default in this style (a game's `look.bloom` still wins). Default true. */
  readonly bloom?: boolean;
  /** false: the style draws its own lines, so the stack's outline stays off. */
  readonly outline?: boolean;
  /** Attach the style to a renderer and scene: draw-time materials, post stages, particle look. */
  attach?(ctx: StyleContext): StyleSession;
  /** The field's floor, the dressed ground past it, and its wall. Add the result to the scene. */
  field?(spec: FieldSpec): Object3D[];
  /** Height of the style's ground at (x, z) for a field built by `field`, so scenery past the wall stands on it. */
  groundHeight?(spec: FieldSpec, x: number, z: number): number;
  /** One pillar. */
  pillar?(spec: PillarSpec, theme: WorldTheme, index: number): StyledPillar;
  /** A template machinery shape in the style, or null to keep the template's own. */
  shape?(name: StyleShapeName): StyleShape | null;
}
