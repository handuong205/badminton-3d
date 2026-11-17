import * as THREE from 'three';
import type { Room } from '@colyseus/sdk';
import { Match, keepInOwnHalf, shouldJumpSmash } from '@badminton/shared/match';
import { Player, SWING, swingImpact } from '@badminton/shared/player';
import { FIXED_DT, stepShuttle } from '@badminton/shared/physics';
import type { InputMsg, PrivateSnap, RoomStatus, Snapshot } from '@badminton/shared/protocol';
import { NET_H } from '@badminton/shared/rules';
import { isServe } from '@badminton/shared/shots';
import { other, type Intent, type ShotType, type Side } from '@badminton/shared/types';
import type { HumanController } from '../input/humanController';

const INTERP_DELAY = 0.1;   // vẽ đối thủ trễ 0.1 s để luôn có 2 ảnh chụp kẹp hai đầu mà nội suy
const RESEND_EVERY = 0.1;   // Intent không đổi thì vẫn gửi lại mỗi 0.1 s (phòng tin bị mất)
const SNAP_DIST = 1.5;      // dự đoán lệch server quá 1.5 m thì nhảy thẳng tới vị trí server
const SHUTTLE_BLEND = 0.08; // quả cầu bị "giật" (vd. lúc có người đánh) thì trượt về vị trí mới trong ~0.08 s
const SHUTTLE_JUMP = 0.15;  // lệch dưới 15 cm coi như bình thường, không cần làm mượt

/** Không có controller thật: Match trên client không bao giờ tự chạy update() */
const idle = { update: (): Intent => ({ moveX: 0, moveZ: 0, charge: null, aim: 0, sprint: false, dash: false }) };

/**
 * Phía client của trận online.
 *
 * Server mới là nơi quyết định mọi thứ. Client làm 4 việc:
 * 1. Gửi Intent của mình lên (mỗi khi đổi, và nhắc lại mỗi 0.1 s).
 * 2. Dự đoán (client-side prediction): tự di chuyển nhân vật của mình ngay khi bấm phím, không chờ server.
 *    Khi ảnh chụp của server tới, so với vị trí mình đã dự đoán TẠI CÙNG THỜI ĐIỂM rồi kéo dần về cho khớp.
 * 3. Nội suy (interpolation) đối thủ: vẽ đối thủ ở thời điểm trễ 0.1 s, nằm giữa 2 ảnh chụp, nên mượt.
 * 4. Ngoại suy quả cầu: vật lý tất định nên từ vị trí + vận tốc server gửi, tự tính trước tới thời điểm
 *    mà phím mình bấm bây giờ sẽ tới server. Nhờ vậy canh vợt theo quả cầu trên màn hình là khớp với server.
 *
 * Match trên client chỉ là "bản sao để vẽ": GameView đọc nó giống hệt khi chơi với máy.
 */
export class OnlineGame {
  readonly match: Match;
  readonly local: Side;
  status: RoomStatus = 'waiting';
  rematch: Record<Side, boolean> = { near: false, far: false };
  connectedOpp = false;
  rtt = 0.05;                 // thời gian khứ hồi (giây)

  private readonly room: Room;
  private readonly me: Player;
  private readonly them: Player;
  private readonly ctrl: HumanController;
  private snaps: Snapshot[] = [];
  private latest: Snapshot | null = null;
  private offset: number | null = null; // đồng hồ server - đồng hồ client
  private clock = 0;                    // đồng hồ client (giây)
  private history: { t: number; pos: THREE.Vector3 }[] = [];
  private seq = 0;
  private lastSentJson = '';
  private sinceSend = 0;
  private localJumpAt = -1;            // lúc client tự dự đoán bật nhảy (để không bị ảnh chụp cũ hủy mất)
    /** Vị trí + vận tốc quả cầu (chưa làm mượt) ở khung hình trước, và độ lệch đang được giảm dần về 0 */
  private prevShuttle: { pos: THREE.Vector3; vel: THREE.Vector3 } | null = null;
  private readonly shuttleOffset = new THREE.Vector3();

