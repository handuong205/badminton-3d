// Kiểu dữ liệu dùng chung. Không phụ thuộc phần vẽ, để sau này server (bước 3) dùng lại được.

/** near = phía người chơi (z > 0), far = phía bên kia lưới (z < 0) */
export type Side = 'near' | 'far';

/**
 * Loại cú đánh. 'drive' (đánh ngang) không có phím riêng: bấm K (đập) khi cầu đã xuống thấp
 * hơn SMASH_MIN_HEIGHT thì thành drive, vì cầu thấp thì không thể đập cắm xuống được.
 */
export type ShotType = 'clear' | 'smash' | 'drop' | 'serveLong' | 'serveShort' | 'drive';

/** Hướng đánh sang trái/giữa/phải, tính theo góc nhìn của người đánh */
export type Aim = -1 | 0 | 1;

/** Ý định của một người chơi trong một bước mô phỏng (do bàn phím hoặc AI tạo ra) */
export interface Intent {
  moveX: number;          // -1..1 theo trục x của thế giới
  moveZ: number;          // -1..1 theo trục z của thế giới
  charge: ShotType | null; // đang GIỮ phím của cú nào (null = không giữ). Nhả phím = vung vợt
  aim: Aim;
  sprint: boolean;        // đang giữ Shift
  dash: boolean;          // vừa nhấn Space
}

export type Phase = 'serve' | 'rally' | 'pointOver' | 'matchOver';

export interface Score {
  near: number;
  far: number;
}

export type PointReason = 'in' | 'out' | 'serveFault' | 'net';

export const other = (s: Side): Side => (s === 'near' ? 'far' : 'near');
/** Dấu trục z của phần sân mỗi bên */
export const sideSign = (s: Side): 1 | -1 => (s === 'near' ? 1 : -1);