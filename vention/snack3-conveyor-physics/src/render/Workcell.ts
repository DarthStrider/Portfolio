import * as THREE from "three";
import { BELT, BIN, SPAWN, STATICS } from "../layout";

const STRIPE_PERIOD = 0.2; // m between chevrons on the belt

/**
 * Draws the conveyor, rails and bin from the same STATICS list the physics uses,
 * plus some decoration that doesn't collide (legs, rollers, the hopper).
 * Returns update(), which scrolls the belt texture at the belt's speed.
 */
export function buildWorkcell(scene: THREE.Scene) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ae, metalness: 0.7, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.4, roughness: 0.6 });
  const binMat = new THREE.MeshStandardMaterial({ color: 0x3b6e8f, metalness: 0.3, roughness: 0.6 });

  const beltTexture = makeBeltTexture();
  beltTexture.repeat.set((BELT.maxX - BELT.minX) / STRIPE_PERIOD, 1);
  const beltTop = new THREE.MeshStandardMaterial({ map: beltTexture, roughness: 0.85 });

  for (const s of STATICS) {
    if (s.visible === false) continue;
    const size = new THREE.Vector3(s.max.x - s.min.x, s.max.y - s.min.y, s.max.z - s.min.z);
    // BoxGeometry face order is +x, -x, +y, -y, +z, -z: only the belt's top face gets the texture.
    const material = s.conveyor ? [dark, dark, beltTop, dark, dark, dark] : s.name.startsWith("bin") ? binMat : steel;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.set((s.min.x + s.max.x) / 2, (s.min.y + s.max.y) / 2, (s.min.z + s.max.z) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = s.name;
    scene.add(mesh);
  }

  // Decoration: legs, end rollers, the hopper boxes drop out of.
  const legHeight = BELT.topY - BELT.thickness;
  for (const x of [BELT.minX + 0.1, BELT.maxX - 0.1]) {
    for (const z of [-BELT.halfWidth + 0.04, BELT.halfWidth - 0.04]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, legHeight, 0.04), steel);
      leg.position.set(x, legHeight / 2, z);
      leg.castShadow = true;
      scene.add(leg);
    }
  }
  for (const x of [BELT.minX, BELT.maxX]) {
    const roller = new THREE.Mesh(
      new THREE.CylinderGeometry(BELT.thickness / 2, BELT.thickness / 2, 2 * BELT.halfWidth, 24).rotateX(Math.PI / 2),
      steel,
    );
    roller.position.set(x, BELT.topY - BELT.thickness / 2, 0);
    scene.add(roller);
  }
  const hopperMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ae, metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0.55 });
  const hopperY = SPAWN.y + 0.18;
  for (const [w, d, x, z] of [
    [0.32, 0.015, SPAWN.x, -0.17],
    [0.32, 0.015, SPAWN.x, 0.17],
    [0.015, 0.35, SPAWN.x - 0.16, 0],
    [0.015, 0.35, SPAWN.x + 0.16, 0],
  ]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), hopperMat);
    wall.position.set(x, hopperY, z);
    scene.add(wall);
  }

  // A label-free marker of the bin's footprint, so it reads as a bin even when empty.
  const binFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(BIN.maxX - BIN.minX, 2 * BIN.halfDepth).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1f3a4d, roughness: 0.9 }),
  );
  binFloor.position.set((BIN.minX + BIN.maxX) / 2, 0.002, 0);
  binFloor.receiveShadow = true;
  scene.add(binFloor);

  return {
    update(dt: number, beltSpeed: number) {
      // Scrolling the texture makes the belt look like it moves; the physics belt never moves.
      beltTexture.offset.x = (beltTexture.offset.x - (beltSpeed * dt) / STRIPE_PERIOD) % 1;
    },
  };
}

/** A tileable chevron pattern drawn on a canvas, so the belt's motion is visible. */
function makeBeltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#23272e";
  g.fillRect(0, 0, 64, 128);
  g.strokeStyle = "#3a414d";
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(10, 0);
  g.lineTo(44, 64);
  g.lineTo(10, 128);
  g.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