  constructor(room: Room, local: Side, ctrl: HumanController) {
    this.room = room;
    this.local = local;
    this.ctrl = ctrl;
    this.me = new Player(local, false, { aimErrorDeg: 0 });
    this.them = new Player(other(local), false, { aimErrorDeg: 0 });
    this.me.controller = idle;
    this.them.controller = idle;
    this.match = local === 'near' ? new Match(this.me, this.them) : new Match(this.them, this.me);

    room.onMessage('snap', (s: Snapshot) => this.onSnapshot(s));
    room.onMessage('me', (p: PrivateSnap) => { this.me.stamina = p.stamina; });
    const ping = () => room.ping((ms) => { this.rtt = this.rtt * 0.7 + (ms / 1000) * 0.3; });
    ping();
    setInterval(ping, 2000);
  }

  /** Thời gian trên đồng hồ server ước lượng ở thời điểm hiện tại */
  private get serverNow(): number { return this.clock + (this.offset ?? 0); }

  requestRematch(): void { if (this.status === 'over') this.room.send('rematch'); }

  // ===== 1 bước cố định (120 lần/giây) =====
  step(dt = FIXED_DT): void {
    this.clock += dt;
    const intent = this.ctrl.update();
    this.sendInput(intent, dt);
    const s = this.latest;
    if (!s || this.status !== 'playing') return;

    // Dự đoán thanh lực + vung vợt của mình (để thấy ngay, không chờ server)
    const iServe = s.phase === 'serve' && s.server === this.local;
    let charge: ShotType | null = null;
    if (iServe) charge = intent.charge === 'clear' ? 'serveLong' : intent.charge === 'drop' ? 'serveShort' : null;
    else if (s.phase === 'rally' && intent.charge && !isServe(intent.charge)) charge = intent.charge;
    const me = this.me;
    if (charge && !me.swing) {
      if (!me.chargingShot) me.chargeTime = 0;
      else me.chargeTime += dt;
      me.chargingShot = charge;
      me.chargeAim = intent.aim;
    } else if (!charge && me.chargingShot) {
      me.swing = {
        shot: me.chargingShot,
        power: me.chargePower,
        aim: intent.aim,
        t: 0,
      };
      // Dự đoán nhảy đập giống luật trên server (cầu đã được ngoại suy tới lúc server nhận phím).
      // Không trừ thể lực ở đây: thể lực luôn lấy theo server
      if (
        me.swing.shot === "smash" &&
        shouldJumpSmash(me, this.match.shuttlePos, this.match.shuttleVel)
      ) {
        me.swing.jump = true;
        me.jumpT = 0;
        this.localJumpAt = this.clock;
      }
      me.chargingShot = null;
    }
    // Gợi ý thanh lực vàng: nhả ngay thì nhảy đập
    me.jumpReady =
      me.chargingShot === "smash" &&
      shouldJumpSmash(me, this.match.shuttlePos, this.match.shuttleVel);
    if (me.swing) {
      me.swing.t += dt;
      if (me.swing.t > swingImpact(me.swing) + SWING.windowMax) me.swing = null;
    }
    me.tickJump(dt);

    // Dự đoán di chuyển: lúc giao cầu server không cho ai di chuyển, nên client cũng vậy
    if (s.phase !== 'serve' && s.phase !== 'matchOver') {
      me.move(intent, dt);
      keepInOwnHalf(me);
    }
    this.history.push({ t: this.clock, pos: me.pos.clone() });
    while (this.history.length && this.history[0].t < this.clock - 2) this.history.shift();
  }

  private sendInput(intent: Intent, dt: number): void {
    const json = JSON.stringify(intent);
    this.sinceSend += dt;
    if (json === this.lastSentJson && this.sinceSend < RESEND_EVERY) return;
    this.lastSentJson = json;
    this.sinceSend = 0;
    this.room.send('input', { seq: ++this.seq, intent } satisfies InputMsg);
  }

  // ===== Nhận ảnh chụp từ server =====
  private onSnapshot(s: Snapshot): void {
    // Đồng bộ đồng hồ: lúc nhận, đồng hồ server ~ s.t + nửa vòng khứ hồi
    const sample = s.t + this.rtt / 2 - this.clock;
    if (this.offset === null || Math.abs(sample - this.offset) > 0.25) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.1;

    const prev = this.latest;
    this.latest = s;
    this.snaps.push(s);
    while (this.snaps.length > 2 && this.snaps[0].t < s.t - 1) this.snaps.shift();
    // Ván mới / điểm mới thì đồng hồ trận có thể lùi: bỏ dữ liệu cũ
    if (prev && s.t < prev.t) { this.snaps = [s]; this.offset = sample; }

    this.status = s.status;
    this.rematch = s.rematch;
    this.connectedOpp = s.players[other(this.local)].connected;
    const m = this.match;
    m.phase = s.phase;
    m.score = s.score;
    m.server = s.server;
    m.message = s.message;
    m.lastHitter = s.lastHitter;
    m.rallyShots = s.rallyShots;
    m.rallyId = s.rallyId;
    m.time = s.t;
    m.names = { near: s.players.near.name, far: s.players.far.name };

    this.reconcile(s);
  }

