/**
 * Theo dõi bàn phím.
 * - isDown: phím đang được giữ (dùng cho di chuyển)
 * - consume: phím vừa được nhấn (chỉ trả về true một lần cho mỗi lần nhấn, dùng cho vung vợt)
 */
export class Keyboard {
  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault(); // không cho Space cuộn trang
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear()); // chuyển tab thì nhả hết phím
  }

  isDown(code: string): boolean { return this.down.has(code); }

  consume(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }
}