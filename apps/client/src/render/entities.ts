import * as THREE from 'three';
import { DIVE, JUMP, swingImpact, type Player } from '@badminton/shared/player';
import type { Side } from '@badminton/shared/types';
import { type CharacterAsset, findMaterial, instantiateCharacter, loadCharacter } from './characterAsset';

type LocoName = 'Idle' | 'Tired' | 'Walk' | 'Run' | 'WalkBack' | 'RunBack' | 'ShuffleLeft' | 'ShuffleRight';
type SwingName = 'SwingOver' | 'SwingSide' | 'SwingUnder' | 'SwingBackhand' | 'JumpSmash';
type MoveName = 'Lunge' | 'Land' | 'Dive' | 'Celebrate' | 'Disappointed';
type OneShot = SwingName | MoveName;
type AnimName = LocoName | OneShot;
const LOCO: LocoName[] = ['Idle', 'Tired', 'Walk', 'Run', 'WalkBack', 'RunBack', 'ShuffleLeft', 'ShuffleRight'];
const ONE_SHOT: OneShot[] = ['SwingOver', 'SwingSide', 'SwingUnder', 'SwingBackhand', 'JumpSmash',
  'Lunge', 'Land', 'Dive', 'Celebrate', 'Disappointed'];

/** Tốc độ (m/s) mà hoạt ảnh di chuyển được làm ra để chân khớp với sàn, ở kích thước gốc của model */
const DESIGN_SPEED: Partial<Record<LocoName, number>> = {
  Walk: 1.5, Run: 4.5, WalkBack: 1.25, RunBack: 3.3, ShuffleLeft: 2.0, ShuffleRight: 2.0,
};
/** Thời điểm (s) trong mỗi clip vung mà mặt vợt chạm cầu (khung chạm / 30 fps) */
const CONTACT_TIME: Record<SwingName, number> = {
  SwingOver: 10 / 30, SwingSide: 8 / 30, SwingUnder: 8 / 30, SwingBackhand: 8 / 30, JumpSmash: 10 / 30,
};
const FOLLOW_RATE = 1.2;  // sau khi chạm cầu, phần vung theo chạy nhanh hơn thật 20% cho gọn
const MAX_LEAN = 0.5;     // m, thân lướt về phía cầu tối đa bao nhiêu khi vươn (chỉ để vẽ)
const MAX_HOP = 0.4;      // m, nhảy thêm (chỉ để vẽ) để với cầu cao
const TIRED_BELOW = 25;   // thể lực dưới mức này thì đứng thở dốc

/** Một lớp động tác đè lên lớp di chuyển: clip nào, đang ở giây thứ mấy, đè bao nhiêu (0..1) */
interface Overlay { name: OneShot; time: number; w: number }

/** 2 nửa người, mỗi nửa trộn riêng: nửa dưới (hông + chân) và nửa trên (lưng, tay, đầu) */
type Half = 'lower' | 'upper';

/**
 * Hình 3D của người chơi. Lúc đầu là capsule tạm, tải xong player.glb thì thay bằng nhân vật có hoạt ảnh.
 * Chỉ ĐỌC trạng thái Player để chọn hoạt ảnh, không sửa logic.
 *
 * Cách trộn hoạt ảnh:
 * - Mỗi clip được tách làm 2 nửa (xem characterAsset.ts), mỗi nửa người trộn độc lập.
 *   Nhờ vậy đang chạy vẫn vung vợt được: chân theo Run, tay theo SwingOver.
 * - Mỗi nửa có 1 clip di chuyển (lặp, mixer tự chạy) và tối đa 1 động tác đè lên (Overlay).
 *   Động tác không tự chạy theo thời gian mà được ĐẶT thời điểm mỗi khung hình theo trạng thái của luật
 *   (swing.t, diveT, landLock...), để vợt chạm cầu đúng lúc luật tính là chạm, nằm sàn đúng lúc bị khựng.
 * - Động tác đè với trọng số w thì clip di chuyển còn 1 - w. Trọng số đổi dần (crossfade) cho mượt.
 */
