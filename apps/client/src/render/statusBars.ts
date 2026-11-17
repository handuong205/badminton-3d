import * as THREE from 'three';
import { STAMINA, staminaPowerCap, type Player } from '@badminton/shared/player';
import { sideSign } from '@badminton/shared/types';

const W = 0.9;   // chiều dài thanh (m)
const H = 0.07;  // độ dày thanh

/** Một thanh ngang neo bên trái: nền + phần đầy */
class Bar {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly cap: THREE.Mesh;

  constructor(color: number) {
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }));
    // Vùng "trần" (giới hạn bởi thể lực) vẽ sáng hơn nền
    this.cap = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.8 }));
    this.fillMat = new THREE.MeshBasicMaterial({ color });
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.fillMat);
    this.cap.position.z = 0.001;
    this.fill.position.z = 0.002;
    this.group.add(bg, this.cap, this.fill);
  }

  /** value, cap trong khoảng 0..1 */
  set(value: number, cap = 1, color?: number): void {
    const place = (m: THREE.Mesh, v: number) => {
      m.scale.x = Math.max(v, 0.0001);
      m.position.x = -W / 2 + (W * v) / 2; // neo mép trái
    };
    place(this.fill, value);
    place(this.cap, cap);
    if (color !== undefined) this.fillMat.color.set(color);
  }
}

/**
 * Thanh lực (cam) và thanh thể lực (xanh) dưới chân người chơi trên máy này.
 * Giống vòng điểm rơi: chỉ vẽ cho người chơi local, không hiện cho đối thủ.
 * - Thanh lực chỉ hiện khi đang giữ phím. Phần xám sáng = mức lực tối đa thể lực cho phép.
 * - Thanh thể lực chuyển đỏ khi dưới mức cho phép chạy nhanh / bứt tốc.
 */
export class StatusBars {
  readonly group = new THREE.Group();
  private readonly power = new Bar(0xff9800);
  private readonly stamina = new Bar(0x4caf50);
  private readonly player: Player;

  constructor(player: Player) {
    this.player = player;
    this.power.group.position.y = H * 1.4;
    this.group.add(this.power.group, this.stamina.group);
    // Ngả ra sau cho camera phía sau nhìn rõ; người chơi phía far thì quay ngược 180 độ
    this.group.rotation.set(-1.0, player.side === 'far' ? Math.PI : 0, 0, 'YXZ');
  }

  sync(): void {
    const p = this.player;
    this.group.position.set(p.pos.x, 0.25, p.pos.z + 0.6 * sideSign(p.side));
    const st = p.stamina / STAMINA.max;
    this.stamina.set(st, 1, p.stamina < STAMINA.minForSprint ? 0xf44336 : 0x4caf50);
    this.power.group.visible = p.chargingShot !== null;
    // Thanh lực chuyển vàng = nhả ngay lúc này sẽ tự bật nhảy đập
    this.power.set(p.chargePower, staminaPowerCap(p.stamina), p.jumpReady ? 0xffd54f : 0xff9800);
  }
}