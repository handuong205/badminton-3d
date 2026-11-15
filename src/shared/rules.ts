// Luật cầu lông đánh đơn (theo luật BWF, đã lược giản)
import type { Score, Side } from './types';
import { sideSign } from './types';

// ===== Kích thước sân (mét) =====
export const COURT_LEN = 13.4;
export const HALF_LEN = COURT_LEN / 2;      // 6.7: từ lưới tới đường biên cuối
export const DOUBLES_HALF_W = 6.1 / 2;      // 3.05
export const SINGLES_HALF_W = 5.18 / 2;     // 2.59: đánh đơn dùng biên dọc trong
export const SHORT_SERVICE = 1.98;          // vạch giao cầu ngắn, tính từ lưới
export const NET_H = 1.55;

export const WIN_POINTS = 21;
export const MAX_POINTS = 30;

/** Cầu rơi trong sân đánh đơn? (rơi trúng vạch tính là trong) */
export function isInSinglesCourt(x: number, z: number): boolean {
  return Math.abs(x) <= SINGLES_HALF_W && Math.abs(z) <= HALF_LEN;
}

/**
 * Giao cầu từ ô phải khi điểm của người giao là số chẵn, ô trái khi lẻ.
 * "Phải" tính theo góc nhìn của người đứng ở bên đó (đối mặt với lưới).
 * Người phía near nhìn về -z nên bên phải là +x; người phía far thì ngược lại.
 */
export function serveFromRight(serverScore: number): boolean {
  return serverScore % 2 === 0;
}

/** Hướng x (dấu) của ô phải/trái của một bên */
export function courtXSign(side: Side, right: boolean): 1 | -1 {
  const s = side === 'near' ? 1 : -1;
  return (right ? s : -s) as 1 | -1;
}

/**
 * Ô nhận giao cầu (chéo góc với người giao).
 * Hai người đối mặt nhau nên "ô phải của người giao" chéo với "ô phải của người nhận".
 */
export function isInServiceBox(x: number, z: number, receiver: Side, right: boolean): boolean {
  const xs = courtXSign(receiver, right);
  const zs = sideSign(receiver);
  const xOk = x * xs >= 0 && Math.abs(x) <= SINGLES_HALF_W;
  const zOk = z * zs >= SHORT_SERVICE && Math.abs(z) <= HALF_LEN;
  return xOk && zOk;
}

/** Ván đấu kết thúc chưa: 21 điểm và cách 2 điểm, tối đa 30 */
export function gameWinner(score: Score): Side | null {
  for (const s of ['near', 'far'] as const) {
    const me = score[s];
    const opp = score[s === 'near' ? 'far' : 'near'];
    if (me >= MAX_POINTS) return s;
    if (me >= WIN_POINTS && me - opp >= 2) return s;
  }
  return null;
}