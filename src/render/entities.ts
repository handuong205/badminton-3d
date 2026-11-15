import * as THREE from 'three';
import type { Player } from '../game/player';
import { type CharacterAsset, instantiateCharacter, loadCharacter } from './characterAsset';

/** Mesh người chơi (tạm dùng capsule) + vợt; sáng lên khi đang vung vợt */
/** Vợt cầu lông dựng bằng khối cơ bản, đơn vị mét. Mặt vợt sáng dần khi nạp lực */
function makeRacket(): { group: THREE.Group; headMat: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.38, 8), dark);
  handle.position.y = 0.19;
  const headMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xffaa00, emissiveIntensity: 0, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 24), dark);
  frame.scale.y = 1.25;
  frame.position.y = 0.52;
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.105, 24), headMat);
  strings.scale.y = 1.25;
  strings.position.y = 0.52;
  group.add(handle, frame, strings);
  return { group, headMat };
}

type AnimName = 'Idle' | 'Walking' | 'Running' | 'Punch';

/**
 * Hình 3D của người chơi. Lúc đầu là capsule tạm, tải xong model glTF thì thay bằng robot có hoạt ảnh.
 * Chỉ ĐỌC trạng thái Player để chọn hoạt ảnh, không sửa logic.
 */
export class PlayerView {
  readonly group = new THREE.Group();
  private readonly player: Player;
  private readonly placeholder: THREE.Mesh;
  private readonly racket = makeRacket();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<AnimName, THREE.AnimationAction>();
  private current: AnimName | null = null;
  private wasSwinging = false;
  private readonly body = new THREE.Group(); // xoay theo hướng nhìn
    // Tay vươn về phía cầu (procedural arm)
  private upperArm: THREE.Bone | null = null;
  private lowerArm: THREE.Bone | null = null;
  private armDirLocal = new THREE.Vector3();  // hướng "dọc cánh tay" trong hệ tọa độ của xương vai
  private armWeight = 0;                       // 0 = theo hoạt ảnh gốc, 1 = vươn hẳn về phía cầu
  private readonly racketRest = new THREE.Quaternion();
    /**
   * Xoay xương vai phải để cánh tay chĩa về phía quả cầu, chồng lên hoạt ảnh gốc.
   * Đang vung: vươn hẳn (weight 1). Đang nạp lực và cầu ở gần: chuẩn bị (0.5). Còn lại: thả về hoạt ảnh gốc.
   * Cách làm: tính phép quay biến "hướng tay hiện tại" thành "hướng tới cầu" trong hệ tọa độ thế giới,
   * rồi đổi về hệ tọa độ của xương cha để gán cho xương vai.
   */
  private reachArm(dt: number, shuttle: THREE.Vector3): void {
    const p = this.player;
    const upper = this.upperArm;
    if (!upper || !upper.parent) return;
    const near = p.horizDist(shuttle) < p.maxReach + 0.6 && Math.sign(shuttle.z) === Math.sign(p.pos.z);
    const want = p.swing && near ? 1 : p.chargingShot && near ? 0.5 : 0;
    this.armWeight += (want - this.armWeight) * Math.min(1, dt * 15);
    if (this.armWeight < 0.01) {
      this.racket.group.quaternion.copy(this.racketRest);
      this.body.position.y = 0;
      return;
    }

    // Cầu cao: bật nhảy lên (tối đa 0.8 m) để vợt với tới, nhìn như nhảy đập
    this.body.position.y = this.armWeight * THREE.MathUtils.clamp(shuttle.y - 1.9, 0, 0.8) * (p.swing ? 1 : 0.3);

    upper.updateWorldMatrix(true, false);
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const boneQ = upper.getWorldQuaternion(new THREE.Quaternion());
    const cur = this.armDirLocal.clone().applyQuaternion(boneQ).normalize();
    const toShuttle = shuttle.clone().sub(shoulder).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, toShuttle);
    const targetWorld = delta.multiply(boneQ);
    const parentQ = upper.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetLocal = parentQ.invert().multiply(targetWorld);
    upper.quaternion.slerp(targetLocal, this.armWeight);
    // Duỗi thẳng khuỷu tay khi vươn
    this.lowerArm?.quaternion.slerp(new THREE.Quaternion(), this.armWeight * 0.8);

