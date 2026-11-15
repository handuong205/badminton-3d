import * as THREE from 'three';
import type { Match } from '../game/match';
import { CHARGE_TIME, CONTACT, MOVE, STAMINA, SWING, type Controller, type Player } from '../game/player';
import { predictTrajectory, solveLaunch } from '../shared/physics';
import { HALF_LEN, SINGLES_HALF_W } from '../shared/rules';
import { SHOT_SPEC, aimPoint, powerForSpeed } from '../shared/shots';
import type { Aim, Intent, ShotType } from '../shared/types';
import { other, sideSign } from '../shared/types';

export interface AIDifficulty {
  reactionTime: number;   // giây, thời gian "nhận ra" cú đánh của đối thủ
  replanEvery: number;    // giây, bao lâu tính lại điểm đón cầu
  timingNoise: number;    // giây, độ lệch chuẩn khi canh thời điểm nhả vợt -> sinh ra cú lệch vợt / vung hụt
  powerNoise: number;     // độ lệch chuẩn của lực so với lực cần (0.04 = 4%)
  smashChance: number; 
  smashPower: [number, number];   // xác suất đập khi có cơ hội
  leaveOutMargin: number; // cầu dự đoán ra ngoài quá mức này (m) thì bỏ, không đỡ
}

export const NORMAL: AIDifficulty = {
  reactionTime: 0.22, replanEvery: 0.1, timingNoise: 0.035, powerNoise: 0.05, smashChance: 0.45, smashPower: [0.45, 0.7], leaveOutMargin: 0.15,
};

