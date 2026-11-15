import * as THREE from 'three';
import './style.css';
import { FIXED_DT, solveLaunch, stepShuttle } from './packages/shared/physics';

// ===== Kích thước sân chuẩn (mét) =====
const COURT_LEN = 13.4;   // dài
const COURT_W = 6.1;      // rộng (đánh đôi)
const NET_H = 1.55;
const HALF = COURT_LEN / 2;
// Quy ước: lưới ở z = 0, người chơi ở phía z > 0, máy bắn cầu ở phía z < 0

// ===== Scene, camera, renderer =====
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
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

// ===== Sân và lưới =====
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(COURT_W + 6, COURT_LEN + 8),
  new THREE.MeshStandardMaterial({ color: 0x2e7d4f }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Vẽ đường biên sân
const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
const hw = COURT_W / 2;
const border = [
  [-hw, -HALF], [hw, -HALF], [hw, HALF], [-hw, HALF], [-hw, -HALF],
].map(([x, z]) => new THREE.Vector3(x, 0.01, z));
scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(border), lineMat));

const net = new THREE.Mesh(
  new THREE.BoxGeometry(COURT_W + 0.6, 0.76, 0.02),
  new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
);
net.position.set(0, NET_H - 0.38, 0);
scene.add(net);

// ===== Người chơi (tạm dùng khối capsule) =====
const player = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.3, 1.1),
  new THREE.MeshStandardMaterial({ color: 0x1565c0 }),
);
player.position.set(0, 0.85, 4);
player.castShadow = true;
scene.add(player);
const PLAYER_SPEED = 5; // m/s
const REACH = 1.6;      // bán kính đánh được cầu (tính từ điểm vợt)

// ===== Quả cầu =====
const shuttle = new THREE.Mesh(
  new THREE.ConeGeometry(0.06, 0.12, 12),
  new THREE.MeshStandardMaterial({ color: 0xffffff }),
);
shuttle.castShadow = true;
scene.add(shuttle);
const sPos = new THREE.Vector3();
const sVel = new THREE.Vector3();
let inPlay = false;
let lastHitBy: 'player' | 'machine' = 'machine';

// ===== Input =====
const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));

// ===== Máy bắn cầu: bắn sang phần sân người chơi =====
function machineServe() {
  sPos.set(THREE.MathUtils.randFloatSpread(2), 2.5, -5);
  const target = new THREE.Vector3(
    THREE.MathUtils.randFloatSpread(COURT_W - 1),
    0,
    THREE.MathUtils.randFloat(1.5, HALF - 0.5),
  );
  sVel.copy(solveLaunch(sPos, target, THREE.MathUtils.randFloat(25, 55)));
  inPlay = true;
  lastHitBy = 'machine';
}

// ===== Cú đánh của người chơi =====
type Shot = { name: string; angle: number; depth: [number, number] };
const SHOTS: Record<string, Shot> = {
  KeyJ: { name: 'Phông cầu (clear)', angle: 45, depth: [-HALF + 0.5, -HALF + 1.5] },
  KeyK: { name: 'Đập cầu (smash)', angle: -12, depth: [-4, -2] },
  KeyL: { name: 'Bỏ nhỏ (drop)', angle: 15, depth: [-2.2, -1] },
};
let message = 'Nhấn Enter để máy bắn cầu';
let score = { player: 0, machine: 0 };

function tryHit(shot: Shot) {
  const racket = player.position.clone().add(new THREE.Vector3(0, 1.0, 0)); // vị trí đầu vợt
  if (!inPlay || lastHitBy === 'player' || racket.distanceTo(sPos) > REACH) return;
  // Đập cầu chỉ được khi cầu đang cao
  if (shot.angle < 0 && sPos.y < 2) { message = 'Cầu thấp quá, không đập được!'; return; }
  const target = new THREE.Vector3(
    THREE.MathUtils.randFloatSpread(COURT_W - 1.5),
    0,
    THREE.MathUtils.randFloat(...shot.depth),
  );
  sVel.copy(solveLaunch(sPos, target, shot.angle));
  lastHitBy = 'player';
  message = `${shot.name} - ${sVel.length().toFixed(0)} m/s`;
}

// ===== Xử lý khi cầu chạm đất =====
function onLanded() {
  inPlay = false;
  const inside = Math.abs(sPos.x) <= hw && Math.abs(sPos.z) <= HALF;
  const onPlayerSide = sPos.z > 0;
  // Cầu rơi trong sân bên nào thì bên đó mất điểm; rơi ngoài sân thì người đánh mất điểm
  const playerWins = inside ? !onPlayerSide : lastHitBy === 'machine';
  if (playerWins) score.player++; else score.machine++;
  message = `${inside ? 'TRONG' : 'NGOÀI'} - ${playerWins ? 'Bạn ghi điểm' : 'Máy ghi điểm'}. Enter để tiếp`;
}

// ===== Vòng lặp game với fixed timestep =====
const hud = document.getElementById('hud')!;
const timer = new THREE.Timer();
let acc = 0;
const camOffset = new THREE.Vector3(0, 3.2, 5.5); // camera phía sau, cao hơn người chơi

function update(dt: number) {
  // Di chuyển người chơi (WASD), giới hạn trong phần sân của mình
  const move = new THREE.Vector3(
    (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    0,
    (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0),
  );
  if (move.lengthSq() > 0) player.position.addScaledVector(move.normalize(), PLAYER_SPEED * dt);
  player.position.x = THREE.MathUtils.clamp(player.position.x, -hw - 1, hw + 1);
  player.position.z = THREE.MathUtils.clamp(player.position.z, 0.5, HALF + 1.5);

  if (keys.has('Enter') && !inPlay) machineServe();
  for (const code in SHOTS) if (keys.has(code)) tryHit(SHOTS[code]);

  if (inPlay) {
    stepShuttle(sPos, sVel, dt);
    // Va lưới: cầu đi qua mặt z = 0 ở độ cao thấp hơn lưới
    const crossed = Math.sign(sPos.z) !== Math.sign(sPos.z - sVel.z * dt);
    if (crossed && sPos.y < NET_H && Math.abs(sPos.x) < hw + 0.3) {
      // Cầu bị lưới chặn: đẩy lùi về phía bên đánh và cho rơi thẳng xuống
      sPos.z = -Math.sign(sVel.z) * 0.05;
      sVel.set(0, 0, 0);
    }
    if (sPos.y <= 0) { sPos.y = 0; onLanded(); }
  }
}

function render() {
  shuttle.position.copy(sPos);
  // Đầu cầu (đế tròn) luôn hướng theo chiều bay
  if (sVel.lengthSq() > 0.01) {
    shuttle.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), sVel.clone().normalize());
  }
  // Camera bám theo người chơi, mượt bằng lerp
  camera.position.lerp(player.position.clone().add(camOffset), 0.1);
  camera.lookAt(player.position.x, 1.5, player.position.z - 6);
  renderer.render(scene, camera);
  hud.textContent =
    `Điểm  Bạn ${score.player} - ${score.machine} Máy\n${message}\n\n` +
    `WASD: di chuyển | J: phông | K: đập | L: bỏ nhỏ | Enter: máy bắn cầu`;
}

function loop() {
  timer.update();
  acc += Math.min(timer.getDelta(), 0.1);
  while (acc >= FIXED_DT) { update(FIXED_DT); acc -= FIXED_DT; }
  render();
  requestAnimationFrame(loop);
}
loop();
