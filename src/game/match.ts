import * as THREE from 'three';
import { FIXED_DT, stepShuttle } from '../shared/physics';
import {
  HALF_LEN, NET_H, SHORT_SERVICE, SINGLES_HALF_W,
  courtXSign, gameWinner, isInServiceBox, isInSinglesCourt, serveFromRight,
} from '../shared/rules';
import { aimPoint, deflect, isServe, launchDirection, speedForPower } from '../shared/shots';
import type { Phase, PointReason, Score, ShotType, Side } from '../shared/types';
import { other, sideSign } from '../shared/types';
import { CONTACT, Player, STAMINA, SWING, reboundPower, swingWindow, type Swing } from './player';


/** Sự kiện phát ra để phần ghi log (data/) và giao diện (ui/) lắng nghe */
export type MatchEvent =
  | {
      type: 'hit'; hitter: Side; shot: ShotType; power: number; quality: number; stretched: boolean;
      contact: THREE.Vector3; velIn: THREE.Vector3; velOut: THREE.Vector3; target: THREE.Vector3;
    }
  | { type: 'whiff'; player: Side }
  | { type: 'point'; winner: Side; reason: PointReason; landing: THREE.Vector3 }
  | { type: 'matchOver'; winner: Side };

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
    this.message = this.server === 'near'
      ? 'Lượt bạn giao: giữ rồi nhả J = giao cao sâu, L = giao ngắn'
      : 'Máy đang giao cầu...';
  }

  /**
   * Thực hiện cú đánh.
   * - power (0..1) quyết định tốc độ cầu -> quyết định cầu bay xa/nhanh tới đâu.
   * - quality (0..1) là độ chuẩn của điểm tiếp xúc: 1 = trúng tâm vợt đúng thời điểm.
   *   Đánh lệch thì mất lực (tốc độ còn 50%..100%) và lệch hướng (tối đa 20 độ ngang, 15 độ dọc).
   * Sau đó để vật lý quyết định: cầu có qua lưới không, có ra ngoài không.
   */
  private hit(p: Player, sw: Swing, quality: number, stretched = false): void {
    const target = aimPoint(p.side, sw.shot, sw.aim, this.serveRight);
    let dir = launchDirection(this.shuttlePos, sw.shot, target);

    const rnd = THREE.MathUtils.randFloatSpread;
    let yawErr = rnd(2 * p.config.aimErrorDeg);
    // Đập trên 75% lực thì kém chính xác hơn, tối đa thêm 6 độ ở 100%
    if (sw.shot === 'smash' && sw.power > 0.75) yawErr += rnd(2 * 6 * (sw.power - 0.75) / 0.25);
    // Đánh lệch tâm vợt
    const miss = 1 - quality;
    yawErr += (Math.random() < 0.5 ? -1 : 1) * miss * 20;
    const pitchErr = rnd(2 * miss * 15);
    dir = deflect(dir, yawErr, pitchErr);

    const speed = speedForPower(sw.shot, sw.power) * (0.5 + 0.5 * quality);
    const velIn = this.shuttleVel.clone();
    this.shuttleVel.copy(dir.multiplyScalar(speed));
    p.spend(STAMINA.hitBase + STAMINA.hitPower * sw.power * sw.power);
    p.swing = null;

    this.lastHitter = p.side;
    this.isServeShot = isServe(sw.shot);
    this.rallyShots++;
    this.phase = 'rally';
    const names: Record<ShotType, string> = {
      clear: 'phông cầu', smash: 'đập cầu', drop: 'bỏ nhỏ', serveLong: 'giao cao sâu', serveShort: 'giao ngắn',
    };
    const who = p.side === 'near' ? 'Bạn' : 'Máy';
    const q = quality >= 0.85 ? 'chuẩn' : quality >= 0.6 ? 'hơi lệch' : 'lệch vợt';
    this.message = `${who}: ${names[sw.shot]}${stretched ? ' (vươn tay)' : ''} ${Math.round(sw.power * 100)}% lực, ${q} (${speed.toFixed(0)} m/s)`;
    this.emit({
      type: 'hit', hitter: p.side, shot: sw.shot, power: sw.power, quality, stretched,
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
    const dt = sw.t - SWING.impact;
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
    this.message = `${label} - ${winner === 'near' ? 'Bạn' : 'Máy'} ghi điểm`;

    const w = gameWinner(this.score);
    if (w) {
      this.phase = 'matchOver';
      this.message = `${w === 'near' ? 'BẠN THẮNG' : 'MÁY THẮNG'} ${this.score.near}-${this.score.far}. Nhấn R để chơi lại`;
      this.emit({ type: 'matchOver', winner: w });
    } else {
      this.phase = 'pointOver';
      this.pauseTimer = POINT_PAUSE;
      for (const pl of Object.values(this.players)) pl.recover(STAMINA.betweenPoints);
    }
  }

  restart(): void {
    this.score = { near: 0, far: 0 };
    for (const pl of Object.values(this.players)) pl.recover(STAMINA.max);
    this.server = 'near';
    this.setupServe();
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
        this.message = `${side === 'near' ? 'Bạn' : 'Máy'}: vung hụt!`;
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
      p.updateCharge(charge, intent.aim, dt);
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