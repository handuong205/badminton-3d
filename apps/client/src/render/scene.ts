import * as THREE from 'three';
import {
  DOUBLES_HALF_W, HALF_LEN, NET_H, SHORT_SERVICE, SINGLES_HALF_W,
} from '@badminton/shared/rules';

/** Tạo renderer, ánh sáng, sàn, vạch sân và lưới */
export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 15, 5);
  sun.castShadow = true;
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(DOUBLES_HALF_W * 2 + 6, HALF_LEN * 2 + 8),
    new THREE.MeshStandardMaterial({ color: 0x2e7d4f }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ----- Vạch sân -----
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const seg = (x1: number, z1: number, x2: number, z2: number) => {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, 0.01, z1), new THREE.Vector3(x2, 0.01, z2),
    ]);
    scene.add(new THREE.Line(g, lineMat));
  };
  for (const w of [DOUBLES_HALF_W, SINGLES_HALF_W]) { seg(-w, -HALF_LEN, -w, HALF_LEN); seg(w, -HALF_LEN, w, HALF_LEN); }
  for (const s of [1, -1]) {
    seg(-DOUBLES_HALF_W, s * HALF_LEN, DOUBLES_HALF_W, s * HALF_LEN);           // biên cuối
    seg(-DOUBLES_HALF_W, s * SHORT_SERVICE, DOUBLES_HALF_W, s * SHORT_SERVICE); // vạch giao cầu ngắn
    seg(0, s * SHORT_SERVICE, 0, s * HALF_LEN);                                 // vạch giữa
  }

  // ----- Lưới -----
  const net = new THREE.Mesh(
    new THREE.BoxGeometry(DOUBLES_HALF_W * 2 + 0.6, 0.76, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
  );
  net.position.set(0, NET_H - 0.38, 0);
  scene.add(net);

  return { scene, camera, renderer };
}