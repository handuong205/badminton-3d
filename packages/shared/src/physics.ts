import * as THREE from 'three';
import { NET_H } from './rules';

// ===== Hằng số vật lý =====
export const GRAVITY = 9.81;            // m/s^2
export const TERMINAL_VELOCITY = 6.8;   // vận tốc rơi tối đa của quả cầu lông thật (~6.8 m/s)
// Hệ số cản k: khi rơi đều thì g = k * v_t^2  =>  k = g / v_t^2
export const DRAG_K = GRAVITY / (TERMINAL_VELOCITY * TERMINAL_VELOCITY);
export const FIXED_DT = 1 / 120;        // bước mô phỏng cố định 120 lần/giây

/**
 * Một bước mô phỏng quả cầu.
 * Gia tốc a = g - k * |v| * v  (lực cản tỉ lệ bình phương vận tốc, ngược hướng bay)
 */
export function stepShuttle(pos: THREE.Vector3, vel: THREE.Vector3, dt: number): void {
  const speed = vel.length();
  vel.y -= GRAVITY * dt;
  vel.addScaledVector(vel, -DRAG_K * speed * dt);
  pos.addScaledVector(vel, dt);
}

/** Một điểm trên quỹ đạo dự đoán */
export interface TrajPoint {
  t: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

/**
 * Dự đoán quỹ đạo tới khi chạm đất (hoặc hết maxT giây).
 * Lấy mẫu mỗi `every` bước để đỡ tốn bộ nhớ. AI dùng hàm này để "nhìn trước".
 */
export function predictTrajectory(
  from: THREE.Vector3, vel0: THREE.Vector3, maxT = 4, every = 3,
): TrajPoint[] {
  const p = from.clone();
  const v = vel0.clone();
  const out: TrajPoint[] = [];
  for (let i = 0; p.y > 0 && i * FIXED_DT < maxT; i++) {
    stepShuttle(p, v, FIXED_DT);
    if (i % every === 0 || p.y <= 0) out.push({ t: (i + 1) * FIXED_DT, pos: p.clone(), vel: v.clone() });
  }
  return out;
}

/** Điểm chạm đất dự đoán */
function simulateLanding(from: THREE.Vector3, vel0: THREE.Vector3): THREE.Vector3 {
  const p = from.clone();
  const v = vel0.clone();
  for (let i = 0; i < 120 * 10 && p.y > 0; i++) stepShuttle(p, v, FIXED_DT);
  return p;
}

/** Cầu có qua được lưới với khoảng hở `margin` mét không */
export function clearsNet(from: THREE.Vector3, vel0: THREE.Vector3, margin = 0.1): boolean {
  const p = from.clone();
  const v = vel0.clone();
  for (let i = 0; i < 120 * 10 && p.y > 0; i++) {
    const prevZ = p.z;
    stepShuttle(p, v, FIXED_DT);
    if (Math.sign(prevZ) !== Math.sign(p.z)) return p.y > NET_H + margin;
  }
  return false;
}

/**
 * Tìm vận tốc ban đầu để quả cầu rơi đúng điểm `target`, với góc bắn `angleDeg`
 * (dương = bắn lên, âm = đập xuống).
 * Vì lực cản phi tuyến nên không có công thức đóng -> dùng binary search theo tốc độ.
 */
export function solveLaunch(from: THREE.Vector3, target: THREE.Vector3, angleDeg: number): THREE.Vector3 {
  const flat = new THREE.Vector3(target.x - from.x, 0, target.z - from.z);
  const wantDist = flat.length();
  flat.normalize();
  const a = THREE.MathUtils.degToRad(angleDeg);
  const dir = new THREE.Vector3(flat.x * Math.cos(a), Math.sin(a), flat.z * Math.cos(a));

  let lo = 1, hi = 120; // m/s (cú đập nhanh nhất thế giới ~ 140 m/s)
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const land = simulateLanding(from, dir.clone().multiplyScalar(mid));
    const dist = Math.hypot(land.x - from.x, land.z - from.z);
    if (dist < wantDist) lo = mid; else hi = mid;
  }
  return dir.multiplyScalar((lo + hi) / 2);
}

/**
 * Giống solveLaunch nhưng tự nâng góc từng 3 độ cho tới khi cầu qua lưới.
 * Ví dụ: đập cầu ở điểm thấp thì góc -12 độ sẽ cắm lưới, hàm sẽ nâng dần lên.
 */
export function solveShot(from: THREE.Vector3, target: THREE.Vector3, angleDeg: number): THREE.Vector3 {
  let angle = angleDeg;
  let vel = solveLaunch(from, target, angle);
  for (let i = 0; i < 20 && !clearsNet(from, vel); i++) {
    angle += 3;
    vel = solveLaunch(from, target, angle);
  }
  return vel;
}