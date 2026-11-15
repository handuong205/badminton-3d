import type { Controller } from '@badminton/shared/player';
import type { Intent } from '@badminton/shared/types';

/**
 * Controller cho người chơi ở xa: không đọc bàn phím mà dùng Intent mới nhất client gửi lên.
 * Match không phân biệt được đây là người thật, AI hay bàn phím: vẫn chỉ là một Controller (pattern từ bước 2).
 */
export class RemoteController implements Controller {
  private intent: Intent = { moveX: 0, moveZ: 0, charge: null, aim: 0, sprint: false, dash: false };
  private dashPending = false;
  private chargeSeen = true;  // phím đánh vừa nhấn đã được Match "thấy" ít nhất 1 bước chưa
  private lastCharge: Intent['charge'] = null;
  lastSeq = 0;

  /** Gọi khi nhận tin 'input'. Tin đến trễ (seq cũ hơn) thì bỏ qua */
  receive(seq: number, intent: Intent): void {
    if (seq <= this.lastSeq) return;
    this.lastSeq = seq;
    this.intent = intent;
    // Space là "vừa nhấn" (1 lần). Giữ lại tới khi Match dùng, để không bị mất giữa 2 bước mô phỏng
    if (intent.dash) this.dashPending = true;
    // Nhấn rồi nhả rất nhanh (chặn cú đập): 2 tin có thể tới trong cùng 1 bước mô phỏng,
    // tin "nhả" sẽ đè tin "nhấn" và cú đánh bị mất. Nhớ lại lần nhấn để Match thấy ít nhất 1 bước
    if (intent.charge) { this.lastCharge = intent.charge; this.chargeSeen = false; }
  }

  /** Rớt mạng: thả hết phím để nhân vật đứng yên, không giữ lực mãi */
  releaseAll(): void {
    this.intent = { moveX: 0, moveZ: 0, charge: null, aim: 0, sprint: false, dash: false };
    this.dashPending = false;
    this.chargeSeen = true;
  }

  update(): Intent {
    const dash = this.dashPending;
    this.dashPending = false;
    let charge = this.intent.charge;
    if (!charge && !this.chargeSeen) charge = this.lastCharge; // lần nhấn bị đè: trả về 1 bước
    this.chargeSeen = true;
    return { ...this.intent, charge, dash };
  }
}