  /** So vị trí server với vị trí mình đã dự đoán ở cùng thời điểm, rồi sửa dần phần lệch */
  private reconcile(s: Snapshot): void {
    const me = this.me;
    const sp = s.players[this.local];
    const serverPos = new THREE.Vector3(...sp.pos);
    if (s.phase === 'serve' || s.phase === 'matchOver' || this.status !== 'playing') {
      me.pos.copy(serverPos);
      me.vel.set(...sp.vel);
      me.chargingShot = s.phase === 'serve' && sp.charging ? me.chargingShot : null;

      this.history = [];
      return;
    }
    this.syncJump(me, sp.jumpT, sp.landLock);
    // Trạng thái server tại s.t được tạo từ phím mình gửi ở thời điểm (client) s.t - offset - rtt/2
    const sentAt = s.t - (this.offset ?? 0) - this.rtt / 2;
    const h = this.history.find((e) => e.t >= sentAt) ?? this.history[this.history.length - 1];
    if (!h) { me.pos.copy(serverPos); return; }
    const err = serverPos.clone().sub(h.pos);
    err.y = 0;
    if (err.length() > SNAP_DIST) {
      me.pos.copy(serverPos);
      me.vel.set(...sp.vel);
      this.history = [];
      return;
    }
    // Kéo về 30% phần lệch mỗi ảnh chụp (20 lần/giây) -> mượt, không giật
    const fix = err.multiplyScalar(0.3);
    me.pos.add(fix);
    for (const e of this.history) if (e.t >= h.t) e.pos.add(fix);
  }

  /**
   * Lấy trạng thái nhảy của mình theo server. Ảnh chụp đã cũ ~nửa vòng khứ hồi nên cộng thêm phần đó.
   * Nếu vừa tự dự đoán bật nhảy mà ảnh chụp (gửi trước khi server nhận phím) chưa thấy nhảy thì giữ dự đoán.
   */
  private syncJump(me: Player, jumpT: number, landLock: number): void {
    const age = this.rtt / 2;
    if (jumpT >= 0) me.jumpT = Math.min(jumpT + age, 0.499);
    else if (this.clock - this.localJumpAt > this.rtt + 0.15) me.jumpT = -1;
    me.landLock = Math.max(0, landLock - age);
  }

  // ===== Mỗi khung hình: chuẩn bị dữ liệu để vẽ =====
  frame(frameDt: number): void {
    const s = this.latest;
    if (!s) return;
    this.interpolateOpponent();
    this.extrapolateShuttle(s);
    this.smoothShuttle(s, frameDt);
  }

  private interpolateOpponent(): void {
    const side = other(this.local);
    const t = this.serverNow - INTERP_DELAY;
    let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
    for (let i = 0; i < this.snaps.length - 1; i++) {
      if (this.snaps[i].t <= t && this.snaps[i + 1].t >= t) { a = this.snaps[i]; b = this.snaps[i + 1]; break; }
    }
    const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
    const pa = a.players[side], pb = b.players[side];
    const p = this.them;
    p.pos.set(...pa.pos).lerp(new THREE.Vector3(...pb.pos), k);
    p.vel.set(...pa.vel).lerp(new THREE.Vector3(...pb.vel), k);
    const src = k < 0.5 ? pa : pb;
    p.chargingShot = src.charging ? 'clear' : null; // chỉ để vợt sáng lên, không lộ loại cú
    p.chargeTime = 0;
    p.swing = src.swingShot ? { shot: src.swingShot, power: 0, aim: 0, t: src.swingT } : null;
    // Đối thủ bật nhảy: thấy được (để biết đường đỡ), nhưng vẫn không biết lực
    p.jumpT = pa.jumpT >= 0 && pb.jumpT >= 0 ? THREE.MathUtils.lerp(pa.jumpT, pb.jumpT, k) : src.jumpT;
  }

