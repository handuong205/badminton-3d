import * as THREE from 'three';
import type { Match } from '../game/match';
import type { Player } from '../game/player';
import { clearsNet, predictTrajectory } from '../shared/physics';
import { isInSinglesCourt } from '../shared/rules';
import { sideSign } from '../shared/types';

/**
 * Vòng tròn báo điểm cầu sẽ rơi, CHỈ dành cho người chơi trên máy này (localPlayer).
 *
 * Khi nào hiện:
 * - Cầu do mình đánh đi: hiện ngay sau khi đánh.
 * - Cầu đối thủ đánh sang: chỉ hiện khi cầu đã bay qua lưới, sang nửa sân của mình.
 * Màu: vàng = rơi trong sân, đỏ = rơi ngoài sân.
 *
 * Đây là thứ thuần hiển thị (nằm trong render/), không nằm trong Match hay Intent,
 * nên AI không đọc được nó. Khi chơi online, mỗi máy tự vẽ vòng của riêng mình,
 * server không gửi thông tin này cho người khác.
 */
export class LandingMarker {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly match: Match;
  private readonly local: Player;
  private cachedShot = -1;   // đã tính điểm rơi cho cú đánh thứ mấy trong pha cầu

  constructor(match: Match, localPlayer: Player) {
    this.match = match;
    this.local = localPlayer;
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffeb3b, transparent: true, opacity: 0.85 });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 32), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
  }

  update(): void {
    const m = this.match;
    if (m.phase !== 'rally' || m.lastHitter === null) {
      this.mesh.visible = false;
      this.cachedShot = -1;
      return;
    }
    const mine = m.lastHitter === this.local.side;
    const onMySide = m.shuttlePos.z * sideSign(this.local.side) > 0;
    const shouldShow = mine || onMySide;
    if (!shouldShow) { this.mesh.visible = false; return; }

    // Vật lý tất định (cùng đầu vào cho cùng kết quả) nên mỗi cú đánh chỉ cần tính 1 lần
    if (this.cachedShot !== m.rallyShots) {
      this.cachedShot = m.rallyShots;
      const traj = predictTrajectory(m.shuttlePos, m.shuttleVel, 6, 1);
      const land = traj[traj.length - 1]?.pos;
      if (!land) { this.mesh.visible = false; return; }
      if (mine && !clearsNet(m.shuttlePos, m.shuttleVel, 0)) {
        // Cầu sẽ chạm lưới: đặt vòng đỏ ngay dưới lưới, tại vị trí x lúc cầu chạm lưới
        const startSign = Math.sign(m.shuttlePos.z);
        const atNet = traj.find((pt) => Math.sign(pt.pos.z) !== startSign)?.pos ?? land;
        this.mesh.position.set(atNet.x, 0.03, startSign * 0.2);
        this.mat.color.set(0xf44336);
      } else {
        this.mesh.position.set(land.x, 0.03, land.z);
        this.mat.color.set(isInSinglesCourt(land.x, land.z) ? 0xffeb3b : 0xf44336);
      }
    }
    this.mesh.visible = true;
    // Nhấp nháy nhẹ cho dễ thấy
    this.mesh.scale.setScalar(1 + 0.12 * Math.sin(m.time * 10));
  }
}