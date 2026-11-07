import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';

// Stage 0 placeholder scene: a ground plane, a cube and a drag-to-orbit camera.
// Replaced by the real terrain renderer in Stage 2.
export function startDemoScene(container: HTMLElement): void {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x87a7c9);

  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);

  const ground = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: 0x4a6b3a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const cube = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ color: 0xd9a441 }));
  cube.position.y = 1;
  scene.add(cube);

  scene.add(new AmbientLight(0xffffff, 0.6));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(10, 20, 8);
  scene.add(sun);

  let yaw = 0.8;
  let pitch = 0.5;
  let radius = 12;
  let dragging = false;

  renderer.domElement.addEventListener('pointerdown', () => {
    dragging = true;
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw -= e.movementX * 0.005;
    pitch = Math.min(1.4, Math.max(0.05, pitch + e.movementY * 0.005));
  });
  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      radius = Math.min(40, Math.max(4, radius + e.deltaY * 0.01));
    },
    { passive: true },
  );

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  renderer.setAnimationLoop((timeMs) => {
    cube.rotation.y = timeMs * 0.0005;
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * radius,
      Math.sin(pitch) * radius + 1,
      Math.cos(yaw) * Math.cos(pitch) * radius,
    );
    camera.lookAt(0, 1, 0);
    renderer.render(scene, camera);
  });
}
