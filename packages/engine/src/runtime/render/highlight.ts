/**
 * Make one character pop off the scene (the local hero, a selected unit):
 * an inverted-hull outline and an additive rim glow, both as extra draws
 * that share each mesh's geometry (and skeleton, so they follow the
 * animation). The character's own materials are never touched, so a model
 * shared with teammates stays as it was.
 *
 *   const hl = new HeroHighlight(character.root, { rim: "#ffe6a8", outline: "#1a0f05" });
 *   hl.strength = 0.5;   // fade it (iframes, downed)
 *   hl.dispose();        // remove the extra draws
 */
import { isSprite } from "./sprite.js";
import { AdditiveBlending, BackSide, Color, FrontSide, Mesh, MeshBasicNodeMaterial, SkinnedMesh } from "three/webgpu";
import type { ColorRepresentation, Object3D } from "three/webgpu";
import { abs, dot, float, normalLocal, normalView, positionLocal, positionViewDirection, pow, uniform, vec3 } from "three/tsl";

export interface HeroHighlightOptions {
  /** Rim glow colour, or null for none. Default warm white. */
  readonly rim?: ColorRepresentation | null;
  /** Rim brightness. Default 1.6 (bloom picks it up above 1). */
  readonly rimStrength?: number;
  /** Rim falloff exponent: higher is a thinner edge. Default 2.4. */
  readonly rimPower?: number;
  /** Outline colour, or null for none. Default near-black. */
  readonly outline?: ColorRepresentation | null;
  /** Outline thickness in metres (world). Default 0.03. */
  readonly outlineWidth?: number;
}

/** Product of the scales from `mesh` up to and including `root` (world size of one local unit). */
function scaleTo(mesh: Object3D, root: Object3D): number {
  let s = 1;
  for (let o: Object3D | null = mesh; o; o = o.parent) {
    s *= Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z)) || 1;
    if (o === root) break;
  }
  return s;
}

export class HeroHighlight {
  /** The extra draws (outline hulls and rim shells), for tests and counting. */
  readonly parts: Mesh[] = [];
  private readonly rimStrength = uniform(1);
  private base: number;

  constructor(
    readonly root: Object3D,
    opts: HeroHighlightOptions = {},
  ) {
    const rim = opts.rim === undefined ? "#fff1cc" : opts.rim;
    const outline = opts.outline === undefined ? "#120a04" : opts.outline;
    const width = opts.outlineWidth ?? 0.03;
    this.base = opts.rimStrength ?? 1.6;
    this.rimStrength.value = this.base;
    const meshes: Mesh[] = [];
    root.traverse((o) => {
      // Sprites (render/sprite.ts) draw their own 1 px rim; a hull around a flat quad would cover it.
      if ((o as Mesh).isMesh && !isSprite((o as Mesh).geometry)) meshes.push(o as Mesh);
    });
    const outlineColor = outline === null ? null : new Color(outline);
    const rimColor = rim === null ? null : new Color(rim);
    const facing = abs(dot(normalView, positionViewDirection));
    const edge = pow(float(1).sub(facing), opts.rimPower ?? 2.4);
    for (const mesh of meshes) {
      // Widths are world metres; each mesh inflates in its own local units.
      const unit = scaleTo(mesh, root);
      const made: [Mesh, string][] = [];
      if (outlineColor) {
        const m = new MeshBasicNodeMaterial({ side: BackSide });
        m.colorNode = vec3(outlineColor.r, outlineColor.g, outlineColor.b);
        m.positionNode = positionLocal.add(normalLocal.mul(float(width / unit)));
        made.push([this.extra(mesh, m), "HeroOutline"]);
      }
      if (rimColor) {
        const m = new MeshBasicNodeMaterial({ side: FrontSide, transparent: true, depthWrite: false, blending: AdditiveBlending });
        m.colorNode = vec3(rimColor.r, rimColor.g, rimColor.b).mul(edge).mul(this.rimStrength);
        m.positionNode = positionLocal.add(normalLocal.mul(float(0.003 / unit)));
        made.push([this.extra(mesh, m), "HeroRim"]);
      }
      for (const [extra, name] of made) {
        extra.name = name;
        // The outline draws before the body, the rim after it.
        extra.renderOrder = name === "HeroOutline" ? -1 : 1;
        mesh.add(extra);
        this.parts.push(extra);
      }
    }
  }

  /** A draw of `mesh`'s geometry (and skeleton) with another material, as its child at identity. */
  private extra(mesh: Mesh, material: MeshBasicNodeMaterial): Mesh {
    let extra: Mesh;
    if ((mesh as SkinnedMesh).isSkinnedMesh === true) {
      const s = mesh as SkinnedMesh;
      const e = new SkinnedMesh(mesh.geometry, material);
      e.bindMode = s.bindMode;
      e.bind(s.skeleton, s.bindMatrix);
      extra = e;
    } else extra = new Mesh(mesh.geometry, material);
    extra.castShadow = false;
    extra.receiveShadow = false;
    extra.frustumCulled = false;
    return extra;
  }

  /** 0..1 fade on top of the rim strength and outline (0 hides both). */
  set strength(v: number) {
    const k = Math.max(0, Math.min(1, v));
    this.rimStrength.value = this.base * k;
    for (const p of this.parts) if (p.name === "HeroOutline") p.visible = k > 0.05;
  }

  /** Show or hide every extra draw. */
  set visible(v: boolean) {
    for (const p of this.parts) p.visible = v;
  }

  dispose(): void {
    for (const p of this.parts) {
      p.removeFromParent();
      (p.material as MeshBasicNodeMaterial).dispose();
    }
    this.parts.length = 0;
  }
}
