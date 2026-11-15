import * as THREE from 'three';
import type { Player } from '../game/player';

/** Camera góc nhìn thứ 3: sau lưng, cao hơn người chơi, bám theo mượt bằng lerp */
export class ThirdPersonCamera {
  private readonly offset = new THREE.Vector3(0, 3.2, 5.5);
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target: Player;

  constructor(camera: THREE.PerspectiveCamera, target: Player) {
    this.camera = camera;
    this.target = target;
    camera.position.copy(target.pos).add(this.offset);
  }

  update(): void {
    const p = this.target.pos;
    this.camera.position.lerp(p.clone().add(this.offset), 0.1);
    this.camera.lookAt(p.x * 0.5, 1.5, p.z - 6);
  }
}