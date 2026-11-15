import * as THREE from 'three';
import type { Aim, Intent, ShotType, Side } from '../shared/types';
import { sideSign } from '../shared/types';

export interface Controller {
  /** Đọc trạng thái trận và trả về ý định cho bước này */
  update(dt: number): Intent;
}

export interface PlayerConfig {
  aimErrorDeg: number; // độ lệch hướng ngẫu nhiên tối đa (độ) ở cú đánh trúng tâm vợt
}

// ===== Di chuyển (số liệu gần với vận động viên phong trào khá) =====
export const MOVE = {
  walk: 3.5,          // m/s, di chuyển thường
  sprint: 5.2,        // m/s, giữ Shift
  accel: 14,          // m/s^2, không thể đổi hướng/tăng tốc tức thì
  dashDist: 1.6,      // m, bứt tốc (giống bước lunge ra cứu cầu)
  dashTime: 0.22,     // s
  dashCooldown: 0.8,  // s
};

// ===== Thể lực =====
export const STAMINA = {
  max: 100,
  sprintPerSec: 15,
  dashCost: 20,
  hitBase: 2,          // mỗi cú đánh tốn hitBase + hitPower * lực^2
  hitPower: 10,
  regenPerSec: 8,
  regenDelay: 0.5,     // phải ngừng tiêu hao 0.5 s mới bắt đầu hồi
  betweenPoints: 30,   // hồi thêm khi nghỉ giữa 2 điểm
  minForSprint: 20,    // dưới mức này không chạy nhanh / bứt tốc được
};

// ===== Vung vợt =====
export const CHARGE_TIME = 0.7;  // giữ 0.7 s thì đầy 100% lực
export const SWING = {
  impact: 0.12,   // vợt tới điểm đánh sau 0.12 s kể từ lúc nhả phím
  window: 0.07,
  windowMax: 0.12,   // cầu tới sớm/trễ hơn impact tối đa 0.07 s vẫn chạm vợt (nhưng kém chuẩn)
  cooldown: 0.45, // tính từ lúc nhả phím, trước khi được nạp lực lần sau
};

// ===== Vùng tiếp xúc (khoảng cách NGANG từ thân người tới cầu) =====
// - Quá gần (< 0.4 m): bị "kẹt" vợt, kém chuẩn.
// - Vùng chuẩn 0.4..1.0 m: đủ lực, chuẩn nhất. AI cố đứng cách cầu idealDist = 0.7 m.
// - Vùng vươn 1.0..1.6 m: với tay ra đánh, lực tối đa giảm dần còn 60%, kém chuẩn, tốn thêm thể lực.
// - Ngay sau khi bứt tốc (lunge) được với thêm 0.4 m.
export const CONTACT = {
  minDist: 0.25, coreMin: 0.4, coreMax: 1.0, stretchMax: 1.6, idealDist: 0.7,
  lungeBonus: 0.4, lungeWindow: 0.2,   // còn hiệu lực 0.2 s sau khi bứt tốc xong
  stretchPowerMin: 0.6, stretchStamina: 5,
  minY: 0.12, maxY: 2.9,
};

/** Kết quả đánh giá vị trí cầu so với người */
export interface Reach {
  spatial: number;   // 0..1, độ chuẩn do vị trí
  powerCap: number;  // lực tối đa đánh được ở vị trí này
  stretched: boolean;
}

/** Cửa sổ chạm vợt theo tốc độ cầu tới: cầu chậm (<= 8 m/s) 0.07 s, cầu nhanh (>= 20 m/s) 0.12 s */
export function swingWindow(incomingSpeed: number): number {
  const t = THREE.MathUtils.clamp((incomingSpeed - 8) / 12, 0, 1);
  return SWING.window + (SWING.windowMax - SWING.window) * t;
}

/**
 * Lực bật lại: đỡ cầu nhanh thì vợt tận dụng được năng lượng của chính quả cầu.
 * Cầu tới 9 m/s cho khoảng 18% lực, 18 m/s cho khoảng 60% (tối đa), dù người chơi không nạp lực.
 */
export function reboundPower(incomingSpeed: number): number {
  return THREE.MathUtils.clamp((incomingSpeed - 5) / 22, 0, 0.6);
}

/** Một lần vung vợt đang diễn ra */
export interface Swing {
  shot: ShotType;
  power: number;  // 0..1
  aim: Aim;
  t: number;      // thời gian từ lúc nhả phím
}

export class Player {
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  stamina = STAMINA.max;
  chargingShot: ShotType | null = null;
  chargeTime = 0;
  swing: Swing | null = null;
  cooldown = 0;
  controller!: Controller;
  readonly side: Side;
  readonly isAI: boolean;
  readonly config: PlayerConfig;
  private sinceSpend = 0;
  private dashTimer = 0;
  private dashCd = 0;
  private lungeTimer = 0;    // > 0: vừa bứt tốc, được với xa hơn
  private readonly dashDir = new THREE.Vector3();

  constructor(side: Side, isAI: boolean, config: PlayerConfig) {
    this.side = side;
    this.isAI = isAI;
    this.config = config;
    this.pos = new THREE.Vector3(0, 0, sideSign(side) * 4);
  }

  /** Lực hiện tại của thanh lực: theo thời gian giữ, nhưng không vượt quá % thể lực còn lại */
  get chargePower(): number {
    return Math.min(this.chargeTime / CHARGE_TIME, 1, this.stamina / STAMINA.max);
  }

