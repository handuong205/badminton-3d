import * as THREE from 'three';
import { FIXED_DT, solveShot, stepShuttle } from './physics';
import {
  HALF_LEN, NET_H, SHORT_SERVICE, SINGLES_HALF_W,
  courtXSign, gameWinner, isInServiceBox, isInSinglesCourt, serveFromRight,
} from './rules';
import { SHOT_SPEC, SMASH_MIN_HEIGHT, aimPoint, deflect, isServe, launchDirection, smashSpeed } from './shots';
import type { Phase, PointReason, Score, ShotType, Side } from './types';
import { other, sideSign } from './types';
import { CONTACT, JUMP, Player, STAMINA, SWING, reboundPower, swingImpact, swingWindow, type Swing } from './player';


/** Sự kiện phát ra để phần ghi log (data/) và giao diện (ui/) lắng nghe */
export type MatchEvent =
  | {
      type: 'hit'; hitter: Side; shot: ShotType; power: number; quality: number; stretched: boolean; jump: boolean;
      contact: THREE.Vector3; velIn: THREE.Vector3; velOut: THREE.Vector3; target: THREE.Vector3;
    }
  | { type: 'whiff'; player: Side }
  | { type: 'point'; winner: Side; reason: PointReason; landing: THREE.Vector3 }
  | { type: 'matchOver'; winner: Side };

/** Vị trí quả cầu sau `ahead` giây nữa (mô phỏng trước, không làm thay đổi cầu thật) */
function shuttleAfter(pos: THREE.Vector3, vel: THREE.Vector3, ahead: number): THREE.Vector3 {
  const p = pos.clone(), v = vel.clone();
  for (let t = 0; t < ahead - 1e-9 && p.y > 0; t += FIXED_DT) stepShuttle(p, v, FIXED_DT);
  return p;
}

/**
 * Nếu nhả phím đập NGAY BÂY GIỜ thì có tự bật nhảy không?
 * Có khi: đứng đánh thì lúc vợt tới cầu còn cao quá tầm với (CONTACT.maxY),
 * còn bật nhảy thì lúc lên đỉnh cầu nằm ở dải cao với tới được nhờ nhảy, và đủ thể lực.
 * Cầu rơi gần như thẳng đứng ~6.8 m/s nên phải nhả khi cầu còn cao hơn điểm chạm ~1.7 m: cần đoán trước.
 * Dùng chung cho luật (Match) và cho gợi ý thanh lực vàng trên màn hình (client).
 */
export function shouldJumpSmash(p: Player, shuttlePos: THREE.Vector3, shuttleVel: THREE.Vector3): boolean {
  if (!p.canJump) return false;
  if (shuttleAfter(shuttlePos, shuttleVel, SWING.impact).y <= CONTACT.maxY) return false; // đứng cũng với tới
  const at = shuttleAfter(shuttlePos, shuttleVel, JUMP.impact);
  // Lúc lên đỉnh cầu phải ở khoảng 2.6..3.4 m: thấp hơn thì nhảy cũng vô ích, cao hơn thì không với tới
  if (at.y < CONTACT.maxY - 0.3 || at.y > CONTACT.maxY + JUMP.height) return false;
  if (Math.sign(at.z) !== sideSign(p.side)) return false;
  // Trên không vẫn giữ đà chạy, nên tính chỗ người sẽ ở lúc lên đỉnh
  const body = p.pos.clone().addScaledVector(p.vel, JUMP.impact);
  return Math.hypot(at.x - body.x, at.z - body.z) <= p.maxReach;
}

  /**
 * Giới hạn người chơi trong phần sân của mình (cho phép ra ngoài biên 1 chút).
 * Tách thành hàm riêng vì client online cũng cần, để dự đoán chuyển động giống hệt server.
 */
export function keepInOwnHalf(p: Player): void {
  const s = sideSign(p.side);
  const cx = THREE.MathUtils.clamp(p.pos.x, -SINGLES_HALF_W - 1, SINGLES_HALF_W + 1);
  const cz = s * THREE.MathUtils.clamp(p.pos.z * s, 0.4, HALF_LEN + 1.5);
  if (cx !== p.pos.x) p.vel.x = 0;
  if (cz !== p.pos.z) p.vel.z = 0;
  p.pos.x = cx;
  p.pos.z = cz;
}

export const SERVE_HEIGHT = 1.0; // luật: điểm tiếp xúc khi giao dưới 1.15 m
const POINT_PAUSE = 1.6;          // nghỉ giữa hai điểm (giây)