export class PlayerView {
  readonly group = new THREE.Group();
  private readonly player: Player;
  private readonly placeholder: THREE.Mesh;
  private readonly body = new THREE.Group(); // xoay theo hướng nhìn
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions: Record<Half, Map<AnimName, THREE.AnimationAction>> = { lower: new Map(), upper: new Map() };
  private readonly weights: Record<Half, Map<AnimName, number>> = { lower: new Map(), upper: new Map() };
  private readonly durations = new Map<AnimName, number>();
  private scale = 1;
  // Cú vung đang diễn (vẫn diễn tiếp phần vung theo sau khi luật đã kết thúc cú đánh)
  private swingAnim: { name: SwingName; time: number } | null = null;
  private wasSwinging = false;
  private lastSwingT = 0;
  private wasCharging = false;
  private lastCooldown = 0;
  // Đồng hồ riêng của các động tác không có trong luật
  private lungeT = -1;      // giây từ lúc bắt đầu bứt tốc (-1 = không)
  private wasDashing = false;
  private reaction: { name: 'Celebrate' | 'Disappointed'; time: number } | null = null;
  // Vợt và tay phải (để vươn tay về phía cầu lúc chạm)
  private racket: THREE.Object3D | null = null;
  private strings: THREE.MeshStandardMaterial | null = null;
  private upperArm: THREE.Bone | null = null;
  private lowerArm: THREE.Bone | null = null;
  private readonly armDirLocal = new THREE.Vector3(); // hướng "dọc cánh tay" trong hệ tọa độ của xương vai
  private armWeight = 0;                              // 0 = theo hoạt ảnh, 1 = vươn hẳn về phía cầu
  private readonly lean = new THREE.Vector3();        // độ lệch thân về phía cầu: x/z = bước lunge, y = nhảy (chỉ để vẽ)

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

  get side(): Side { return this.player.side; }

  /** Gọi khi kết thúc một điểm: thắng thì ăn mừng, thua thì cúi đầu */
  react(won: boolean): void {
    this.reaction = { name: won ? 'Celebrate' : 'Disappointed', time: -0.35 }; // chờ 0.35 s cho cú vung theo xong
  }

  private attachModel(asset: CharacterAsset, color: number): void {
    const model = instantiateCharacter(asset, color);
    this.scale = asset.scale;
    this.body.remove(this.placeholder);
    this.body.add(model);
    this.racket = model.getObjectByName('Racket') ?? null;
    this.strings = findMaterial(model, 'RacketStrings');
    this.upperArm = (model.getObjectByName('mixamorigRightArm') as THREE.Bone | undefined) ?? null;
    this.lowerArm = (model.getObjectByName('mixamorigRightForeArm') as THREE.Bone | undefined) ?? null;
    if (this.lowerArm) this.armDirLocal.copy(this.lowerArm.position).normalize(); // vai -> khuỷu tay

    this.mixer = new THREE.AnimationMixer(model);
    for (const name of [...LOCO, ...ONE_SHOT] as AnimName[]) {
      const halves = asset.halves.get(name);
      if (!halves) continue;
      this.durations.set(name, halves.lower.duration);
      for (const half of ['lower', 'upper'] as Half[]) {
        const action = this.mixer.clipAction(halves[half]);
        if ((ONE_SHOT as AnimName[]).includes(name)) {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.timeScale = 0; // thời điểm do code đặt, mixer không tự chạy
        }
        action.play();
        action.setEffectiveWeight(name === 'Idle' ? 1 : 0);
        this.actions[half].set(name, action);
        this.weights[half].set(name, name === 'Idle' ? 1 : 0);
      }
    }
  }

