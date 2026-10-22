/**
 * 2D sprites in the 3D scene (the pixel art style, game-runtime.md §10).
 * A sprite is an upright plane with its feet at y = 0, built in metres at
 * SPRITE_TEXEL metres per source pixel. Drawn as a billboard it always
 * faces the camera, mirrors to face where it walks, and is resized by
 * `spriteScale`, which the pixel style sets each frame so one sprite texel
 * covers exactly one of its low-resolution pixels (one pixel scale for the
 * whole picture). Without the pixel style `spriteScale` stays 1.
 */
import { Vector3 } from "three/webgpu";
import type { Node } from "three/webgpu";
import { float, modelWorldMatrix, mrt, output, modelWorldMatrixInverse, positionGeometry, select, uniform, vec4 } from "three/tsl";

/** Metres one source pixel covers at `spriteScale` 1. */
export const SPRITE_TEXEL = 1 / 16;

/** The pixel style's resize for every billboard sprite (1 elsewhere). */
export const spriteScale = uniform(1);

const camRight = uniform(new Vector3(1, 0, 0)).onObjectUpdate(({ camera }, self) => {
  return camera ? self.value.setFromMatrixColumn(camera.matrixWorld, 0) : undefined;
});
const camUp = uniform(new Vector3(0, 1, 0)).onObjectUpdate(({ camera }, self) => {
  return camera ? self.value.setFromMatrixColumn(camera.matrixWorld, 1) : undefined;
});

/**
 * World position of a sprite vertex: `center` is the feet in world space,
 * `x`/`y` the vertex in metres on the plane (x across, y up from the feet),
 * `flip` -1 to mirror. The plane turns to the camera (its up is the camera's
 * up, so a sprite under a high camera shows its full height).
 */
export function billboardWorld(center: Node<"vec3">, x: Node<"float">, y: Node<"float">, flip: Node<"float">): Node<"vec3"> {
  return center.add(camRight.mul(x.mul(flip).mul(spriteScale))).add(camUp.mul(y.mul(spriteScale)));
}

/**
 * positionNode for a single sprite mesh (a player, a boss): the plane
 * faces the camera whatever the mesh's rotation, and mirrors when the
 * mesh's forward (-z) points to screen left.
 */
export function spriteBillboardNode(): Node<"vec3"> {
  const center = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
  const forward = modelWorldMatrix.mul(vec4(0, 0, -1, 0)).xyz;
  const flip = select(forward.dot(camRight).lessThan(-0.05), float(-1), float(1));
  const world = billboardWorld(center, positionGeometry.x, positionGeometry.y, flip);
  return modelWorldMatrixInverse.mul(vec4(world, 1)).xyz;
}

/** Flag a sprite plane so AnimatedCrowd draws it as billboards (geometry.userData). */
export function markSprite(geometry: { userData: Record<string, unknown> }): void {
  geometry.userData.sprite = true;
}

/** Whether a geometry is a sprite plane (markSprite). */
export function isSprite(geometry: { userData: Record<string, unknown> }): boolean {
  return geometry.userData.sprite === true;
}

/**
 * A sprite material's extra output: the pixel style keeps sprites in their
 * own palette colours and steps only the 3D world into light bands. Safe
 * everywhere: a target without a "sprite" texture just takes the colour.
 */
export function markSpriteMaterial(material: { mrtNode: unknown }): void {
  material.mrtNode = mrt({ output, sprite: float(1) });
}
