// A plain three.js scene with Net Forge's netcode under it. The scene code
// (renderer, camera, meshes) is ordinary three.js; the only change is who
// decides where things are. Your keys become an intention sent to the room,
// the room steps the shared simulation, and the scene copies what the
// client predicts (you) and interpolates (everyone else).
//
// Here the room runs in the page behind a simulated 60 ms link, so the
// example needs no server. In a real game the two `net.send` calls in
// room.ts are a WebSocket, and the Room runs in Node.
//
//   pnpm --filter @netforge/engine example:threejs
import * as THREE from "three";
import { initSim } from "@netforge/engine-sim";
import { connect, intent, LINK, metres, sim } from "./room.js";

const hud = document.getElementById("hud") as HTMLElement;

// 1. Your existing three.js scene.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141a);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 18, 16);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x30281c, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(6, 12, 4);
scene.add(sun);
scene.add(new THREE.GridHelper(40, 40, 0x3a4656, 0x222a34));
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const colours: Record<number, number> = { 1: 0x4fb3ff, 2: 0xffc857 };
const meshes = new Map<number, THREE.Mesh>();
function meshFor(id: number, kind: number, owner: number): THREE.Mesh {
  let m = meshes.get(id);
  if (!m) {
    const player = kind === 1;
    const geometry = player ? new THREE.CapsuleGeometry(0.4, 0.8, 4, 12) : new THREE.SphereGeometry(0.3, 12, 8);
    m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: player ? (colours[owner] ?? 0xffffff) : 0xd0555a }));
    m.position.y = player ? 0.8 : 0.3;
    scene.add(m);
    meshes.set(id, m);
  }
  return m;
}

// 2. Keys become an intention, never a position.
const keys = new Set<string>();
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
const axis = (plus: string[], minus: string[]) => (plus.some((k) => keys.has(k)) ? 1 : 0) - (minus.some((k) => keys.has(k)) ? 1 : 0);

async function main(): Promise<void> {
  await initSim(); // loads Rapier's WebAssembly once
  const { room, net, clients } = connect(2);
  const first = clients[0];
  const second = clients[1];
  if (!first || !second) throw new Error("expected two clients");
  // Typed copies, so the hoisted frame() below sees them as defined.
  const me: typeof first = first;
  const other: typeof second = second;
  const tickMs = 1000 / sim.tickHz;
  const start = performance.now();
  let simTime = 0;
  let tick = 0;

  function frame(): void {
    const now = performance.now() - start;
    // 3. The fixed tick: each client sends its intention, the room steps.
    while (simTime + tickMs <= now) {
      simTime += tickMs;
      tick++;
      // Forward is -z on screen, so W is moveZ +1 with the default facing.
      me.tick(intent(0, tick, axis(["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]), axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"])), simTime);
      const a = tick / 40;
      other.tick(intent(0, tick, Math.cos(a), Math.sin(a)), simTime);
      net.advanceTo(simTime);
      room.step();
    }
    // 4. Draw: your player from prediction, everyone else interpolated.
    const { self, others } = me.render(now);
    const seen = new Set<number>();
    for (const e of self ? [self, ...others] : others) {
      const { x, z } = metres(e);
      meshFor(e.id, e.kind, e.owner).position.set(x, e.kind === 1 ? 0.8 : 0.3, z);
      seen.add(e.id);
    }
    for (const [id, m] of meshes) m.visible = seen.has(id);
    renderer.render(scene, camera);
    hud.textContent = `WASD or arrows: move (blue)\nserver tick ${room.tickN} at ${sim.tickHz} Hz, link ${LINK.latencyMs} ms each way\nentities drawn ${seen.size}, prediction corrections ${me.corrections}`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((e: unknown) => {
  hud.textContent = String(e);
});