  /** Chọn kiểu vung theo vị trí cầu so với người (cao/thấp, trái/phải) và loại cú */
  private pickSwing(shuttle: THREE.Vector3, jump: boolean): SwingName {
    const p = this.player;
    if (jump) return 'JumpSmash';
    const shot = p.swing?.shot ?? p.chargingShot;
    if (shot === 'serveLong' || shot === 'serveShort') return 'SwingUnder'; // giao cầu: đánh thấp tay
    const h = shuttle.y - p.jumpHeight;
    if (h > 1.7 || (shot === 'smash' && h > 1.3)) return 'SwingOver';
    // Mặt nhìn lưới: bên trái nhân vật ở sân gần là -x, ở sân xa là +x
    const left = (shuttle.x - p.pos.x) * (p.side === 'near' ? -1 : 1);
    if (left > 0.3 && h > 0.5) return 'SwingBackhand';
    if (h > 0.95) return 'SwingSide';
    return 'SwingUnder';
  }

  sync(dt: number, shuttle: THREE.Vector3): void {
    const p = this.player;
    this.group.position.set(p.pos.x, p.jumpHeight, p.pos.z); // nhảy đập: cả người bật lên

    // ----- Phân loại kiểu di chuyển
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const near = p.side === 'near';
    const netZ = near ? -1 : 1;                          // hướng về lưới theo trục z
    const faceNet = near ? Math.PI : 0;                  // model gốc nhìn về +z
    const backward = speed > 0.3 && p.vel.z * netZ < -0.6 * speed;  // phần lớn vận tốc hướng ra xa lưới
    // Đi ngang (không chạy nhanh): bước đệm, mặt vẫn nhìn lưới
    const sideways = speed > 0.3 && !p.isSprinting && !p.isDashing && Math.abs(p.vel.x) > 0.75 * speed;
    const busy = p.chargingShot !== null || p.swing !== null || this.swingAnim !== null;

    // ----- Hướng nhìn
    let want = faceNet;
    let turnRate = 12;
    if (p.isDiving) { want = p.diveYaw; turnRate = 30; }               // lao người: quay ngay về hướng lao
    else if (p.isDashing) { want = Math.atan2(p.vel.x, p.vel.z); turnRate = 20; } // bứt tốc: lunge theo hướng lao
    else if (speed > 1.5 && !busy && !backward && !sideways) want = Math.atan2(p.vel.x, p.vel.z);
    let diff = want - this.body.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // quay theo đường ngắn nhất
    this.body.rotation.y += diff * Math.min(1, dt * turnRate);

    if (this.mixer) {
      this.updateAnimation(dt, shuttle, speed, backward, sideways);
      this.mixer.update(dt);
    }
    if (this.strings) this.strings.emissiveIntensity = p.chargingShot ? 0.2 + 0.8 * p.chargePower : 0;
    this.reachArm(dt, shuttle);
  }

  private dur(name: AnimName): number { return this.durations.get(name) ?? 1; }

  /** Trọng số khi sắp hết clip: mờ dần trong `fade` giây cuối để về clip di chuyển */
  private fadeOut(name: OneShot, time: number, fade = 0.25): number {
    return THREE.MathUtils.clamp((this.dur(name) - time) / fade, 0, 1);
  }

