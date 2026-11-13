import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { onFloorChange } from "./floor";

/** Renderer, camera, orbit controls, lights and floor: everything except the arm. */
export function createStage(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15181d);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  camera.position.set(1.3, 1.0, 1.6);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.4, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.5;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the floor
  controls.update();

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Shadows cover 8 m × 8 m around where the camera is looking: main.ts moves the sun with
  // the view (followView), so the shadow map stays sharp however big the floor is.
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const SUN_OFFSET = new THREE.Vector3(2, 4, 2.5);
  /**
   * Called as the view moves: the sun (and so the sharp shadow area) follows what you're
   * looking at, and the 10 cm lines fade out from 6 m away, where they'd only be noise.
   */
  function followView(target: THREE.Vector3) {
    sun.target.position.set(target.x, 0, target.z);
    sun.position.copy(sun.target.position).add(SUN_OFFSET);
    const distance = camera.position.distanceTo(target);
    fineMaterial.opacity = THREE.MathUtils.clamp((12 - distance) / 6, 0, 1);
    fine.visible = fineMaterial.opacity > 0;
  }

  // An invisible floor that only shows shadows, a grid with a line every 10 cm and a
  // brighter one every meter, and the edge of the area you can build on. Rebuilt if the
  // floor's size changes (it comes from the API at startup).
  const floorGroup = new THREE.Group();
  scene.add(floorGroup);
  const fineMaterial = new THREE.LineBasicMaterial({ color: 0x262b33, transparent: true });
  let fine: THREE.Object3D = new THREE.Group();
  onFloorChange((half) => {
    for (const child of [...floorGroup.children]) {
      child.removeFromParent();
      child.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const size = 2 * half;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size + 10, size + 10).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    floor.receiveShadow = true;
    const fineGrid = new THREE.GridHelper(size, Math.round(size * 10), 0x262b33, 0x262b33);
    fineGrid.material = fineMaterial;
    fineGrid.position.y = 0.001; // avoid z-fighting with the shadow plane
    fine = fineGrid;
    const meters = new THREE.GridHelper(size, Math.round(size), 0x4a5361, 0x343a45);
    meters.position.y = 0.0015;
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-half, 0.002, -half), new THREE.Vector3(half, 0.002, -half),
        new THREE.Vector3(half, 0.002, half), new THREE.Vector3(-half, 0.002, half),
      ]),
      new THREE.LineBasicMaterial({ color: 0x5b8def }),
    );
    floorGroup.add(floor, fineGrid, meters, edge);
    controls.maxDistance = Math.max(10, 6 * half); // far enough to see the whole floor beside the panels
  });

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  return { renderer, scene, camera, controls, followView };
}
