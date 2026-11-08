import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Renderer, camera, orbit controls, lights and floor: everything except the arm. */
export function createStage(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15181d);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
  camera.position.set(1.3, 1.0, 1.6);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.4, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 5;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the floor
  controls.update();

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 10 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  // An invisible floor that only shows shadows, plus a grid at 10 cm spacing.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  );
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(4, 40, 0x3a414d, 0x262b33);
  grid.position.y = 0.001; // avoid z-fighting with the shadow plane
  scene.add(grid);

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  return { renderer, scene, camera, controls };
}
