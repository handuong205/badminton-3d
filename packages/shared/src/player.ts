import * as THREE from 'three';
import type { Aim, Intent, ShotType, Side } from './types';
import { sideSign } from './types';

export interface Controller {
  /** Đọc trạng thái trận và trả về ý định cho bước này */
  update(dt: number): Intent;
}

export interface PlayerConfig {
  aimErrorDeg: number; // độ lệch hướng ngẫu nhiên tối đa (độ) ở cú đánh trúng tâm vợt
}

// ===== Di chuyển (số liệu gần với vận động viên phong trào khá) =====
export const MOVE = {
  walk: 4.5,          // m/s, di chuyển thường
  sprint: 6.2,        // m/s, giữ Shift
  accel: 26,          // m/s^2: từ đứng yên lên tốc độ chạy nhanh mất ~0.24 s
  dashDist: 1.8,      // m, bứt tốc (giống bước lunge ra cứu cầu)
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
  minForSprint: 20,     // dưới mức này không BẮT ĐẦU chạy nhanh/ bứt tốc được
  sprintKeepMin: 5,   // đang chạy nhanh thì được chạy tiếp tới khi còn 5
};

/**
 * Lực tối đa được phép theo thể lực: còn từ 50 thể lực trở lên thì đánh được 100%,
 * dưới đó giảm dần, hết sạch thể lực vẫn còn 50% lực.
 * (Trước đây giới hạn = thể lực%, nhưng giờ lực = độ sâu nên giới hạn cứng quá làm người mệt không phông nổi qua giữa sân.)
 */
export function staminaPowerCap(stamina: number): number {
  return Math.min(1, 0.5 + stamina / STAMINA.max);
}

// ===== Vung vợt =====
export const CHARGE_TIME = 0.7;  // giữ 0.7 s thì đầy 100% lực
export const SWING = {
  impact: 0.12,   // vợt tới điểm đánh sau 0.12 s kể từ lúc nhả phím
  window: 0.07,  // cầu tới sớm/trễ tối đa 0.07 s vẫn chạm vợt
  windowMax: 0.12,   // với cầu nhanh (cú đập) cửa sổ nới dần tới 0.12 s
  cooldown: 0.45, // tính từ lúc nhả phím, trước khi được nạp lực lần sau
};

