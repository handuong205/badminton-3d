import { Room, type Client } from '@colyseus/core';
import { Match } from '@badminton/shared/match';
import { Player } from '@badminton/shared/player';
import { FIXED_DT } from '@badminton/shared/physics';
import {
  EMPTY_ROOM_MINUTES, RECONNECT_SECONDS, SNAPSHOT_HZ,
  cleanIntent, cleanName, makeSnapshot,
  type PrivateSnap, type RoomStatus, type WelcomeMsg,
} from '@badminton/shared/protocol';
import { other, type Side } from '@badminton/shared/types';
import { RemoteController } from './remoteController';

const SIDES = ['near', 'far'] as const;
const DEFAULT_NAMES: Record<Side, string> = { near: 'Người chơi 1', far: 'Người chơi 2' };
/** Mã phòng 6 chữ số (menu chỉ cho nhập số), dễ đọc cho nhau qua điện thoại */
const makeCode = () => String(Math.floor(100000 + Math.random() * 900000));

/**
 * Phòng đấu 1-1. Server là "trọng tài" duy nhất (authoritative):
 * - Chạy Match thật ở đây, cùng code với chế độ chơi với máy (packages/shared).
 * - Client chỉ gửi Intent (phím đang bấm), không bao giờ gửi vị trí hay kết quả cú đánh,
 *   nên không thể gian lận kiểu "tôi đánh trúng" hay "tôi đứng ở chỗ này".
 * - SNAPSHOT_HZ lần/giây gửi ảnh chụp trạng thái cho cả phòng ('snap'),
 *   kèm phần riêng tư cho từng người ('me': thể lực, lực đang nạp).
 */
export class DuelRoom extends Room {
  maxClients = 2;

  private match!: Match;
  private readonly ctrls: Record<Side, RemoteController> = { near: new RemoteController(), far: new RemoteController() };
  private readonly seats: Record<Side, string | null> = { near: null, far: null };   // sessionId đang giữ chỗ
  private readonly connected: Record<Side, boolean> = { near: false, far: false };
  private rematch: Record<Side, boolean> = { near: false, far: false };
  private status: RoomStatus = 'waiting';
  private simAcc = 0;
  private snapAcc = 0;

  onCreate(): void {
    this.roomId = makeCode(); // mã phòng chính là roomId, client vào bằng joinById(mã)

    const near = new Player('near', false, { aimErrorDeg: 2 });
    const far = new Player('far', false, { aimErrorDeg: 2 });
    near.controller = this.ctrls.near;
    far.controller = this.ctrls.far;
    this.match = new Match(near, far);
    this.match.names = { ...DEFAULT_NAMES };

    this.onMessage('input', (client, msg: unknown) => {
      const side = this.sideOf(client);
      if (!side || this.status === 'over') return;
      const o = (typeof msg === 'object' && msg !== null ? msg : {}) as { seq?: unknown; intent?: unknown };
      if (typeof o.seq !== 'number' || !Number.isFinite(o.seq)) return;
      this.ctrls[side].receive(o.seq, cleanIntent(o.intent));
    });

    this.onMessage('rematch', (client) => {
      const side = this.sideOf(client);
      if (!side || this.status !== 'over') return;
      this.rematch[side] = true;
      // Đối thủ đã rời hẳn thì không đấu lại được
      if (this.rematch.near && this.rematch.far && this.connected.near && this.connected.far) this.startMatch();
    });

    // Không có trạng thái Schema: tự gửi snapshot bằng tin nhắn nên tắt patch tự động
    this.patchRate = null;
    this.setTimestep((ms) => this.tick(ms / 1000), FIXED_DT * 1000);

    // Tạo phòng mà lâu không có đối thủ vào thì hủy, đỡ tốn tài nguyên server
    this.clock.setTimeout(() => {
      if (this.status === 'waiting') this.disconnect();
    }, EMPTY_ROOM_MINUTES * 60_000);
  }

