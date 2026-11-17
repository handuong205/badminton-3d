import * as THREE from 'three';
import { NET_H, SINGLES_HALF_W, courtXSign } from './rules';
import type { Aim, ShotType, Side } from './types';
import { other, sideSign } from './types';

/**
 * Thông số mỗi loại cú đánh.
 * - pitch: góc bắn (độ). Đập cầu không có góc cố định mà nhắm thẳng xuống điểm rơi.
 * - depth: độ sâu "mặc định" của cú (m tính từ lưới): AI nhắm tới đây, và dùng để tính hướng trái/phải.
 */
export const SHOT_SPEC: Record<ShotType, { pitch: number | null; depth: number }> = {
  clear:      { pitch: 40,   depth: 6.2 },
  drop:       { pitch: 15,   depth: 2.2 },
  smash:      { pitch: null, depth: 3.5 },
  serveLong:  { pitch: 50,   depth: 6.2 },
  serveShort: { pitch: 25,   depth: 2.4 },
  drive:      { pitch: 8,    depth: 4.5 },
};

/** Đập: lực quyết định TỐC ĐỘ cầu (m/s) ở 0% và 100% lực */
export const SMASH_SPEED: [number, number] = [30, 90];

/** Cầu thấp hơn mức này (m) thì bấm đập sẽ thành đánh ngang (drive): lưới cao 1.55 m, không thể cắm xuống */
export const SMASH_MIN_HEIGHT = 1.8;

/**
 * LỰC = ĐỘ SÂU (mọi cú trừ đập): lực 0% và 100% ứng với điểm rơi cách lưới bao nhiêu mét.
 * Đứng ở đâu trên sân cũng vậy, nên người chơi chỉ cần nhớ "phông 70% là rơi giữa-cuối sân".
 * Biên cuối cách lưới 6.7 m, vạch giao cầu ngắn 1.98 m.
 * - clear:      50% -> 4.5 m, 70% -> 5.5 m, 90% -> 6.5 m, từ ~94% trở lên ra ngoài
 * - drop:       30% -> 1.4 m (sát lưới), 100% -> 3.4 m
 * - serveLong:  80% -> 6.2 m, từ ~93% trở lên ra ngoài
 * - serveShort: dưới ~24% là không qua vạch giao cầu ngắn (giao hỏng)
 * - drive:      cầu thấp đánh ngang, 50% -> 4.8 m, 100% -> 6.5 m
 */
export const DEPTH_RANGE: Record<Exclude<ShotType, 'smash'>, [number, number]> = {
  clear:      [2.0, 7.0],
  drop:       [0.6, 3.4],
  serveLong:  [3.0, 7.0],
  serveShort: [1.5, 3.5],
  drive:      [3.0, 6.5],
};

export const isServe = (s: ShotType) => s === 'serveLong' || s === 'serveShort';

/** Tốc độ cú đập theo lực */
export function smashSpeed(power: number): number {
  const [v0, v1] = SMASH_SPEED;
  return v0 + (v1 - v0) * power;
}

/** Độ sâu (m tính từ lưới) mà lực p nhắm tới */
export function depthForPower(shot: ShotType, p: number): number {
  if (shot === 'smash') return SHOT_SPEC.smash.depth;
  const [d0, d1] = DEPTH_RANGE[shot];
  return d0 + (d1 - d0) * p;
}

/** Ngược lại: muốn cầu rơi cách lưới d mét thì cần bao nhiêu lực (AI dùng) */
export function powerForDepth(shot: Exclude<ShotType, 'smash'>, d: number): number {
  const [d0, d1] = DEPTH_RANGE[shot];
  return THREE.MathUtils.clamp((d - d0) / (d1 - d0), 0, 1);
}

/**
 * Điểm nhắm trên sân đối thủ, theo loại cú, hướng trái/phải và lực.
 * Không truyền power thì dùng độ sâu mặc định của cú (SHOT_SPEC.depth).
 */
export function aimPoint(hitter: Side, shot: ShotType, aim: Aim, serveRight: boolean, power?: number): THREE.Vector3 {
  const opp = other(hitter);
  const depth = power === undefined ? SHOT_SPEC[shot].depth : depthForPower(shot, power);
  const z = sideSign(opp) * depth;
  const x = isServe(shot)
    ? courtXSign(opp, serveRight) * 1.3                      // giữa ô nhận giao (chéo góc)
    : aim * courtXSign(hitter, true) * (SINGLES_HALF_W - 0.7); // aim theo góc nhìn người đánh
  return new THREE.Vector3(x, 0, z);
}

/** Hướng bay (vector đơn vị) từ điểm tiếp xúc về phía điểm nhắm, với góc bắn của cú đánh */
export function launchDirection(contact: THREE.Vector3, shot: ShotType, target: THREE.Vector3): THREE.Vector3 {
  const flat = new THREE.Vector3(target.x - contact.x, 0, target.z - contact.z);
  const dist = flat.length();
  flat.normalize();
  const pitchDeg = SHOT_SPEC[shot].pitch;
  let pitch: number;
  if (pitchDeg === null) {
    // Đập: nhắm thẳng xuống điểm rơi, nhưng không thấp hơn đường đi qua mép lưới + 0.3 m
    const toNet = Math.abs(contact.z) / Math.max(Math.abs(flat.z), 0.2); // quãng ngang tới lưới
    pitch = Math.max(Math.atan2(-contact.y, dist), Math.atan2(NET_H + 0.3 - contact.y, toNet));
  } else {
    pitch = THREE.MathUtils.degToRad(pitchDeg);
  }
  return new THREE.Vector3(flat.x * Math.cos(pitch), Math.sin(pitch), flat.z * Math.cos(pitch));
}

/** Xoay vector quanh trục đứng (lệch trái/phải) và nâng/hạ góc (lệch lên/xuống), đơn vị độ */
export function deflect(dir: THREE.Vector3, yawDeg: number, pitchDeg: number): THREE.Vector3 {
  const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yawDeg));
  const horiz = Math.hypot(d.x, d.z);
  const pitch = Math.atan2(d.y, horiz) + THREE.MathUtils.degToRad(pitchDeg);
  const k = Math.cos(pitch) / (horiz || 1);
  return new THREE.Vector3(d.x * k, Math.sin(pitch), d.z * k).normalize();
}