// ===== Nhảy đập =====
// Không có phím riêng: nhả K (đập) mà cầu sẽ cao quá tầm với khi đứng (CONTACT.maxY) nhưng
// vẫn với tới nếu bật nhảy, thì nhân vật TỰ nhảy. Vợt chạm cầu ở đỉnh cú nhảy.
export const JUMP = {
  height: 0.5,        // m, điểm chạm cao thêm tối đa (ở đỉnh)
  airTime: 0.5,       // s, thời gian ở trên không
  impact: 0.25,       // s, vợt tới điểm đánh lúc lên đỉnh (thay cho SWING.impact = 0.12 khi đứng)
  speedBonus: 1.15,   // đập khi nhảy nhanh hơn 15%
  staminaCost: 25,
  minStamina: 30,     // dưới mức này không nhảy được
  landingLock: 0.35,  // s, tiếp đất bị khựng, không di chuyển được
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

export interface Swing {
  shot: ShotType;
  power: number;  // 0..1
  aim: Aim;
  t: number;      // thời gian từ lúc nhả phím
  jump?: boolean; // cú nhảy đập
}

/** Thời điểm vợt tới điểm đánh (tính từ lúc nhả phím): nhảy đập thì chậm hơn, đợi lên đỉnh */
export function swingImpact(sw: Swing): number {
  return sw.jump ? JUMP.impact : SWING.impact;
}

export class Player {
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  stamina = STAMINA.max;
  chargingShot: ShotType | null = null;
  chargeTime = 0;
  chargeAim: Aim = 0;     // hướng trái/phải đang giữ lúc nạp lực (chỉ để vẽ vòng nhắm)
  swing: Swing | null = null;
  cooldown = 0;
  controller!: Controller;
  readonly side: Side;
  readonly isAI: boolean;
  readonly config: PlayerConfig;
  private sinceSpend = 0;
  private dashTimer = 0;
  private dashCd = 0;
  private sprintingNow = false; // đang chạy nhanh (để giữ trạng thái khi thể lực tụt dưới 20)
  private lungeTimer = 0;    // > 0: vừa bứt tốc, được với xa hơn
  /** Thời gian đã ở trên không (giây); -1 = đang đứng dưới đất */
  jumpT = -1;
  /** > 0: vừa tiếp đất, còn bị khựng bao nhiêu giây */
  landLock = 0;
  /** Đang giữ K và nhả ngay thì sẽ nhảy đập (chỉ để vẽ gợi ý) */
  jumpReady = false;
  private readonly dashDir = new THREE.Vector3();

  constructor(side: Side, isAI: boolean, config: PlayerConfig) {
    this.side = side;
    this.isAI = isAI;
    this.config = config;
    this.pos = new THREE.Vector3(0, 0, sideSign(side) * 4);
  }

  /** Lực hiện tại của thanh lực: theo thời gian giữ, nhưng không vượt quá % thể lực còn lại */
  get chargePower(): number {
    return Math.min(this.chargeTime / CHARGE_TIME, staminaPowerCap(this.stamina));
  }

  get isDashing(): boolean { return this.dashTimer > 0; }
  get isAirborne(): boolean { return this.jumpT >= 0; }

  /** Độ cao đang nhảy (m): đường parabol, cao nhất ở giữa thời gian bay */
  get jumpHeight(): number {
    if (this.jumpT < 0) return 0;
    const k = this.jumpT / JUMP.airTime;
    return 4 * JUMP.height * k * (1 - k);
  }

  /** Có bật nhảy được không (đang đứng, không khựng, đủ thể lực) */
  get canJump(): boolean {
    return this.jumpT < 0 && this.landLock === 0 && this.stamina >= JUMP.minStamina;
  }

  /** Đếm giờ cú nhảy và thời gian khựng sau khi tiếp đất (client online cũng gọi để dự đoán) */
  tickJump(dt: number): void {
    this.landLock = Math.max(0, this.landLock - dt);
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      if (this.jumpT >= JUMP.airTime) { this.jumpT = -1; this.landLock = JUMP.landingLock; } // tiếp đất
    }
  }

  startJump(): void {
    this.jumpT = 0;
    this.spend(JUMP.staminaCost);
  }
  get isSprinting(): boolean { return this.sprintingNow; }
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
    this.tickJump(dt);
    this.sinceSpend += dt;
    if (this.sinceSpend >= STAMINA.regenDelay) this.recover(STAMINA.regenPerSec * dt);
    if (this.swing) {
      this.swing.t += dt;
        if (this.swing.t > swingImpact(this.swing) + SWING.windowMax) { this.swing = null; return true; }
    }
    return false;
  }

  /** Di chuyển có gia tốc; chạy nhanh và bứt tốc tốn thể lực */
  move(intent: Intent, dt: number): void {
    const canBurst = this.stamina >= STAMINA.minForSprint;
    const dir = new THREE.Vector3(intent.moveX, 0, intent.moveZ);
    if (dir.lengthSq() > 1) dir.normalize();
        // Trên không: giữ nguyên đà, không đổi hướng được. Vừa tiếp đất: khựng lại
    if (this.landLock > 0) { this.vel.set(0, 0, 0); this.sprintingNow = false; return; }
    if (this.isAirborne) { this.pos.addScaledVector(this.vel, dt); return; }
    // Bứt tốc: lao nhanh theo hướng đang bấm
    if (intent.dash && canBurst && this.dashCd === 0 && dir.lengthSq() > 0.01 && !this.isDashing) {
      this.dashDir.copy(dir).normalize();
      this.dashTimer = MOVE.dashTime;
      this.dashCd = MOVE.dashCooldown;
      this.lungeTimer = MOVE.dashTime + CONTACT.lungeWindow;
      this.spend(STAMINA.dashCost);
    }
    if (this.isDashing) {
      this.dashTimer = Math.max(0, this.dashTimer - dt);
      this.vel.copy(this.dashDir).multiplyScalar(MOVE.dashDist / MOVE.dashTime);
      if (!this.isDashing) this.vel.setLength(MOVE.walk); // hết bứt tốc thì về tốc độ thường
    } else {
      // Bắt đầu chạy nhanh cần >= 20 thể lực; đã chạy rồi thì được chạy tiếp tới khi còn 5
      const enough = this.sprintingNow ? this.stamina > STAMINA.sprintKeepMin : canBurst;
      const sprinting = intent.sprint && enough && dir.lengthSq() > 0.01;
      this.sprintingNow = sprinting;
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

  stop(): void {
    this.vel.set(0, 0, 0); this.dashTimer = 0; this.sprintingNow = false; this.jumpT = -1; this.landLock = 0;
  }

  /**
   * Xử lý thanh lực. Giữ phím = nạp lực, nhả phím = bắt đầu vung.
   * Trả về Swing vừa bắt đầu (nếu có).
   */
  updateCharge(charge: ShotType | null, aim: Aim, dt: number): Swing | null {
    if (charge && !this.swing && this.cooldown === 0) {
      if (this.chargingShot === null) this.chargeTime = 0;
      else this.chargeTime += dt;
      this.chargingShot = charge;   // đổi phím giữa chừng thì đổi loại cú, giữ nguyên lực đã nạp
      this.chargeAim = aim;         // hướng đang giữ, để vẽ vòng nhắm
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

    get maxReach(): number {
    return CONTACT.stretchMax + (this.lungeTimer > 0 ? CONTACT.lungeBonus : 0);
  }

  /** Cầu ở điểm p thì đánh được không, chuẩn tới đâu, tối đa bao nhiêu lực. null = ngoài tầm */
  reach(p: THREE.Vector3): Reach | null {
    const y = p.y - this.jumpHeight; // đang nhảy thì cả vùng với tới nâng lên theo
    if (y < CONTACT.minY || y > CONTACT.maxY) return null;
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