  get isDashing(): boolean { return this.dashTimer > 0; }

  spend(amount: number): void {
    this.stamina = Math.max(0, this.stamina - amount);
    this.sinceSpend = 0;
  }

  recover(amount: number): void {
    this.stamina = Math.min(STAMINA.max, this.stamina + amount);
  }

  /** Đếm giờ và hồi thể lực. Trả về true nếu vừa vung hụt (hết cửa sổ mà chưa chạm cầu) */
  tick(dt: number): boolean {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.lungeTimer = Math.max(0, this.lungeTimer - dt);
    this.sinceSpend += dt;
    if (this.sinceSpend >= STAMINA.regenDelay) this.recover(STAMINA.regenPerSec * dt);
    if (this.swing) {
      this.swing.t += dt;
      if (this.swing.t > SWING.impact + SWING.windowMax) { this.swing = null; return true; }
    }
    return false;
  }

  /** Di chuyển có gia tốc; chạy nhanh và bứt tốc tốn thể lực */
  move(intent: Intent, dt: number): void {
    const canBurst = this.stamina >= STAMINA.minForSprint;
    const dir = new THREE.Vector3(intent.moveX, 0, intent.moveZ);
    if (dir.lengthSq() > 1) dir.normalize();

    // Bứt tốc: lao nhanh theo hướng đang bấm
    if (intent.dash && canBurst && this.dashCd === 0 && dir.lengthSq() > 0.01 && !this.isDashing) {
      this.dashDir.copy(dir).normalize();
      this.dashTimer = MOVE.dashTime;
      this.dashCd = MOVE.dashCooldown;
      // trong move(), lúc bắt đầu bứt tốc
      this.lungeTimer = MOVE.dashTime + CONTACT.lungeWindow;
      this.spend(STAMINA.dashCost);
    }
    if (this.isDashing) {
      this.dashTimer = Math.max(0, this.dashTimer - dt);
      this.vel.copy(this.dashDir).multiplyScalar(MOVE.dashDist / MOVE.dashTime);
      if (!this.isDashing) this.vel.setLength(MOVE.walk); // hết bứt tốc thì về tốc độ thường
    } else {
      const sprinting = intent.sprint && canBurst && dir.lengthSq() > 0.01;
      if (sprinting) this.spend(STAMINA.sprintPerSec * dt);
      const want = dir.multiplyScalar(sprinting ? MOVE.sprint : MOVE.walk);
      // Tiến vận tốc hiện tại về vận tốc mong muốn, mỗi bước thay đổi tối đa accel*dt
      const diff = want.sub(this.vel);
      const maxChange = MOVE.accel * dt;
      if (diff.length() > maxChange) diff.setLength(maxChange);
      this.vel.add(diff);
    }
    this.pos.addScaledVector(this.vel, dt);
  }

  stop(): void { this.vel.set(0, 0, 0); this.dashTimer = 0; }

  /**
   * Xử lý thanh lực. Giữ phím = nạp lực, nhả phím = bắt đầu vung.
   * Trả về Swing vừa bắt đầu (nếu có).
   */
  updateCharge(charge: ShotType | null, aim: Aim, dt: number): Swing | null {
    if (charge && !this.swing && this.cooldown === 0) {
      if (this.chargingShot === null) this.chargeTime = 0;
      else this.chargeTime += dt;
      this.chargingShot = charge;   // đổi phím giữa chừng thì đổi loại cú, giữ nguyên lực đã nạp
      return null;
    }
    if (!charge && this.chargingShot) {
      const s: Swing = { shot: this.chargingShot, power: this.chargePower, aim, t: 0 };
      this.chargingShot = null;
      this.chargeTime = 0;
      this.swing = s;
      this.cooldown = SWING.cooldown;
      return s;
    }
    return null;
  }

  cancelCharge(): void { this.chargingShot = null; this.chargeTime = 0; }

  /** Khoảng cách ngang từ thân người tới điểm p */
  horizDist(p: THREE.Vector3): number {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  /** Điểm p có nằm trong vùng mặt vợt quét qua không */
    get maxReach(): number {
    return CONTACT.stretchMax + (this.lungeTimer > 0 ? CONTACT.lungeBonus : 0);
  }

  /** Cầu ở điểm p thì đánh được không, chuẩn tới đâu, tối đa bao nhiêu lực. null = ngoài tầm */
  reach(p: THREE.Vector3): Reach | null {
    if (p.y < CONTACT.minY || p.y > CONTACT.maxY) return null;
    const d = this.horizDist(p);
    const max = this.maxReach;
    if (d < CONTACT.minDist || d > max) return null;
    if (d < CONTACT.coreMin) {
      const t = (CONTACT.coreMin - d) / (CONTACT.coreMin - CONTACT.minDist);
      return { spatial: 1 - 0.5 * t, powerCap: 1, stretched: false };
    }
    if (d <= CONTACT.coreMax) return { spatial: 1, powerCap: 1, stretched: false };
    const t = (d - CONTACT.coreMax) / (max - CONTACT.coreMax); // 0 ở 1.0 m, 1 ở mép tầm với
    return { spatial: 1 - 0.5 * t, powerCap: 1 - (1 - CONTACT.stretchPowerMin) * t, stretched: true };
  }

  inContactZone(p: THREE.Vector3): boolean {
    return this.reach(p) !== null;
  }
}