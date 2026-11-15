import type { Controller } from '../game/player';
import type { Aim, Intent } from '../shared/types';
import type { Keyboard } from './keyboard';

/**
 * Điều khiển cho người chơi phía near (camera sau lưng, nhìn về -z).
 * - W/S/A/D: di chuyển. Giữ A hoặc D lúc NHẢ phím đánh để đánh chéo sang trái/phải.
 * - Giữ J/K/L để nạp lực, nhả để vung: J phông cầu, K đập cầu, L bỏ nhỏ.
 *   Lúc giao cầu: J = giao cao sâu, L = giao ngắn.
 * - Giữ Shift: chạy nhanh. Nhấn Space: bứt tốc.
 */
export class HumanController implements Controller {
  private readonly kb: Keyboard;

  constructor(kb: Keyboard) {
    this.kb = kb;
  }

  update(): Intent {
    const k = this.kb;
    const left = k.isDown('KeyA'), right = k.isDown('KeyD');
    const aim: Aim = left === right ? 0 : left ? -1 : 1;
    // Giữ nhiều phím cùng lúc thì ưu tiên J > K > L
    const charge: Intent['charge'] =
      k.isDown('KeyJ') ? 'clear' : k.isDown('KeyK') ? 'smash' : k.isDown('KeyL') ? 'drop' : null;
    return {
      moveX: (right ? 1 : 0) - (left ? 1 : 0),
      moveZ: (k.isDown('KeyS') ? 1 : 0) - (k.isDown('KeyW') ? 1 : 0),
      charge,
      aim,
      sprint: k.isDown('ShiftLeft') || k.isDown('ShiftRight'),
      dash: k.consume('Space'),
    };
  }
}