    // Xoay vợt cho cán vợt nối dài theo hướng tay, để mặt vợt tới đúng chỗ cầu
    const racket = this.racket.group;
    if (!racket.parent) return;
    racket.parent.updateWorldMatrix(true, false);
    const handQ = racket.parent.getWorldQuaternion(new THREE.Quaternion());
    const alongArm = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), toShuttle);
    const racketLocal = handQ.invert().multiply(alongArm);
    racket.quaternion.copy(this.racketRest).slerp(racketLocal, this.armWeight);
  } // góc cầm vợt lúc bình thường

  constructor(player: Player, color: number) {
    this.player = player;
    this.placeholder = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1), new THREE.MeshStandardMaterial({ color }));
    this.placeholder.position.y = 0.85;
    this.body.add(this.placeholder);
    this.group.add(this.body);
    loadCharacter()
      .then((asset) => this.attachModel(asset, color))
      .catch((err) => console.warn('Không tải được model, dùng capsule tạm', err));
  }

  private attachModel(asset: CharacterAsset, color: number): void {
    const model = instantiateCharacter(asset, color);
    this.body.remove(this.placeholder);
    this.body.add(model);
    // Gắn vợt vào xương bàn tay phải. Xương bị scale theo model (và theo khung xương gốc),
    // nên chia cho scale thực của xương để vợt vẫn dài đúng ~0.67 m
    // Lưu ý: 'HandR' trong model là mesh tĩnh, không phải xương; xương lòng bàn tay là 'Palm2R'
    const hand = model.getObjectByName('Palm2R') ?? model.getObjectByName('LowerArmR');
    if (hand) {
      model.updateMatrixWorld(true);
      const ws = hand.getWorldScale(new THREE.Vector3());
      this.racket.group.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z);
      this.racket.group.rotation.set(0, 0, -1.1); // chỉnh để vợt chĩa lên và ra bên phải
      this.racketRest.copy(this.racket.group.quaternion);
      hand.add(this.racket.group);
    }
    this.upperArm = model.getObjectByName('UpperArmR') as THREE.Bone ?? null;
    this.lowerArm = model.getObjectByName('LowerArmR') as THREE.Bone ?? null;
    if (this.lowerArm) this.armDirLocal.copy(this.lowerArm.position).normalize(); // vai -> khuỷu tay
    this.mixer = new THREE.AnimationMixer(model);
    for (const name of ['Idle', 'Walking', 'Running', 'Punch'] as AnimName[]) {
      const clip = THREE.AnimationClip.findByName(asset.clips, name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (name === 'Punch') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      this.actions.set(name, action);
    }
    this.play('Idle');
  }

  /** Chuyển hoạt ảnh mượt (crossfade 0.15 s) */
  private play(name: AnimName, timeScale = 1): void {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = timeScale;
    if (this.current === name && name !== 'Punch') return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    next.reset().play();
    if (prev && prev !== next) prev.crossFadeTo(next, 0.15, false);
    this.current = name;
  }

  sync(dt: number, shuttle: THREE.Vector3): void {
    const p = this.player;
    this.group.position.set(p.pos.x, 0, p.pos.z);

    // Hướng nhìn: đang chạy thì quay theo hướng chạy, còn lại (đứng, nạp lực, vung) thì nhìn về lưới
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const faceNet = p.side === 'near' ? Math.PI : 0;   // model gốc nhìn về +z
    const want = speed > 1.5 && !p.chargingShot && !p.swing ? Math.atan2(p.vel.x, p.vel.z) : faceNet;
    let diff = want - this.body.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // quay theo đường ngắn nhất
    this.body.rotation.y += diff * Math.min(1, dt * 12);

    // Chọn hoạt ảnh theo trạng thái
    const swinging = p.swing !== null;
    if (swinging && !this.wasSwinging) this.play('Punch', 2.2);    // vừa nhả phím -> vung
    else if (this.current !== 'Punch' || !this.actions.get('Punch')?.isRunning()) {
      if (speed > 5) this.play('Running', speed / 5);
      else if (speed > 0.3) this.play('Walking', speed / 2);
      else this.play('Idle');
    }
    this.wasSwinging = swinging;

    this.racket.headMat.emissiveIntensity = p.chargingShot ? 0.2 + 0.8 * p.chargePower : 0;
    this.mixer?.update(dt);
    this.reachArm(dt, shuttle);
  }
}

/** Quả cầu: đế cầu luôn hướng theo chiều bay; vẽ thêm bóng mờ dưới sàn để dễ đoán vị trí */
export class ShuttleView {
  readonly mesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  readonly marker = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  );
  private readonly up = new THREE.Vector3(0, -1, 0);

  constructor() {
    this.mesh.castShadow = true;
    this.marker.rotation.x = -Math.PI / 2;
  }

  sync(pos: THREE.Vector3, vel: THREE.Vector3): void {
    this.mesh.position.copy(pos);
    if (vel.lengthSq() > 0.01) this.mesh.quaternion.setFromUnitVectors(this.up, vel.clone().normalize());
    this.marker.position.set(pos.x, 0.02, pos.z);
  }
}