export class Match {
  readonly players: Record<Side, Player>;
  readonly shuttlePos = new THREE.Vector3();
  readonly shuttleVel = new THREE.Vector3();
  score: Score = { near: 0, far: 0 };
  server: Side = 'near';
  phase: Phase = 'serve';
  lastHitter: Side | null = null;
  isServeShot = false;
  rallyShots = 0;
  rallyId = 0;
  time = 0;
  message = '';
    /** Tên hiển thị trong thông báo. Chơi với máy: Bạn / Máy; online: tên 2 người chơi */
  names: Record<Side, string> = { near: 'Bạn', far: 'Máy' };
  private pauseTimer = 0;
  private netted = false;  // cầu vừa chạm lưới trong pha này
  private listeners: ((e: MatchEvent) => void)[] = [];

  constructor(near: Player, far: Player) {
    this.players = { near, far };
    this.setupServe();
  }

  on(fn: (e: MatchEvent) => void): void { this.listeners.push(fn); }
  private emit(e: MatchEvent): void { for (const fn of this.listeners) fn(e); }

  get serveRight(): boolean { return serveFromRight(this.score[this.server]); }
  get receiver(): Side { return other(this.server); }

  /** Đặt hai người vào ô giao cầu, cầu nằm trước vợt người giao */
  private setupServe(): void {
    this.phase = 'serve';
    this.lastHitter = null;
    this.rallyShots = 0;
    this.rallyId++;
    for (const side of ['near', 'far'] as const) {
      const p = this.players[side];
      p.pos.set(courtXSign(side, this.serveRight) * 1.3, 0, sideSign(side) * (SHORT_SERVICE + 1.6));
      p.stop();
      p.swing = null;
      p.cancelCharge();
    }
    const s = this.players[this.server];
    this.shuttlePos.set(s.pos.x, SERVE_HEIGHT, s.pos.z - sideSign(this.server) * 0.5);
    this.shuttleVel.set(0, 0, 0);
    this.message = this.players[this.server].isAI
      ? `${this.names[this.server]} đang giao cầu...`
      : `Lượt ${this.names[this.server]} giao: giữ rồi nhả J = giao cao sâu, L = giao ngắn`;
  }

  /**
   * Thực hiện cú đánh.
   * - Đập (smash): power quyết định TỐC ĐỘ cầu, cắm thẳng xuống điểm nhắm.
   *   Cầu thấp hơn SMASH_MIN_HEIGHT thì không đập được, tự đổi thành đánh ngang (drive).
   * - Các cú khác: power quyết định ĐỘ SÂU điểm rơi (xem DEPTH_RANGE), đứng đâu cũng như nhau.
   *   Game tự tính vận tốc để cầu rơi đúng chỗ đó (tự nâng góc nếu sẽ chạm lưới).
   * - quality (0..1) là độ chuẩn của điểm tiếp xúc: 1 = trúng tâm vợt đúng thời điểm.
   *   Đánh lệch thì hụt lực và lệch hướng (tối đa 20 độ ngang, 15 độ dọc).
   * Sau đó để vật lý quyết định: cầu có qua lưới không, có ra ngoài không.
   */
  private hit(p: Player, sw: Swing, quality: number, stretched = false): void {
    const shot: ShotType = sw.shot === 'smash' && this.shuttlePos.y < SMASH_MIN_HEIGHT ? 'drive' : sw.shot;
    const target = aimPoint(p.side, shot, sw.aim, this.serveRight, sw.power);

    const rnd = THREE.MathUtils.randFloatSpread;
    let yawErr = rnd(2 * p.config.aimErrorDeg);
    // Đập trên 75% lực thì kém chính xác hơn, tối đa thêm 6 độ ở 100%
    if (shot === 'smash' && sw.power > 0.75) yawErr += rnd(2 * 6 * (sw.power - 0.75) / 0.25);
    // Đánh lệch tâm vợt
    const miss = 1 - quality;
    yawErr += (Math.random() < 0.5 ? -1 : 1) * miss * 20;
    const pitchErr = rnd(2 * miss * 15);

    let dir: THREE.Vector3;
    let speed: number;
    if (shot === 'smash') {
      dir = launchDirection(this.shuttlePos, shot, target);
      speed = smashSpeed(sw.power) * (0.5 + 0.5 * quality) * (sw.jump ? JUMP.speedBonus : 1);
    } else {
      // Tính đúng vận tốc để cầu rơi vào điểm nhắm. Lệch vợt thì hụt tối đa 25% tốc độ -> cầu ngắn lại
      const v = solveShot(this.shuttlePos, target, SHOT_SPEC[shot].pitch ?? 0);
      speed = v.length() * (0.75 + 0.25 * quality);
      dir = v.normalize();
    }
    dir = deflect(dir, yawErr, pitchErr);
    const velIn = this.shuttleVel.clone();
    this.shuttleVel.copy(dir.multiplyScalar(speed));
    p.spend(STAMINA.hitBase + STAMINA.hitPower * sw.power * sw.power);
    p.swing = null;

    this.lastHitter = p.side;
    this.isServeShot = isServe(shot);
    this.rallyShots++;
    this.phase = 'rally';
    const names: Record<ShotType, string> = {
      clear: 'phông cầu', smash: 'đập cầu', drop: 'bỏ nhỏ', serveLong: 'giao cao sâu', serveShort: 'giao ngắn',
      drive: 'đánh ngang (cầu thấp, không đập được)',
    };
    const who = this.names[p.side];
    const q = quality >= 0.85 ? 'chuẩn' : quality >= 0.6 ? 'hơi lệch' : 'lệch vợt';
    const label = sw.jump && shot === 'smash' ? 'NHẢY ĐẬP' : names[shot];
    this.message = `${who}: ${label}${stretched ? ' (vươn tay)' : ''} ${Math.round(sw.power * 100)}% lực, ${q} (${speed.toFixed(0)} m/s)`;
    this.emit({
      type: 'hit', hitter: p.side, shot, power: sw.power, quality, stretched, jump: !!sw.jump,
      contact: this.shuttlePos.clone(), velIn, velOut: this.shuttleVel.clone(), target,
    });
  }

