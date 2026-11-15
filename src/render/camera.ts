import * as THREE from 'three';
import type { Player } from '../game/player';

/**
 * Camera góc nhìn thứ 3: sau lưng, cao hơn người chơi, bám theo mượt bằng lerp.
 * Khi cầu bay cao, camera lùi ra một chút và ngước lên theo cầu để cầu không bị ra khỏi khung hình.
 */
export class ThirdPersonCamera {
  private readonly offset = new THREE.Vector3(0, 3.2, 5.5);
  private lookY = 1.5;   // độ cao điểm nhìn, làm mượt
  private pullBack = 0;  // khoảng lùi thêm khi cầu cao, làm mượt
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: Player;

  constructor(camera: THREE.PerspectiveCamera, target: Player) {
    this.camera = camera;
    this.target = target;
    camera.position.copy(target.pos).add(this.offset);
  }

  update(shuttle: THREE.Vector3): void {
    const p = this.target.pos;
    // Cầu cao hơn 3 m thì ngước lên theo (tối đa tới 5 m) và lùi ra tối đa 2 m
    const extra = THREE.MathUtils.clamp(shuttle.y - 3, 0, 6);
    this.lookY = THREE.MathUtils.lerp(this.lookY, 1.5 + extra * 0.6, 0.08);
    this.pullBack = THREE.MathUtils.lerp(this.pullBack, extra * 0.35, 0.05);
    const want = p.clone().add(this.offset).add(new THREE.Vector3(0, this.pullBack * 0.5, this.pullBack));
    this.camera.position.lerp(want, 0.1);
    this.camera.lookAt(p.x * 0.5, this.lookY, p.z - 6);
  }
}