  private updateAnimation(dt: number, shuttle: THREE.Vector3, speed: number, backward: boolean, sideways: boolean): void {
    const p = this.player;

    // ===== 1. Clip di chuyển (lặp), tốc độ phát theo tốc độ thật để chân không trượt trên sàn
    let loco: LocoName = p.stamina < TIRED_BELOW ? 'Tired' : 'Idle';
    if (speed > 0.3) {
      const fast = p.isSprinting || p.isDashing || speed > 2.6;
      if (backward) loco = fast ? 'RunBack' : 'WalkBack';
      else if (sideways) loco = p.vel.x * (p.side === 'near' ? 1 : -1) > 0 ? 'ShuffleRight' : 'ShuffleLeft';
      else loco = fast ? 'Run' : 'Walk';
    }
    const design = DESIGN_SPEED[loco];
    if (design) {
      const ts = THREE.MathUtils.clamp(speed / (design * this.scale), 0.5, 2.4);
      for (const half of ['lower', 'upper'] as Half[]) { const a = this.actions[half].get(loco); if (a) a.timeScale = ts; }
    }

    // ===== 2. Cập nhật đồng hồ các động tác
    const swing = p.swing;
    const jumping = swing?.jump === true || p.isAirborne; // người chơi online kia không gửi cờ jump, dựa vào jumpT
    if (swing && (!this.wasSwinging || swing.t < this.lastSwingT)) {
      this.swingAnim = { name: this.pickSwing(shuttle, jumping), time: 0 }; // vừa nhả phím: chốt kiểu vung
    } else if (!swing && this.wasCharging && p.cooldown > this.lastCooldown) {
      // Giao cầu: luật đánh trúng ngay trong khung nhả phím nên không thấy p.swing.
      // Nhận ra nhờ cooldown vừa được đặt lại; bắt đầu từ giữa nhịp vung cho vợt tới cầu nhanh.
      const name = this.pickSwing(shuttle, false);
      this.swingAnim = { name, time: CONTACT_TIME[name] * 0.5 };
    }
    this.wasSwinging = swing !== null;
    this.lastSwingT = swing?.t ?? 0;
    this.wasCharging = p.chargingShot !== null;
    this.lastCooldown = p.cooldown;

    if (this.swingAnim) {
      const sa = this.swingAnim;
      if (swing) {
        // Trước lúc chạm: kéo giãn/nén clip để khung chạm cầu trùng đúng lúc luật tính là chạm
        const impact = jumping ? JUMP.impact : swingImpact(swing);
        const tc = CONTACT_TIME[sa.name];
        sa.time = swing.t < impact ? (swing.t / impact) * tc : tc + (swing.t - impact) * FOLLOW_RATE;
      } else {
        sa.time += dt * FOLLOW_RATE; // luật đã xong cú đánh, diễn nốt phần vung theo
      }
      if (sa.time >= this.dur(sa.name) || p.isDiving) this.swingAnim = null;
    }

    if (p.isDashing && !this.wasDashing) this.lungeT = 0;          // vừa bấm Space
    this.wasDashing = p.isDashing;
    if (this.lungeT >= 0) {
      this.lungeT += dt;
      // Hết clip, hoặc bứt tốc xong mà vẫn chạy tiếp thì bỏ thế lunge
      if (this.lungeT >= this.dur('Lunge') || (!p.isDashing && speed > 2.5) || p.isDiving) this.lungeT = -1;
    }

    if (this.reaction) {
      this.reaction.time += dt;
      if (this.reaction.time >= this.dur(this.reaction.name) || p.chargingShot) this.reaction = null;
    }

    // ===== 3. Chọn động tác đè lên cho từng nửa người (ưu tiên từ trên xuống)
    let lower: Overlay | null = null;
    let upper: Overlay | null = null;
    const standing = speed < 1.0 && !p.isDashing;
    if (p.isDiving) {
      // Lao người: cả người theo clip Dive, thời điểm = diveT của luật (clip dài đúng DIVE.lock)
      const t = Math.min(p.diveT, DIVE.lock);
      lower = upper = { name: 'Dive', time: t, w: this.fadeOut('Dive', t, 0.15) };
    } else {
      if (this.swingAnim) {
        const sa = this.swingAnim;
        upper = { name: sa.name, time: sa.time, w: this.fadeOut(sa.name, sa.time) };
        // Đứng yên (hoặc đang nhảy đập) thì chân cũng theo cú vung để có bước chân; đang chạy thì chân vẫn chạy
        if (standing || sa.name === 'JumpSmash') lower = upper;
      } else if (p.chargingShot) {
        // Đang nạp lực: giữ tư thế chuẩn bị (khung 0 của cú vung), càng nạp nhiều càng rõ
        const w = 0.45 + 0.55 * p.chargePower;
        upper = { name: this.pickSwing(shuttle, false), time: 0, w };
        if (standing) lower = upper;
      }
      if (p.landLock > 0) {
        const t = (1 - p.landLock / JUMP.landingLock) * this.dur('Land');
        const land: Overlay = { name: 'Land', time: t, w: 1 };
        lower = land;
        upper ??= land;
      } else if (this.lungeT >= 0) {
        const lunge: Overlay = { name: 'Lunge', time: this.lungeT, w: this.fadeOut('Lunge', this.lungeT) };
        lower = lunge;
        upper ??= lunge;
      } else if (this.reaction && this.reaction.time >= 0 && speed < 0.6 && !upper) {
        const r = this.reaction;
        lower = upper = { name: r.name, time: r.time, w: this.fadeOut(r.name, r.time, 0.3) };
      }
    }

    // ===== 4. Đặt thời điểm cho động tác và đổi trọng số dần về mục tiêu
    const fast = this.swingAnim !== null || p.isDiving || p.isDashing || p.landLock > 0;
    const rate = Math.min(1, dt * (fast ? 25 : 12));
    for (const half of ['lower', 'upper'] as Half[]) {
      const ov = half === 'lower' ? lower : upper;
      if (ov) this.actions[half].get(ov.name)!.time = ov.time;
      const weights = this.weights[half];
      for (const [name, action] of this.actions[half]) {
        let target = 0;
        if (ov && name === ov.name) target = ov.w;
        else if (name === loco) target = 1 - (ov?.w ?? 0);
        const w = weights.get(name)! + (target - weights.get(name)!) * rate;
        weights.set(name, w);
        action.setEffectiveWeight(w);
      }
    }
  }