  /**
   * Kiểm tra vợt có chạm cầu ở bước này không.
   * Vợt tới điểm đánh lúc swing.t = SWING.impact. Cầu phải nằm trong vùng mặt vợt
   * trong khoảng impact ± window. Nếu cầu đã ở trong vùng từ sớm thì đợi tới impact mới đánh,
   * trừ khi bước sau cầu sẽ ra khỏi vùng (lúc đó cạnh vợt quẹt trúng sớm -> kém chuẩn).
   */
  private tryContact(p: Player): void {
    const sw = p.swing;
    if (!sw || this.lastHitter === p.side) return;
    if (Math.sign(this.shuttlePos.z) !== sideSign(p.side)) return; // chưa qua lưới thì không được đánh
    const dt = sw.t - swingImpact(sw);
    const incomingSpeed = this.shuttleVel.length();
    const window = swingWindow(incomingSpeed);
    if (Math.abs(dt) > window || !p.inContactZone(this.shuttlePos)) return;

    if (dt < 0) {
      const nextPos = this.shuttlePos.clone();
      stepShuttle(nextPos, this.shuttleVel.clone(), FIXED_DT);
      if (p.inContactZone(nextPos)) return; // vẫn còn trong vùng, đợi vợt tới đúng điểm
    }
    const reach = p.reach(this.shuttlePos)!;
    const timing = 1 - 0.6 * Math.abs(dt) / window;
    // Lực = max(lực đã nạp, lực bật lại từ cầu nhanh); với tay xa thì bị cắt theo powerCap
    const power = Math.min(Math.max(sw.power, reboundPower(incomingSpeed)), reach.powerCap);
    if (reach.stretched) p.spend(CONTACT.stretchStamina);
    this.hit(p, { ...sw, power }, timing * reach.spatial, reach.stretched);
  }

  /** Cầu chạm đất: xác định ai thắng điểm */
  private land(netted: boolean): void {
    const { x, z } = this.shuttlePos;
    const hitter = this.lastHitter!;
    let winner: Side;
    let reason: PointReason;
    if (netted) {
      winner = other(hitter); reason = 'net';
    } else if (this.isServeShot) {
      const ok = isInServiceBox(x, z, this.receiver, this.serveRight);
      winner = ok ? this.server : this.receiver;
      reason = ok ? 'in' : 'serveFault';
    } else if (isInSinglesCourt(x, z)) {
      winner = z > 0 ? 'far' : 'near'; reason = 'in';   // rơi trong sân bên nào, bên đó mất điểm
    } else {
      winner = other(hitter); reason = 'out';             // đánh ra ngoài thì người đánh mất điểm
    }
    this.score[winner]++;
    this.server = winner;   // luật rally point: bên thắng điểm được giao tiếp
    this.emit({ type: 'point', winner, reason, landing: this.shuttlePos.clone() });
    const label = { in: 'TRONG', out: 'NGOÀI', serveFault: 'GIAO HỎNG', net: 'CHẠM LƯỚI' }[reason];
    this.message = `${label} - ${this.names[winner]} ghi điểm`;

    const w = gameWinner(this.score);
    if (w) {
      this.phase = 'matchOver';
      this.message = `${this.names[w].toUpperCase()} THẮNG ${this.score.near}-${this.score.far}. Nhấn R để chơi lại`;
      this.emit({ type: 'matchOver', winner: w });
    } else {
      this.phase = 'pointOver';
      this.pauseTimer = POINT_PAUSE;
      for (const pl of Object.values(this.players)) pl.recover(STAMINA.betweenPoints);
    }
  }

