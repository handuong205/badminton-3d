import type { Match } from "@badminton/shared/match";
import { other, type Side } from "@badminton/shared/types";

/** Chỉ bật tính năng tải log (phím P) khi chạy dev; bản build deploy sẽ ẩn đi. */
export const LOG_DOWNLOAD_ENABLED = import.meta.env.DEV;

/**
 * HUD vẽ bằng HTML + Tailwind, nằm đè lên canvas.
 * - Góc trên trái: bảng tỉ số (chấm vàng = bên đang giao) + dòng phụ (mã phòng, ping...).
 * - Giữa trên: banner thông báo.
 * - Góc dưới trái: hướng dẫn phím dạng keycap.
 * Luôn viết theo góc nhìn người chơi trên máy này: "Bạn" là mình, bên kia là tên đối thủ (hoặc "Máy").
 * DOM chỉ dựng 1 lần, mỗi frame chỉ cập nhật khi giá trị thay đổi để tránh tốn layout.
 */
export class Hud {
  private readonly match: Match;
  private readonly local: Side;
  /** Dòng phụ, ví dụ mã phòng / trạng thái kết nối khi chơi online */
  extra = "";
  /** Ghi đè thông báo của trận (online: đổi "Lượt Han giao..." thành "Lượt bạn giao...") */
  messageOverride: string | null = null;
  /** Dòng cuối của hướng dẫn phím (offline và online khác nhau) */
  lastHelpLine = "";

  private readonly scoreEls: Record<Side, HTMLElement>;
  private readonly serveEls: Record<Side, HTMLElement>;
  private readonly oppName: HTMLElement;
  private readonly extraEl: HTMLElement;
  private readonly helpLine: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly invite: HTMLElement;
  private readonly inviteUrl: HTMLElement;
  private readonly inviteBtn: HTMLButtonElement;
  private inviteLink = "";
  private last = {
    near: -1,
    far: -1,
    server: "",
    message: "\u0000",
    opp: "",
    extra: "\u0000",
    help: "\u0000",
  };

  constructor(match: Match, local: Side = "near") {
    this.match = match;
    this.local = local;
    const me = local,
      opp = other(local);
    const hud = document.getElementById("hud")!;
    const help = document.getElementById("help")!;

    hud.innerHTML = `
      <div class="overflow-hidden rounded-xl border border-white/10 bg-slate-900/70 shadow-lg shadow-black/40 backdrop-blur-md">
        <div class="bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Tỉ số</div>
        ${row(me, "Bạn", me === "near" ? "bg-blue-500" : "bg-red-500")}
        <div class="h-px bg-white/10"></div>
        ${row(opp, "", opp === "near" ? "bg-blue-500" : "bg-red-500")}
      </div>
      <div data-extra hidden class="mt-2 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-1.5 text-xs text-white/70 backdrop-blur-md"></div>
      <div data-invite hidden class="pointer-events-auto mt-2 rounded-lg border border-emerald-400/30 bg-slate-900/80 p-2.5 text-xs text-white/70 shadow-lg shadow-black/40 backdrop-blur-md">
        <div class="mb-1">Gửi link này cho bạn để vào thẳng phòng:</div>
        <div data-invite-url class="select-all break-all font-mono text-[11px] text-emerald-300"></div>
        <button data-invite-copy type="button" class="mt-2 w-full rounded-md bg-emerald-500 px-2 py-1 font-semibold text-white transition hover:bg-emerald-400">Copy link mời (C)</button>
      </div>`;

    const keys = (...k: string[]) => k.map(kbd).join("");
    const item = (k: string, label: string) =>
      `<div class="flex items-center gap-1.5"><span class="flex gap-0.5">${k}</span><span>${label}</span></div>`;
    help.innerHTML = `
      <div class="grid grid-cols-[auto_auto] gap-x-5 gap-y-1.5 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2.5 text-xs text-white/80 shadow-lg shadow-black/40 backdrop-blur-md">
        ${item(keys("W", "A", "S", "D"), "Di chuyển")}
        ${item(keys("Shift"), "Chạy nhanh")}
        ${item(keys("Space"), "Bứt tốc")}
        ${item(keys("Q", "E"), "Đánh trái / phải")}
        <div class="col-span-2 mt-1 border-t border-white/10 pt-1.5 text-[10px] uppercase tracking-wider text-white/40">Giữ để nạp lực · nhả để vung</div>
        ${item(keys("J"), "Phông cầu")}
        ${item(keys("K"), "Đập cầu (thanh vàng: nhả = nhảy đập)")}
        ${item(keys("L"), "Bỏ nhỏ")}
        <div></div>
        <div data-help-line class="col-span-2 mt-1 border-t border-white/10 pt-1.5 text-white/60"></div>
      </div>`;

    // Banner thông báo ở giữa phía trên (whitespace-pre-line: thông báo online có thể 2 dòng)
    this.banner = document.createElement("div");
    this.banner.className =
      "pointer-events-none fixed top-4 left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2 whitespace-pre-line rounded-2xl border border-white/10 bg-slate-900/70 px-5 py-2 text-center text-sm font-medium text-white shadow-lg shadow-black/40 backdrop-blur-md transition-opacity duration-300";
    document.body.appendChild(this.banner);

    this.scoreEls = {
      near: hud.querySelector('[data-score="near"]')!,
      far: hud.querySelector('[data-score="far"]')!,
    };
    this.serveEls = {
      near: hud.querySelector('[data-serve="near"]')!,
      far: hud.querySelector('[data-serve="far"]')!,
    };
    this.oppName = hud.querySelector(`[data-name="${opp}"]`)!;
    this.extraEl = hud.querySelector("[data-extra]")!;
    this.invite = hud.querySelector("[data-invite]")!;
    this.inviteUrl = hud.querySelector("[data-invite-url]")!;
    this.inviteBtn = hud.querySelector("[data-invite-copy]")!;
    this.inviteBtn.onclick = () => this.copyInvite();
    this.helpLine = help.querySelector("[data-help-line]")!;
  }

