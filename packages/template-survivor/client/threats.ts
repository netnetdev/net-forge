/**
 * Telegraphs and hostile shots (GAME-DESIGN.md "telegraph every big hit").
 * Every warning is a pooled ground decal that fills as the attack winds
 * up: a ring outline plus a filling disc for circles, an outlined lane
 * with a fill that grows along it for charges and aim lines, and a soft
 * dashed pulse for support auras. Shapes and fill carry the meaning, not
 * colour alone, so it reads for colour-blind players too. The data is the
 * snapshot's telegraph word (engine/game/threats.ts), so nothing extra is
 * sent.
 */
import {
  NormalBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
} from "three/webgpu";
import type { Scene } from "three/webgpu";
import type { ThreatShape } from "@netnetcapital/engine/game";

/** Danger reads warm and bright on the night palette; support reads cool. */
const DANGER = new Color(0xff5a3c);
const DANGER_EDGE = new Color(0xffe2b0);
const SUPPORT = new Color(0x6fd3ff);
/** A keeper's own meteor about to land. */
const FRIENDLY = new Color(0xffd36b);
const MAX_DECALS = 64;
const MAX_SHOTS = 160;

interface Decal {
  group: Group;
  fill: Mesh;
  edge: Mesh;
  laneFill: Mesh;
  laneEdge: Mesh;
}

const basic = (color: Color, opacity: number) =>
  // Normal blending: under the render stack's bloom, stacked additive warnings would wash the screen out.
  new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide, blending: NormalBlending, fog: false });

export class ThreatLayer {
  private readonly decals: Decal[] = [];
  private used = 0;
  private readonly shots: Mesh[] = [];
  private shotUsed = 0;
  private time = 0;

  constructor(scene: Scene) {
    const disc = new CircleGeometry(1, 40);
    disc.rotateX(-Math.PI / 2);
    const ring = new RingGeometry(0.94, 1, 48);
    ring.rotateX(-Math.PI / 2);
    // Lanes are unit squares starting at the origin and running along +x.
    const lane = new PlaneGeometry(1, 1);
    lane.rotateX(-Math.PI / 2);
    lane.translate(0.5, 0, 0);
    for (let i = 0; i < MAX_DECALS; i++) {
      const group = new Group();
      const fill = new Mesh(disc, basic(DANGER, 0.35));
      const edge = new Mesh(ring, basic(DANGER_EDGE, 0.9));
      const laneFill = new Mesh(lane, basic(DANGER, 0.4));
      const laneEdge = new Mesh(lane, basic(DANGER_EDGE, 0.16));
      group.add(fill, edge, laneFill, laneEdge);
      group.visible = false;
      scene.add(group);
      this.decals.push({ group, fill, edge, laneFill, laneEdge });
    }
    const orb = new SphereGeometry(0.28, 10, 8);
    const orbMat = new MeshBasicMaterial({ color: 0xff7a4a });
    for (let i = 0; i < MAX_SHOTS; i++) {
      const m = new Mesh(orb, orbMat);
      m.visible = false;
      scene.add(m);
      this.shots.push(m);
    }
  }

  /** Call before drawing a frame's threats. */
  begin(dt: number): void {
    this.time += dt;
    this.used = 0;
    this.shotUsed = 0;
  }

  /** Draw one warning (from engine/game threatOf). `friendly`: a keeper's own meteor, drawn gold. */
  draw(t: ThreatShape, friendly = false): void {
    if (t.shot) {
      const m = this.shots[this.shotUsed++];
      if (!m) return;
      m.position.set(t.x, 0.8, t.z);
      m.visible = true;
      return;
    }
    const d = this.decals[this.used++];
    if (!d) return;
    const g = d.group;
    g.visible = true;
    g.position.set(t.x, 0.07, t.z);
    g.rotation.set(0, 0, 0);
    const support = t.kind === "aura";
    const fillMat = d.fill.material as MeshBasicMaterial;
    const edgeMat = d.edge.material as MeshBasicMaterial;
    fillMat.color.copy(friendly ? FRIENDLY : support ? SUPPORT : DANGER);
    edgeMat.color.copy(friendly ? FRIENDLY : support ? SUPPORT : DANGER_EDGE);
    if (t.kind === "lane") {
      d.fill.visible = d.edge.visible = false;
      d.laneFill.visible = d.laneEdge.visible = true;
      const len = t.len ?? 6;
      const w = t.r * 2;
      g.rotation.y = -Math.atan2(t.dz ?? 0, t.dx ?? 1);
      // The fill grows down the lane: when it reaches the end, the charge goes.
      d.laneEdge.scale.set(len, 1, w);
      d.laneFill.scale.set(Math.max(0.05, len * t.progress), 1, w * 0.9);
      return;
    }
    d.laneFill.visible = d.laneEdge.visible = false;
    d.fill.visible = d.edge.visible = true;
    d.edge.scale.setScalar(t.r);
    // The disc fills from the centre out; a support pulse is a faint breathing ring (it warns, it does not hurt).
    const p = support ? 0.85 + 0.15 * Math.sin(this.time * 8) : t.progress;
    d.fill.scale.setScalar(Math.max(0.05, t.r * p));
    fillMat.opacity = support ? 0.05 : 0.18 + 0.22 * t.progress;
    edgeMat.opacity = support ? 0.25 : 0.9;
  }

  /** A plain ring under an entity: gold for elites, blue for a shield. */
  mark(x: number, z: number, r: number, color: number): void {
    const d = this.decals[this.used++];
    if (!d) return;
    d.group.visible = true;
    d.group.position.set(x, 0.06, z);
    d.group.rotation.set(0, 0, 0);
    d.laneFill.visible = d.laneEdge.visible = d.fill.visible = false;
    d.edge.visible = true;
    d.edge.scale.setScalar(r);
    (d.edge.material as MeshBasicMaterial).color.setHex(color);
    (d.edge.material as MeshBasicMaterial).opacity = 0.9;
  }

  /** Hide what this frame did not draw. */
  end(): void {
    for (let i = this.used; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (d && d.group.visible) d.group.visible = false;
    }
    for (let i = this.shotUsed; i < this.shots.length; i++) {
      const m = this.shots[i];
      if (m && m.visible) m.visible = false;
    }
  }
}
