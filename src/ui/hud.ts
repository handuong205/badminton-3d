import type { Match } from '../game/match';

/** Chỉ bật tính năng tải log (phím P) khi chạy dev; bản build deploy sẽ ẩn đi. */
export const LOG_DOWNLOAD_ENABLED = import.meta.env.DEV;

/**
 * HUD vẽ bằng HTML + Tailwind, nằm đè lên canvas.
 * - Góc trên trái: bảng tỉ số (chấm vàng = bên đang giao).
 * - Giữa trên: banner thông báo.
 * - Góc dưới trái: hướng dẫn phím dạng keycap.
 * DOM chỉ dựng 1 lần, mỗi frame chỉ cập nhật khi giá trị thay đổi để tránh tốn layout.
 */
export class Hud {
  private readonly match: Match;
  private readonly scoreNear: HTMLElement;
  private readonly scoreFar: HTMLElement;
  private readonly serveNear: HTMLElement;
  private readonly serveFar: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly logCountEl: HTMLElement | null;
  private last = { near: -1, far: -1, server: '', message: '\0', log: -1 };

  constructor(match: Match) {
    this.match = match;
    const hud = document.getElementById('hud')!;
    const help = document.getElementById('help')!;

    hud.innerHTML = `
      <div class="overflow-hidden rounded-xl border border-white/10 bg-slate-900/70 shadow-lg shadow-black/40 backdrop-blur-md">
        <div class="bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Tỉ số</div>
        ${row('near', 'Bạn', 'bg-blue-500')}
        <div class="h-px bg-white/10"></div>
        ${row('far', 'Máy', 'bg-red-500')}
      </div>`;

    const keys = (...k: string[]) => k.map(kbd).join('');
    const item = (k: string, label: string) =>
      `<div class="flex items-center gap-1.5"><span class="flex gap-0.5">${k}</span><span>${label}</span></div>`;
    help.innerHTML = `
      <div class="grid grid-cols-[auto_auto] gap-x-5 gap-y-1.5 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2.5 text-xs text-white/80 shadow-lg shadow-black/40 backdrop-blur-md">
        ${item(keys('W', 'A', 'S', 'D'), 'Di chuyển')}
        ${item(keys('Shift'), 'Chạy nhanh')}
        ${item(keys('Space'), 'Bứt tốc')}
        ${item(keys('R'), 'Chơi lại')}
        <div class="col-span-2 mt-1 border-t border-white/10 pt-1.5 text-[10px] uppercase tracking-wider text-white/40">Giữ để nạp lực · nhả để vung</div>
        ${item(keys('J'), 'Phông cầu')}
        ${item(keys('K'), 'Đập cầu')}
        ${item(keys('L'), 'Bỏ nhỏ')}
        ${item(keys('Q', 'E'), 'Đánh trái / phải')}
        ${LOG_DOWNLOAD_ENABLED ? item(keys('P'), 'Tải log (<span data-log>0</span>)') : ''}
      </div>`;

    // Banner thông báo ở giữa phía trên
    const banner = document.createElement('div');
    banner.className =
      'pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-slate-900/70 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-black/40 backdrop-blur-md transition-opacity duration-300';
    document.body.appendChild(banner);

    this.scoreNear = hud.querySelector('[data-score="near"]')!;
    this.scoreFar = hud.querySelector('[data-score="far"]')!;
    this.serveNear = hud.querySelector('[data-serve="near"]')!;
    this.serveFar = hud.querySelector('[data-serve="far"]')!;
    this.msg = banner;
    this.logCountEl = help.querySelector('[data-log]');
  }

  update(logCount: number): void {
    const m = this.match;
    const l = this.last;
    if (m.score.near !== l.near) this.bump(this.scoreNear, (l.near = m.score.near));
    if (m.score.far !== l.far) this.bump(this.scoreFar, (l.far = m.score.far));
    if (m.server !== l.server) {
      l.server = m.server;
      this.serveNear.style.opacity = m.server === 'near' ? '1' : '0';
      this.serveFar.style.opacity = m.server === 'far' ? '1' : '0';
    }
    if (m.message !== l.message) {
      l.message = m.message;
      this.msg.textContent = m.message;
      this.msg.style.opacity = m.message ? '1' : '0';
    }
    if (this.logCountEl && logCount !== l.log) {
      l.log = logCount;
      this.logCountEl.textContent = String(logCount);
    }
  }

  /** Đổi số và cho nảy nhẹ khi ghi điểm. */
  private bump(el: HTMLElement, value: number): void {
    el.textContent = String(value);
    el.animate(
      [{ transform: 'scale(1.5)', color: '#facc15' }, { transform: 'scale(1)', color: 'inherit' }],
      { duration: 400, easing: 'ease-out' },
    );
  }
}

function row(side: string, name: string, color: string): string {
  return `
    <div class="flex items-center gap-2.5 px-3 py-1.5">
      <span class="h-5 w-1 rounded-full ${color}"></span>
      <span class="w-12 text-sm font-semibold text-white">${name}</span>
      <span data-serve="${side}" title="Đang giao" class="h-2 w-2 rounded-full bg-yellow-400 shadow-[0_0_6px_#facc15] transition-opacity"></span>
      <span data-score="${side}" class="ml-auto inline-block min-w-[2ch] text-right font-mono text-xl font-bold tabular-nums text-white">0</span>
    </div>`;
}

function kbd(k: string): string {
  return `<kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/20 border-b-2 bg-white/10 px-1 font-mono text-[10px] font-semibold text-white">${k}</kbd>`;
}
