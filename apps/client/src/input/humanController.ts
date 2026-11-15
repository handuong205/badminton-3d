import type { Controller } from '@badminton/shared/player';
import { sideSign, type Aim, type Intent, type Side } from '@badminton/shared/types';
import type { Keyboard } from './keyboard';

/**
 * Điều khiển cho người chơi phía near (camera sau lưng, nhìn về -z).
 * - W/S/A/D: chỉ để di chuyển.
 * - Giữ Q hoặc E lúc NHẢ phím đánh: đánh sang trái / phải (không giữ = đánh giữa).
 *   Tách riêng khỏi A/D để đang chạy ngang đón cầu không vô tình đánh chéo.
 * - Giữ J/K/L để nạp lực, nhả để vung: J phông cầu, K đập cầu, L bỏ nhỏ.
 *   Lúc giao cầu: J = giao cao sâu, L = giao ngắn.
 * - Giữ Shift: chạy nhanh. Nhấn Space: bứt tốc.
 */
export class HumanController implements Controller {
  private readonly kb: Keyboard;
  /** Phía far (online) nhìn ngược lại nên W/S/A/D phải đảo trục thế giới */
  private readonly s: 1 | -1;

  constructor(kb: Keyboard, side: Side = 'near') {
    this.kb = kb;
    this.s = sideSign(side);
  }

  update(): Intent {
    const k = this.kb;
    const left = k.isDown('KeyA'), right = k.isDown('KeyD');
    const aimL = k.isDown('KeyQ'), aimR = k.isDown('KeyE');
    const aim: Aim = aimL === aimR ? 0 : aimL ? -1 : 1;
    // Giữ nhiều phím cùng lúc thì ưu tiên J > K > L
    const charge: Intent['charge'] =
      k.isDown('KeyJ') ? 'clear' : k.isDown('KeyK') ? 'smash' : k.isDown('KeyL') ? 'drop' : null;
    return {
      moveX: this.s * ((right ? 1 : 0) - (left ? 1 : 0)),
      moveZ: this.s * ((k.isDown('KeyS') ? 1 : 0) - (k.isDown('KeyW') ? 1 : 0)),
      charge,
      aim,
      sprint: k.isDown('ShiftLeft') || k.isDown('ShiftRight'),
      dash: k.consume('Space'),
    };
  }
}