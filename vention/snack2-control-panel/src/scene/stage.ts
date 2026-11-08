import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * Renderer, camera, orbit controls, lights and floor, mounted into `container`.
 * Sizes itself to the container (not the window), since it shares the page with
 * the React panel, and returns a dispose() that undoes everything.
 */
export function createStage(container: HTMLElement) {
  // The stage owns its canvas, so a remount (React StrictMode does one in development)
  // always starts from a fresh WebGL context.
  const canvas = document.createElement("canvas");
  container.append(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15181d);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50);
  camera.position.set(0.15, 1.15, 2.0);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(-0.05, 0.3, 0.2);
  controls.enableDamping = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 5;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(1.5, 4, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 10 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  );
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(4, 40, 0x3a414d, 0x262b33);
  grid.position.y = 0.001;
  scene.add(grid);

  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function dispose() {
    observer.disconnect();
    controls.dispose();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((m: THREE.Material) => m.dispose());
      }
    });
    renderer.dispose();
    renderer.forceContextLoss(); // free the GPU context now rather than waiting for GC
    canvas.remove();
  }

  return { renderer, scene, camera, controls, dispose };
}