  /**
   * Quả cầu: tính trước tới thời điểm "server nhận được phím mình bấm bây giờ" (= hiện tại + nửa vòng khứ hồi).
   * Vật lý giống hệt server nên kết quả trùng khớp, cho tới khi có người đánh trúng (ảnh chụp sau sẽ sửa).
   */
  private extrapolateShuttle(s: Snapshot): void {
    const m = this.match;
    m.shuttlePos.set(...s.shuttlePos);
    m.shuttleVel.set(...s.shuttleVel);
    if (s.phase !== 'rally' || m.shuttleVel.lengthSq() === 0) return;
    const ahead = THREE.MathUtils.clamp(this.serverNow + this.rtt / 2 - s.t, 0, 0.5);
    const steps = Math.round(ahead / FIXED_DT);
    for (let i = 0; i < steps && m.shuttlePos.y > 0; i++) {
      const z0 = m.shuttlePos.z;
      stepShuttle(m.shuttlePos, m.shuttleVel, FIXED_DT);
      if (Math.sign(z0) !== Math.sign(m.shuttlePos.z) && m.shuttlePos.y < NET_H) { // vướng lưới
        m.shuttlePos.z = z0;
        m.shuttleVel.set(0, 0, 0);
        break;
      }
    }
    m.shuttlePos.y = Math.max(0, m.shuttlePos.y);
  }

    /**
   * Làm mượt chỗ quả cầu bị giật.
   * Khi có người đánh trúng, client chỉ biết sau khi ảnh chụp tới (trễ ~nửa vòng khứ hồi), nên quả cầu đã kịp
   * bay quá cây vợt theo quỹ đạo cũ rồi mới nhảy sang quỹ đạo mới. Thay vì nhảy ngay, giữ phần lệch
   * (vị trí đáng lẽ ở đó - vị trí mới) rồi giảm dần về 0 trong khoảng SHUTTLE_BLEND giây: quả cầu "uốn" sang đường mới.
   * Chỉ ảnh hưởng hình vẽ; trúng hay trượt vẫn do server quyết định.
   */
  private smoothShuttle(s: Snapshot, frameDt: number): void {
    const m = this.match;
    const target = m.shuttlePos.clone();
    if (this.prevShuttle && s.phase === 'rally') {
      // Nếu không có gì bất thường, vị trí mới ~ vị trí cũ + vận tốc cũ * thời gian 1 khung hình
      const expected = this.prevShuttle.pos.clone().addScaledVector(this.prevShuttle.vel, frameDt);
      const jump = expected.sub(target);
      const d = jump.length();
      if (d > SHUTTLE_JUMP && d < 4) this.shuttleOffset.add(jump); // giật: giữ phần lệch để trượt dần
      else if (d >= 4) this.shuttleOffset.set(0, 0, 0);            // lệch quá xa (điểm mới...): nhảy luôn
      this.shuttleOffset.multiplyScalar(Math.exp(-frameDt / SHUTTLE_BLEND));
    } else {
      this.shuttleOffset.set(0, 0, 0);
    }
    this.prevShuttle = { pos: target, vel: m.shuttleVel.clone() };
    m.shuttlePos.add(this.shuttleOffset);
    m.shuttlePos.y = Math.max(0, m.shuttlePos.y);
  }

  /** Dòng thông báo theo góc nhìn của mình (server viết theo tên người chơi) */
  get localMessage(): string | null {
    const s = this.latest;
    if (!s) return 'Đang kết nối...';
    const opp = this.match.names[other(this.local)];
    if (s.status === 'waiting') return 'Đang chờ đối thủ vào phòng...';
    if (s.status === 'paused') return s.message; // "X mất kết nối, chờ tối đa 30 giây..."
    if (s.status === 'playing' && s.phase === 'serve') {
      return s.server === this.local
        ? 'Lượt bạn giao: giữ rồi nhả J = giao cao sâu, L = giao ngắn'
        : `${opp} đang giao cầu...`;
    }
    if (s.status === 'over') {
      const mine = this.rematch[this.local], theirs = this.rematch[other(this.local)];
      const vote = !this.connectedOpp ? 'Đối thủ đã rời phòng. Nhấn Esc để về màn hình chính'
        : mine ? `Đã gửi lời mời đấu lại, chờ ${opp}...` : theirs ? `${opp} muốn đấu lại, nhấn R để đồng ý` : 'Nhấn R để mời đấu lại';
      return `${s.message.replace(/\. Nhấn R để chơi lại$/, '')}\n${vote}`;
    }
    return null;
  }
}