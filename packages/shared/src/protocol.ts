import type { Match } from './match';
import type { Player } from './player';
import type { Aim, Intent, Phase, Score, ShotType, Side } from './types';

/**
 * "Hợp đồng" giữa client và server khi chơi online: tên phòng, các loại tin nhắn và dữ liệu bên trong.
 * Cả 2 bên import cùng file này nên nếu đổi một trường mà quên sửa bên kia thì TypeScript báo lỗi ngay.
 */
export const ROOM_NAME = 'duel';
export const SERVER_PORT = 2567;
export const SNAPSHOT_HZ = 20;          // server gửi trạng thái 20 lần/giây
export const RECONNECT_SECONDS = 30;    // rớt mạng thì giữ chỗ 30 giây
export const EMPTY_ROOM_MINUTES = 10;   // tạo phòng mà 10 phút không ai vào thì hủy
export const NAME_MAX = 16;

type Vec3 = [number, number, number];

/** Trạng thái phòng (khác Phase của trận: đây là chuyện kết nối) */
export type RoomStatus = 'waiting' | 'playing' | 'paused' | 'over';

// ===== Client -> Server =====
/** 'input': ý định điều khiển hiện tại. seq tăng dần để client biết server đã nhận tới đâu */
export interface InputMsg { seq: number; intent: Intent }
// 'rematch': không có dữ liệu, nghĩa là "tôi muốn đấu ván mới"

// ===== Server -> Client =====
/** 'welcome': gửi riêng cho từng người lúc vào phòng (hoặc vào lại) */
export interface WelcomeMsg { side: Side; code: string }

/** Phần CÔNG KHAI của một người chơi: ai cũng được thấy */
export interface PlayerSnap {
  name: string;
  connected: boolean;
  pos: Vec3;
  vel: Vec3;
  charging: boolean;        // đang giữ phím (đối thủ thấy vợt sáng, nhưng không biết lực bao nhiêu)
  swingShot: ShotType | null;
  swingT: number;           // thời gian từ lúc bắt đầu vung (giây), dùng cho hoạt ảnh
}

/** 'snap': ảnh chụp trạng thái trận, gửi cho cả phòng SNAPSHOT_HZ lần/giây */
export interface Snapshot {
  t: number;                // đồng hồ trận của server (giây)
  status: RoomStatus;
  phase: Phase;
  score: Score;
  server: Side;
  message: string;
  lastHitter: Side | null;
  rallyShots: number;
  rallyId: number;
  shuttlePos: Vec3;
  shuttleVel: Vec3;
  players: Record<Side, PlayerSnap>;
  rematch: Record<Side, boolean>;
}

/**
 * 'me': phần RIÊNG TƯ, server chỉ gửi cho đúng người đó.
 * Thể lực và lực đang nạp là thông tin đối thủ không được biết (như đã chốt ở bước 2).
 */
export interface PrivateSnap { stamina: number; chargeTime: number; chargeAim: Aim; ackSeq: number }

// ===== Hàm chuyển đổi dùng chung =====
const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const vec = (v: { x: number; y: number; z: number }): Vec3 => [r3(v.x), r3(v.y), r3(v.z)];

export function playerSnap(p: Player, name: string, connected: boolean): PlayerSnap {
  return {
    name, connected, pos: vec(p.pos), vel: vec(p.vel), charging: p.chargingShot !== null,
    swingShot: p.swing?.shot ?? null, swingT: p.swing?.t ?? 0,
  };
}

export function makeSnapshot(
  m: Match, status: RoomStatus, connected: Record<Side, boolean>, rematch: Record<Side, boolean>,
): Snapshot {
  return {
    t: m.time, status, phase: m.phase, score: { ...m.score }, server: m.server, message: m.message,
    lastHitter: m.lastHitter, rallyShots: m.rallyShots, rallyId: m.rallyId,
    shuttlePos: vec(m.shuttlePos), shuttleVel: vec(m.shuttleVel),
    players: {
      near: playerSnap(m.players.near, m.names.near, connected.near),
      far: playerSnap(m.players.far, m.names.far, connected.far),
    },
    rematch: { ...rematch },
  };
}

/** Làm sạch tên người chơi gửi lên (không tin dữ liệu từ client) */
export function cleanName(raw: unknown, fallback: string): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
  return s || fallback;
}

const SHOTS: readonly ShotType[] = ['clear', 'smash', 'drop', 'serveLong', 'serveShort'];

/** Kiểm tra Intent client gửi lên: sai kiểu hoặc vượt giới hạn thì sửa về giá trị an toàn */
export function cleanIntent(raw: unknown): Intent {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  const aim = num(o.aim);
  return {
    moveX: num(o.moveX),
    moveZ: num(o.moveZ),
    charge: SHOTS.includes(o.charge as ShotType) ? (o.charge as ShotType) : null,
    aim: (aim < -0.5 ? -1 : aim > 0.5 ? 1 : 0) as Aim,
    sprint: o.sprint === true,
    dash: o.dash === true,
  };
}