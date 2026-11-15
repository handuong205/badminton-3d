import type { Match } from "../game/match";

/** HUD vẽ bằng HTML + Tailwind, nằm đè lên canvas */
export class Hud {
  private readonly el: HTMLElement;
  private readonly match: Match;

  constructor(match: Match) {
    this.match = match;
    this.el = document.getElementById("hud")!;
  }

  update(logCount: number): void {
    const m = this.match;
    const serve = m.server === "near" ? "Bạn" : "Máy";
    this.el.textContent =
      `Tỉ số  Bạn ${m.score.near} - ${m.score.far} Máy   (giao: ${serve})\n` +
      `${m.message}\n\n` +
      `WASD di chuyển | Giữ Shift chạy nhanh | Space bứt tốc\n` +
      `GIỮ J/K/L nạp lực, NHẢ để vung: J phông | K đập | L bỏ nhỏ\n` +
      `Giữ A/D lúc nhả để đánh chéo | R chơi lại | P tải log (${logCount} dòng)`;
  }
}
