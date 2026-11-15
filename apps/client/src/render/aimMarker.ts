import * as THREE from 'three';
import type { Match } from '@badminton/shared/match';
import type { Player } from '@badminton/shared/player';
import { aimPoint, isServe } from '@badminton/shared/shots';

/**
 * Chỉ báo hướng đánh, hiện khi người chơi trên máy này đang giữ phím nạp lực:
 * một đường nét đứt trên sàn từ chân người chơi tới HƯỚNG nhắm (trái / giữa / phải theo Q/E) + vòng nhỏ ở cuối.
 * Vòng chỉ cho biết bên nào, KHÔNG phải điểm rơi: độ sâu vẫn do lực quyết định, đánh lệch vợt thì cầu vẫn lệch.
 * Giống LandingMarker: chỉ vẽ cho người chơi local, đối thủ (AI hay người online) không thấy.
 */
export class AimMarker {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly line: THREE.Line;
  private readonly match: Match;
  private readonly local: Player;

  constructor(match: Match, localPlayer: Player) {
    this.match = match;
    this.local = localPlayer;
    const mat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 32), mat);
    this.ring.rotation.x = -Math.PI / 2; // nằm phẳng trên sàn
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0x00e5ff, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.8 }),
    );
    this.line.frustumCulled = false;
    this.group.add(this.ring, this.line);
    this.group.visible = false;
  }

  update(): void {
    const p = this.local;
    const shot = p.chargingShot;
    if (!shot) { this.group.visible = false; return; }
    // Giao cầu luôn nhắm ô chéo nên không đổi theo Q/E
    const t = aimPoint(p.side, shot, isServe(shot) ? 0 : p.chargeAim, this.match.serveRight);
    this.ring.position.set(t.x, 0.03, t.z);
    const pos = this.line.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, p.pos.x, 0.03, p.pos.z);
    pos.setXYZ(1, t.x, 0.03, t.z);
    pos.needsUpdate = true;
    this.line.computeLineDistances();
    this.group.visible = true;
  }
}