    /** Ván mới. firstServer: ai giao trước (online bốc thăm ngẫu nhiên) */
  restart(firstServer: Side = 'near'): void {
    this.score = { near: 0, far: 0 };
    for (const pl of Object.values(this.players)) pl.recover(STAMINA.max);
    this.server = firstServer;
    this.setupServe();
  }

  /** Kết thúc ván ngay, ví dụ đối thủ rớt mạng quá lâu (online) */
  forfeit(winner: Side, reason: string): void {
    this.phase = 'matchOver';
    this.message = `${reason}. ${this.names[winner].toUpperCase()} THẮNG`;
    this.emit({ type: 'matchOver', winner });
  }

  /** Một bước mô phỏng cố định */
  update(dt = FIXED_DT): void {
    this.time += dt;
    if (this.phase === 'pointOver') {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) this.setupServe();
    }

    for (const side of ['near', 'far'] as const) {
      const p = this.players[side];
      const intent = p.controller.update(dt);
      const whiffed = p.tick(dt);
      if (whiffed && this.phase === 'rally') {
        this.message = `${this.names[side]}: vung hụt!`;
        this.emit({ type: 'whiff', player: side });
      }

      if (this.phase === 'serve') {
        // Lúc giao cầu hai người đứng yên; chỉ người giao được nạp lực và vung
        if (side !== this.server) continue;
        // Phím J (clear) = giao cao sâu, L (drop) = giao ngắn
        const c = intent.charge;
        const serve: ShotType | null =
          c === 'clear' || c === 'serveLong' ? 'serveLong'
          : c === 'drop' || c === 'serveShort' ? 'serveShort' : null;
        const sw = p.updateCharge(serve, 0, dt);
        if (sw) this.hit(p, sw, 1); // giao cầu: cầu nằm sẵn trên tay nên luôn trúng tâm vợt
        continue;
      }

      p.move(intent, dt);
      keepInOwnHalf(p);
      // Giới hạn trong phần sân của mình (cho phép ra ngoài biên 1 chút)
      const s = sideSign(side);
      const cx = THREE.MathUtils.clamp(p.pos.x, -SINGLES_HALF_W - 1, SINGLES_HALF_W + 1);
      const cz = s * THREE.MathUtils.clamp(p.pos.z * s, 0.4, HALF_LEN + 1.5);
      if (cx !== p.pos.x) p.vel.x = 0;
      if (cz !== p.pos.z) p.vel.z = 0;
      p.pos.x = cx;
      p.pos.z = cz;

      if (this.phase !== 'rally') { p.cancelCharge(); continue; }
      const charge = intent.charge && !isServe(intent.charge) ? intent.charge : null;
      const sw = p.updateCharge(charge, intent.aim, dt);
      // Nhả phím đập mà cầu cao quá tầm với -> tự bật nhảy (nhảy đập)
      if (sw && sw.shot === 'smash' && shouldJumpSmash(p, this.shuttlePos, this.shuttleVel)) {
        sw.jump = true;
        p.startJump();
      }
      // Gợi ý trên màn hình: đang giữ K và nhả ngay lúc này thì sẽ nhảy đập
      p.jumpReady = p.chargingShot === 'smash' && shouldJumpSmash(p, this.shuttlePos, this.shuttleVel);
      this.tryContact(p);
    }

    if (this.phase === 'rally') {
      const prevZ = this.shuttlePos.z;
      stepShuttle(this.shuttlePos, this.shuttleVel, dt);
      // Va lưới: cầu đi qua mặt z = 0 ở độ cao thấp hơn lưới
      const crossed = Math.sign(prevZ) !== Math.sign(this.shuttlePos.z);
      if (crossed && this.shuttlePos.y < NET_H) {
        this.shuttlePos.z = -Math.sign(this.shuttleVel.z) * 0.05;
        this.shuttleVel.set(0, 0, 0);
        this.netted = true;
      }
      if (this.shuttlePos.y <= 0) {
        this.shuttlePos.y = 0;
        this.land(this.netted);
        this.netted = false;
      }
    }
  }
}