  /**
   * Chỉnh nhỏ quanh lúc chạm cầu: xoay vai phải cho cánh tay chĩa về phía quả cầu,
   * lướt thân và nhún nhảy thêm (chỉ để vẽ) để mặt vợt tới đúng chỗ cầu.
   * Chỉ có tác dụng trong khoảng ±0.1 s quanh lúc chạm, còn lại để nguyên cú vung đã dựng sẵn.
   */
  private reachArm(dt: number, shuttle: THREE.Vector3): void {
    const p = this.player;
    const upper = this.upperArm;
    const racket = this.racket;
    let want = 0;
    if (p.swing && !p.isDiving && p.horizDist(shuttle) < p.maxReach + 0.6 && Math.sign(shuttle.z) === Math.sign(p.pos.z)) {
      const impact = p.swing.jump || p.isAirborne ? JUMP.impact : swingImpact(p.swing);
      const d = (p.swing.t - impact) / 0.08;
      want = Math.exp(-d * d); // hình chuông, đỉnh đúng lúc chạm
    }
    this.armWeight += (want - this.armWeight) * Math.min(1, dt * 20);
    if (!upper?.parent || !racket || this.armWeight < 0.01) {
      this.lean.multiplyScalar(Math.max(0, 1 - dt * 8)); // thu thân về chỗ cũ
      this.body.position.copy(this.lean);
      return;
    }

    // Phép quay biến "hướng tay hiện tại" thành "hướng tới cầu" (hệ thế giới), đổi về hệ của xương cha
    upper.updateWorldMatrix(true, false);
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const boneQ = upper.getWorldQuaternion(new THREE.Quaternion());
    const cur = this.armDirLocal.clone().applyQuaternion(boneQ).normalize();
    const toShuttle = shuttle.clone().sub(shoulder).normalize();
    const targetWorld = new THREE.Quaternion().setFromUnitVectors(cur, toShuttle).multiply(boneQ);
    const parentQ = upper.parent.getWorldQuaternion(new THREE.Quaternion());
    upper.quaternion.slerp(parentQ.invert().multiply(targetWorld), this.armWeight * 0.7);

    // Lướt thân và nhún theo khoảng hở còn lại giữa tâm mặt vợt và quả cầu
    racket.updateWorldMatrix(true, false);
    const head = racket.localToWorld(new THREE.Vector3(0, 0.52, 0)); // tâm mặt vợt
    const gap = shuttle.clone().sub(head);
    const target = new THREE.Vector3(this.lean.x + gap.x, 0, this.lean.z + gap.z);
    if (target.length() > MAX_LEAN) target.setLength(MAX_LEAN);
    target.multiplyScalar(this.armWeight);
    const k = Math.min(1, dt * 20);
    this.lean.x += (target.x - this.lean.x) * k;
    this.lean.z += (target.z - this.lean.z) * k;
    const hop = p.swing?.jump || p.isAirborne ? 0 : THREE.MathUtils.clamp(this.lean.y + gap.y, 0, MAX_HOP) * this.armWeight;
    this.lean.y += (hop - this.lean.y) * k;
    this.body.position.copy(this.lean);
  }
}