/** Số ngẫu nhiên phân phối chuẩn (Box-Muller) */
function gauss(std: number): number {
  return std * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

/** Kế hoạch đón một quả cầu */
interface Plan {
  contact: THREE.Vector3;  // điểm dự kiến chạm vợt
  stand: THREE.Vector3;    // chỗ đứng
  impactAt: number;        // thời điểm (giây, theo đồng hồ trận) cầu tới điểm chạm
  shot: ShotType;
  aim: Aim;
  power: number;           // lực muốn dùng
}

/**
 * AI dựa trên luật. Dùng CHUNG luật với người: phải giữ để nạp lực, nhả để vung,
 * canh thời điểm, tốn thể lực khi chạy nhanh / bứt tốc / đánh mạnh.
 * 1. Chờ: cầu bên phía đối thủ -> về vị trí trung tâm.
 * 2. Đón cầu: sau reactionTime, dự đoán quỹ đạo, chọn điểm chạm, chọn cú, tính lực cần.
 * 3. Canh giờ: bắt đầu nạp lực sớm vừa đủ, nhả phím đúng lúc (có sai số timingNoise).
 */
export class RuleBasedAI implements Controller {
  private plan: Plan | null = null;
  private swung = false;      // đã vung cho quả cầu này chưa
  private releaseAt = 0;
  private seenHitAt = -1;
  private lastShotCount = -1;
  private replanTimer = 0;
  private serveDelay = 1.0;
  private serveShot: ShotType | null = null;
  private servePower = 0;
  private readonly me: Player;
  private readonly match: Match;
  private readonly diff: AIDifficulty;

  constructor(me: Player, match: Match, diff: AIDifficulty = NORMAL) {
    this.me = me;
    this.match = match;
    this.diff = diff;
  }

  private get base(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, sideSign(this.me.side) * 3.6);
  }

  update(dt: number): Intent {
    const m = this.match;
    const intent: Intent = { moveX: 0, moveZ: 0, charge: null, aim: 0, sprint: false, dash: false };

    if (m.phase === 'serve') { this.plan = null; return this.serve(intent, dt); }
    this.serveShot = null;
    if (m.phase !== 'rally') return intent;

    // ----- Phát hiện đối thủ vừa đánh -----
    if (m.rallyShots !== this.lastShotCount) {
      this.lastShotCount = m.rallyShots;
      if (m.lastHitter !== this.me.side) this.seenHitAt = m.time;
      this.plan = null;
      this.swung = false;
    }
    const incoming = m.lastHitter !== this.me.side;
    const reacted = m.time - this.seenHitAt >= this.diff.reactionTime;

    // ----- Lập kế hoạch (chỉ tính lại khi chưa bắt đầu nạp lực) -----
    this.replanTimer -= dt;
    if (incoming && reacted && this.replanTimer <= 0 && !this.me.chargingShot && !this.me.swing) {
      this.replanTimer = this.diff.replanEvery;
      const old = this.plan;
      this.plan = this.planIntercept();
      // Sai số canh giờ chỉ bốc thăm 1 lần cho mỗi quả cầu
      if (this.plan && (!old || Math.abs(old.impactAt - this.plan.impactAt) > 0.15)) {
        this.releaseAt = this.plan.impactAt - SWING.impact + gauss(this.diff.timingNoise);
      } else if (this.plan && old) {
        this.releaseAt += this.plan.impactAt - old.impactAt;
      }
    }

    // ----- Di chuyển -----
    const goal = incoming && this.plan ? this.plan.stand : this.base;
    const dx = goal.x - this.me.pos.x;
    const dz = goal.z - this.me.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      // Giảm tốc khi gần tới để không chạy lố (quãng phanh v^2 / 2a)
      const v = this.me.vel.length();
      const brake = d < (v * v) / (2 * MOVE.accel) + 0.05 ? 0.3 : 1;
      intent.moveX = (dx / d) * brake;
      intent.moveZ = (dz / d) * brake;
      if (incoming && this.plan) {
        const timeLeft = this.plan.impactAt - m.time;
        const needSpeed = d / Math.max(timeLeft - 0.1, 0.05);
        intent.sprint = needSpeed > MOVE.walk * 0.9 && this.me.stamina > 35;
        intent.dash = needSpeed > MOVE.sprint && d > 1.0 && d < 2.5;
      }
    }

    // ----- Nạp lực và nhả vợt -----
    if (incoming && this.plan && !this.swung && !this.me.swing) {
      intent.aim = this.plan.aim;
      const holding = this.me.chargingShot !== null;
      const startCharge = this.releaseAt - this.plan.power * CHARGE_TIME;
      if (holding) {
        if (m.time >= this.releaseAt) this.swung = true;      // nhả phím -> vung
        else intent.charge = this.plan.shot;                   // tiếp tục giữ
      } else if (m.time >= startCharge) {
        intent.charge = this.plan.shot;                        // bắt đầu giữ (trễ thì lực sẽ yếu hơn)
      }
    }
    return intent;
  }

  /** Giao cầu: chọn kiểu giao, tính lực cần, giữ tới khi đủ lực rồi nhả */
  private serve(intent: Intent, dt: number): Intent {
    const m = this.match;
    if (m.server !== this.me.side) return intent;
    this.serveDelay -= dt;
    if (this.serveDelay > 0) return intent;
    if (!this.serveShot) {
      this.serveShot = Math.random() < 0.5 ? 'serveShort' : 'serveLong';
      this.servePower = this.powerFor(this.serveShot, 0, m.shuttlePos);
    }
    if (this.me.chargingShot && this.me.chargePower >= this.servePower) {
      this.serveDelay = 1.0;
      return intent; // nhả phím
    }
    intent.charge = this.serveShot;
    return intent;
  }

  /** Lực cần để cú `shot` rơi đúng điểm nhắm (có sai số powerNoise), không vượt quá thể lực */
  private powerFor(shot: ShotType, aim: Aim, contact: THREE.Vector3): number {
    const m = this.match;
    let p: number;
    if (shot === 'smash') {
      p = THREE.MathUtils.randFloat(this.diff.smashPower[0], this.diff.smashPower[1]);
    } else {
      const target = aimPoint(this.me.side, shot, aim, m.serveRight);
      const v = solveLaunch(contact, target, SHOT_SPEC[shot].pitch ?? 0).length();
      p = powerForSpeed(shot, v);
    }
    // Bỏ nhỏ cần lực nhẹ và rất nhạy (lệch 5% là chạm lưới) nên AI cẩn thận hơn ở cú này
    p += gauss(this.diff.powerNoise * (shot === 'drop' ? 0.4 : 1));
    return THREE.MathUtils.clamp(p, 0.05, Math.min(1, this.me.stamina / STAMINA.max));
  }

  /**
   * Tìm điểm chạm: điểm đầu tiên trên quỹ đạo bên sân mình, đang rơi xuống, cao 0.3..2.6 m,
   * và kịp chạy tới. Nếu cầu sẽ rơi ra ngoài rõ ràng thì trả về null (bỏ cầu).
   */
  private planIntercept(): Plan | null {
    const m = this.match;
    const traj = predictTrajectory(m.shuttlePos, m.shuttleVel);
    if (traj.length === 0) return null;
    const landing = traj[traj.length - 1].pos;
    const s = sideSign(this.me.side);
    const margin = this.diff.leaveOutMargin;
    const clearlyOut = Math.abs(landing.x) > SINGLES_HALF_W + margin || Math.abs(landing.z) > HALF_LEN + margin;
    if (!m.isServeShot && clearlyOut && Math.sign(landing.z) === s) return null;

    let chosen = null;
    for (const pt of traj) {
      const p = pt.pos;
      if (Math.sign(p.z) !== s || p.y < 0.3 || p.y > 2.6 || pt.vel.y > 0) continue;
      const stand = this.standFor(p);
      const reachable = this.me.pos.distanceTo(stand) / MOVE.sprint <= pt.t;
      chosen = pt;
      if (reachable) break;
    }
    if (!chosen) return null;
    const contact = chosen.pos.clone();
    const shot = this.chooseShot(contact);
    const aim = this.chooseAim();
    return {
      contact, stand: this.standFor(contact), impactAt: m.time + chosen.t,
      shot, aim, power: this.powerFor(shot, aim, contact),
    };
  }

  /** Đứng lùi về phía cuối sân mình so với điểm chạm, cách đúng tầm tâm vợt */
  private standFor(contact: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(contact.x, 0, contact.z + sideSign(this.me.side) * CONTACT.idealDist);
  }

  private chooseShot(contact: THREE.Vector3): ShotType {
    const m = this.match;
    const y = contact.y;
    const depth = Math.abs(contact.z);
    const opp = m.players[other(this.me.side)];
    const oppDeep = Math.abs(opp.pos.z) > 4.5;
    const r = Math.random();
    const tired = this.me.stamina < 30;
    if (y > 2.0) {
      // Cầu cao: giữa sân thì ưu tiên đập; cuối sân thì trộn bỏ nhỏ / phông / thỉnh thoảng đập
      if (depth < 4.8) return !tired && r < this.diff.smashChance ? 'smash' : r < 0.75 ? 'drop' : 'clear';
      if (!tired && r < 0.15) return 'smash';
      return r < 0.5 ? 'drop' : 'clear';
    }
    if (y > 1.6) return oppDeep ? (r < 0.6 ? 'drop' : 'clear') : 'clear';
    return oppDeep ? 'drop' : (r < 0.7 ? 'clear' : 'drop'); // cầu thấp: phông lên hoặc bỏ nhỏ
  }

  /** Đánh về phía xa đối thủ. aim tính theo góc nhìn của chính mình */
  private chooseAim(): Aim {
    const opp = this.match.players[other(this.me.side)];
    if (Math.random() < 0.25) return 0;
    const myRightX = this.me.side === 'near' ? 1 : -1;
    return (opp.pos.x * myRightX > 0 ? -1 : 1) as Aim;
  }
}