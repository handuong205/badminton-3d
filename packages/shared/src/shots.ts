import * as THREE from 'three';
import { NET_H, SINGLES_HALF_W, courtXSign } from './rules';
import type { Aim, ShotType, Side } from './types';
import { other, sideSign } from './types';

/**
 * Thông số mỗi loại cú đánh.
 * - speed: tốc độ cầu (m/s) ở lực 0% và 100%, tốc độ thực = nội suy tuyến tính theo lực.
 *   Các số này được chỉnh bằng mô phỏng: phông cầu từ cuối sân (cao 2.4 m, cách lưới 5.5 m)
 *   với lực 70% rơi cách lưới 5.8 m, 90% rơi 6.6 m, 95% trở lên ra ngoài biên cuối (6.7 m).
 *   Đánh từ gần lưới thì cùng mức lực sẽ bay xa hơn, giống ngoài đời.
 * - pitch: góc bắn (độ). Đập cầu không có góc cố định mà nhắm thẳng xuống điểm rơi.
 * - depth: điểm nhắm, tính từ lưới (m), chỉ dùng để xác định HƯỚNG đánh trái/phải.
 */
export const SHOT_SPEC: Record<ShotType, { speed: [number, number]; pitch: number | null; depth: number }> = {
  clear:      { speed: [3.2, 68.9], pitch: 40,   depth: 6.2 },
  drop:       { speed: [3.0, 34.0], pitch: 15,   depth: 2.2 },
  smash:      { speed: [30, 90],    pitch: null, depth: 3.5 },
  serveLong:  { speed: [-2.7, 60.7], pitch: 50,  depth: 6.2 },
  serveShort: { speed: [5.9, 21.5], pitch: 25,   depth: 2.4 },
};

export const isServe = (s: ShotType) => s === 'serveLong' || s === 'serveShort';

export function speedForPower(shot: ShotType, power: number): number {
  const [v0, v1] = SHOT_SPEC[shot].speed;
  return Math.max(2, v0 + (v1 - v0) * power);
}

/** Ngược lại: muốn cầu bay với tốc độ v thì cần bao nhiêu lực (AI dùng) */
export function powerForSpeed(shot: ShotType, v: number): number {
  const [v0, v1] = SHOT_SPEC[shot].speed;
  return THREE.MathUtils.clamp((v - v0) / (v1 - v0), 0, 1);
}

/** Điểm nhắm trên sân đối thủ, theo loại cú và hướng trái/phải */
export function aimPoint(hitter: Side, shot: ShotType, aim: Aim, serveRight: boolean): THREE.Vector3 {
  const opp = other(hitter);
  const z = sideSign(opp) * SHOT_SPEC[shot].depth;
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