  update(): void {
    const m = this.match;
    const l = this.last;
    for (const s of ["near", "far"] as const) {
      if (m.score[s] !== l[s]) this.bump(this.scoreEls[s], (l[s] = m.score[s]));
    }
    if (m.server !== l.server) {
      l.server = m.server;
      for (const s of ["near", "far"] as const)
        this.serveEls[s].style.opacity = m.server === s ? "1" : "0";
    }
    const opp = m.names[other(this.local)];
    if (opp !== l.opp) this.oppName.textContent = l.opp = opp;

    const message = this.messageOverride ?? m.message;
    if (message !== l.message) {
      l.message = message;
      this.banner.textContent = message;
      this.banner.style.opacity = message ? "1" : "0";
    }
    if (this.extra !== l.extra) {
      l.extra = this.extra;
      this.extraEl.textContent = this.extra;
      this.extraEl.hidden = !this.extra;
    }
    if (this.lastHelpLine !== l.help) {
      l.help = this.lastHelpLine;
      this.helpLine.textContent = this.lastHelpLine;
      this.helpLine.hidden = !this.lastHelpLine;
    }
  }

  /** Hiện khung link mời (đang chờ đối thủ) hoặc ẩn đi (null) */
  setInvite(link: string | null): void {
    if ((link ?? "") === this.inviteLink) return;
    this.inviteLink = link ?? "";
    this.inviteUrl.textContent = this.inviteLink;
    this.invite.hidden = !link;
  }

  /** Copy link mời vào clipboard. Trình duyệt chặn thì nhắc người chơi tự bôi đen */
  copyInvite(): void {
    if (!this.inviteLink) return;
    const done = (text: string) => {
      this.inviteBtn.textContent = text;
      setTimeout(() => {
        this.inviteBtn.textContent = "Copy link mời (C)";
      }, 1500);
    };
    const fail = () => done("Không copy được, hãy bôi đen link");
    if (!navigator.clipboard) {
      fail();
      return;
    } // chỉ có trên https hoặc localhost
    navigator.clipboard
      .writeText(this.inviteLink)
      .then(() => done("Đã copy ✓"), fail);
  }

  /** Đổi số và cho nảy nhẹ khi ghi điểm. */
  private bump(el: HTMLElement, value: number): void {
    el.textContent = String(value);
    el.animate(
      [
        { transform: "scale(1.5)", color: "#facc15" },
        { transform: "scale(1)", color: "inherit" },
      ],
      { duration: 400, easing: "ease-out" },
    );
  }
}

function row(side: Side, name: string, color: string): string {
  return `
    <div class="flex items-center gap-2.5 px-3 py-1.5">
      <span class="h-5 w-1 shrink-0 rounded-full ${color}"></span>
      <span data-name="${side}" class="min-w-0 truncate text-sm font-semibold text-white">${name}</span>
      <span data-serve="${side}" title="Đang giao" class="h-2 w-2 shrink-0 rounded-full bg-yellow-400 opacity-0 shadow-[0_0_6px_#facc15] transition-opacity"></span>
      <span data-score="${side}" class="ml-auto inline-block min-w-[2ch] text-right font-mono text-xl font-bold tabular-nums text-white">0</span>
    </div>`;
}

function kbd(k: string): string {
  return `<kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/20 border-b-2 bg-white/10 px-1 font-mono text-[10px] font-semibold text-white">${k}</kbd>`;
}