  onJoin(client: Client, options?: { name?: unknown }): void {
    const side: Side = this.seats.near === null ? 'near' : 'far';
    this.seats[side] = client.sessionId;
    this.connected[side] = true;
    this.match.names[side] = cleanName(options?.name, DEFAULT_NAMES[side]);
    this.sendWelcome(client, side);
    if (this.seats.near && this.seats.far) {
      void this.lock();
      this.startMatch();
    }
  }

  /** Rớt mạng (không chủ động thoát): giữ chỗ RECONNECT_SECONDS giây, tạm dừng trận */
  onDrop(client: Client): void {
    const side = this.sideOf(client);
    if (!side) return;
    this.connected[side] = false;
    this.ctrls[side].releaseAll();
    if (this.status === 'playing') this.status = 'paused';
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: Client): void {
    const side = this.sideOf(client);
    if (!side) return;
    this.connected[side] = true;
    this.sendWelcome(client, side);
    if (this.status === 'paused' && this.connected.near && this.connected.far) this.status = 'playing';
  }

  /** Rời hẳn: tự thoát, hoặc rớt mạng quá RECONNECT_SECONDS giây */
  onLeave(client: Client): void {
    const side = this.sideOf(client);
    if (!side) return;
    this.connected[side] = false;
    this.ctrls[side].releaseAll();
    if (this.status === 'playing' || this.status === 'paused') {
      this.match.forfeit(other(side), `${this.match.names[side]} đã rời trận`);
      this.status = 'over';
    }
    if (this.status === 'waiting') {
      // Chưa đấu mà người duy nhất trong phòng rời đi: nhả chỗ (phòng trống sẽ tự hủy)
      this.seats[side] = null;
      this.match.names[side] = DEFAULT_NAMES[side];
    }
    this.rematch[side] = false;
  }

  private sideOf(client: Client): Side | null {
    return SIDES.find((s) => this.seats[s] === client.sessionId) ?? null;
  }

  private sendWelcome(client: Client, side: Side): void {
    const msg: WelcomeMsg = { side, code: this.roomId };
    client.send('welcome', msg);
  }

  /** Ván mới, bốc thăm ai giao trước */
  private startMatch(): void {
    this.rematch = { near: false, far: false };
    for (const s of SIDES) this.ctrls[s].releaseAll();
    this.match.restart(Math.random() < 0.5 ? 'near' : 'far');
    this.status = 'playing';
    this.simAcc = 0;
  }

  private tick(dt: number): void {
    if (this.status === 'playing') {
      // Bộ hẹn giờ của server không đều tuyệt đối: dồn thời gian rồi chạy đúng số bước cố định
      this.simAcc = Math.min(this.simAcc + dt, 0.25);
      while (this.simAcc >= FIXED_DT) {
        this.match.update(FIXED_DT);
        this.simAcc -= FIXED_DT;
      }
      if (this.match.phase === 'matchOver') this.status = 'over';
    }

    this.snapAcc += dt;
    if (this.snapAcc < 1 / SNAPSHOT_HZ) return;
    this.snapAcc = 0;
    this.sendSnapshots();
  }

  private sendSnapshots(): void {
    const snap = makeSnapshot(this.match, this.status, this.connected, this.rematch);
    if (this.status === 'waiting') {
      snap.message = `Đang chờ đối thủ... Mã phòng: ${this.roomId}`;
    } else if (this.status === 'paused') {
      const lost = SIDES.find((s) => !this.connected[s])!;
      snap.message = `${this.match.names[lost]} mất kết nối, chờ tối đa ${RECONNECT_SECONDS} giây...`;
    }
    this.broadcast('snap', snap);

    for (const s of SIDES) {
      const id = this.seats[s];
      const client = id ? this.clients.find((c) => c.sessionId === id) : undefined;
      if (!client) continue;
      const p = this.match.players[s];
      const me: PrivateSnap = {
        stamina: Math.round(p.stamina * 10) / 10,
        chargeTime: p.chargeTime,
        chargeAim: p.chargeAim,
        ackSeq: this.ctrls[s].lastSeq,
      };
      client.send('me', me);
    }
  }
}
