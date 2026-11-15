import * as THREE from 'three';

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

/** Mô phỏng thử một cú đánh, trả về điểm chạm đất (y = 0). */
function simulateLanding(from: THREE.Vector3, vel0: THREE.Vector3): THREE.Vector3 {
  const p = from.clone();
  const v = vel0.clone();
  for (let i = 0; i < 120 * 10 && p.y > 0; i++) stepShuttle(p, v, FIXED_DT);
  return p;
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
