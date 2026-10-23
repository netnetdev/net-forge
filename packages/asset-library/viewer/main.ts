/**
 * Library viewer (a dev tool, not shipped): contact sheets for checking
 * every model, and the gallery thumbnails.
 *
 *   ?style=lowpoly&from=0&count=48&cols=8   a sheet of models (crowd bake with &mode=crowd)
 *   ?thumb=<gallery id>&style=lowpoly        one gallery entry, square
 *   ?id=style.lowpoly.truck&look=<json>      one model with a look
 *   ?style=voxel&ids=ghost,bee,chest          a sheet of chosen models
 */
import { AmbientLight, Box3, Color, DirectionalLight, Group, HemisphereLight, InstancedMesh, PerspectiveCamera, Scene, Vector3 } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createRenderer } from "@netforge/engine/runtime";
import type { AppearanceDef } from "@netforge/engine";
import { galleryFor, idsForStyle, library, assetById } from "../src/index.js";
import { LibraryClient } from "../src/three/index.js";

declare global {
  interface Window {
    __ready?: boolean;
    __errors?: string[];
  }
}

const params = new URLSearchParams(location.search);
const style = params.get("style") ?? "lowpoly";
const thumb = params.get("thumb");
const single = params.get("id");
const mode = params.get("mode") ?? "character";

interface Cell {
  id: string;
  label: string;
  look?: AppearanceDef;
}

function cells(): Cell[] {
  if (thumb) {
    const g = galleryFor(style).find((e) => e.id === thumb);
    if (!g) throw new Error(`no gallery entry ${thumb}`);
    return [{ id: g.model, label: "", ...(g.appearance ? { look: g.appearance } : {}) }];
  }
  if (single) {
    const look = params.get("look");
    return [{ id: single, label: single, ...(look ? { look: JSON.parse(look) as AppearanceDef } : {}) }];
  }
  const pick = params.get("ids");
  if (pick) return pick.split(",").map((n) => (n.startsWith("style.") ? n : `style.${style}.${n}`)).map((id) => ({ id, label: id.split(".")[2] ?? id }));
  const from = Number(params.get("from") ?? 0);
  const count = Number(params.get("count") ?? 48);
  return idsForStyle(style)
    .filter((id) => !params.get("kind") || assetById(id)?.kind === params.get("kind"))
    .slice(from, from + count)
    .map((id) => ({ id, label: id.split(".")[2] ?? id }));
}

async function main(): Promise<void> {
  window.__errors = [];
  const list = cells();
  const cols = thumb || single ? 1 : Number(params.get("cols") ?? 8);
  const rows = Math.ceil(list.length / cols);
  const cell = thumb ? 256 : Number(params.get("cell") ?? 160);
  const width = cols * cell;
  const height = rows * cell;
  const canvas = document.createElement("canvas");
  document.body.prepend(canvas);
  const handle = await createRenderer(canvas, { forceWebGL: params.get("webgl") === "1", maxPixelRatio: 1 });
  handle.renderer.setSize(width, height, false);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const base = params.get("library") ?? "/library";
  const lib = new LibraryClient(null, {
    baseUrl: base,
    source: {
      load: async (id) => {
        const a = library().byId.get(id);
        const [, st = "", name = ""] = (a?.id ?? id).split(".");
        return loader.loadAsync(`${base}/${st}/${name}.glb`);
      },
    },
  });
  const labels = document.getElementById("labels");
  const scenes: { scene: Scene; camera: PerspectiveCamera; x: number; y: number }[] = [];
  await Promise.all(
    list.map(async (c, i) => {
      const scene = new Scene();
      scene.background = new Color(thumb ? 0x161c28 : 0x1b2230);
      scene.add(new HemisphereLight(0xdfe8ff, 0x3a3020, 1.6), new AmbientLight(0xffffff, 0.35));
      const sun = new DirectionalLight(0xffffff, 2.2);
      sun.position.set(3, 6, -4);
      scene.add(sun);
      let obj: Group;
      try {
        if (mode === "crowd") {
          const model = await lib.crowd(c.id, c.look);
          obj = new Group();
          for (const p of model.parts) {
            const m = new InstancedMesh(p.geometry, p.material, 1);
            m.count = 1;
            obj.add(m);
          }
        } else obj = (await lib.character(c.id, c.look)).root;
      } catch (e) {
        window.__errors?.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      scene.add(obj);
      const box = new Box3().setFromObject(obj, true);
      const size = box.getSize(new Vector3());
      const centre = box.getCenter(new Vector3());
      const r = Math.max(size.x, size.y, size.z) * 0.62 + 0.05;
      const camera = new PerspectiveCamera(32, 1, 0.01, 200);
      const dir = (style === "pixel" ? new Vector3(0, 0, -1) : new Vector3(0.75, 0.55, -1)).normalize();
      camera.position.copy(centre).addScaledVector(dir, r / Math.tan((16 * Math.PI) / 180));
      camera.lookAt(centre);
      const x = (i % cols) * cell;
      const y = Math.floor(i / cols) * cell;
      scenes.push({ scene, camera, x, y });
      if (labels && c.label) {
        const d = document.createElement("div");
        d.textContent = c.label;
        d.style.left = `${x}px`;
        d.style.top = `${y + cell - 18}px`;
        d.style.width = `${cell - 8}px`;
        labels.append(d);
      }
    }),
  );
  const r = handle.renderer;
  r.setScissorTest(true);
  for (const s of scenes) {
    const yy = s.y; // WebGPURenderer viewports are measured from the top-left.
    r.setViewport(s.x, yy, cell, cell);
    r.setScissor(s.x, yy, cell, cell);
    await r.renderAsync(s.scene, s.camera);
  }
  window.__ready = true;
}

main().catch((e: unknown) => {
  window.__errors?.push(String(e));
  window.__ready = true;
  console.error(e);
});