const TRAIL_LEN = 20; // số điểm của vệt bay (khoảng 1/3 giây)

/**
 * Quả cầu, cố tình vẽ to hơn thật (x2) cho dễ nhìn, kèm 3 thứ hỗ trợ mắt:
 * - Vệt bay phía sau, mờ dần: thấy được hướng và tốc độ cầu.
 * - Đường dọc từ cầu xuống sàn + bóng tròn dưới sàn: đoán được độ cao và vị trí.
 */
export class ShuttleView {
  readonly group = new THREE.Group();
  private readonly mesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.22, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 }),
  );
  private readonly cork = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xff5722 }), // đế cầu màu cam để thấy hướng bay
  );
  private readonly marker = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  );
  private readonly drop: THREE.Line;
  private readonly trail: THREE.Line;
  private readonly trailPts: THREE.Vector3[] = [];
  private readonly up = new THREE.Vector3(0, -1, 0);

  constructor() {
    this.mesh.castShadow = true;
    this.cork.position.y = -0.11;
    this.mesh.add(this.cork);
    this.marker.rotation.x = -Math.PI / 2;

    this.drop = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.5 }),
    );

    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3));
    const colors = new Float32Array(TRAIL_LEN * 3);
    for (let i = 0; i < TRAIL_LEN; i++) colors.fill(1 - i / TRAIL_LEN, i * 3, i * 3 + 3); // trắng -> đen (mờ dần)
    tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true }));
    this.trail.frustumCulled = false;

    this.group.add(this.mesh, this.marker, this.drop, this.trail);
  }

  sync(pos: THREE.Vector3, vel: THREE.Vector3): void {
    this.mesh.position.copy(pos);
    if (vel.lengthSq() > 0.01) this.mesh.quaternion.setFromUnitVectors(this.up, vel.clone().normalize());
    this.marker.position.set(pos.x, 0.02, pos.z);

    // Đường dọc xuống sàn
    const dp = this.drop.geometry.attributes.position as THREE.BufferAttribute;
    dp.setXYZ(0, pos.x, pos.y, pos.z);
    dp.setXYZ(1, pos.x, 0.02, pos.z);
    dp.needsUpdate = true;
    this.drop.computeLineDistances();
    this.drop.visible = pos.y > 0.3;

    // Vệt bay: chỉ ghi khi cầu đang bay, đứng yên thì xóa dần
    if (vel.lengthSq() > 0.01) this.trailPts.unshift(pos.clone());
    else this.trailPts.pop();
    if (this.trailPts.length > TRAIL_LEN) this.trailPts.length = TRAIL_LEN;
    const tp = this.trail.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < TRAIL_LEN; i++) {
      const p = this.trailPts[Math.min(i, this.trailPts.length - 1)] ?? pos;
      tp.setXYZ(i, p.x, p.y, p.z);
    }
    tp.needsUpdate = true;
  }
}