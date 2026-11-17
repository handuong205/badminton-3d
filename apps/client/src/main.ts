import * as THREE from 'three';
import './style.css';
import { Client, type Room } from '@colyseus/sdk';
import { Match } from '@badminton/shared/match';
import { FIXED_DT } from '@badminton/shared/physics';
import { Player } from '@badminton/shared/player';
import { ROOM_NAME, SERVER_PORT, type WelcomeMsg } from '@badminton/shared/protocol';
import { RallyLogger } from '@badminton/shared/rallyLogger';
import { RuleBasedAI } from './ai/ruleBasedAI';
import { downloadText } from './data/download';
import { HumanController } from './input/humanController';
import { Keyboard } from './input/keyboard';
import { OnlineGame } from './net/onlineGame';
import { GameView } from './render/gameView';
import { LOG_DOWNLOAD_ENABLED } from './ui/hud';
import { Menu } from './ui/menu';

/** Địa chỉ game server. Mặc định cùng máy đang mở trang, cổng 2567 (chơi trong mạng LAN cũng chạy) */
const SERVER_URL = import.meta.env.VITE_SERVER_URL
  ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${SERVER_PORT}`;
const TOKEN_KEY = 'badminton.reconnect';   // để tải lại trang (F5) vẫn vào lại được phòng cũ
/**
 * Server deploy ở gói miễn phí (VITE_SERVER_URL có giá trị) sẽ "ngủ" khi không ai chơi, đánh thức mất ~1 phút.
 * Chạy local thì server bật hay không biết ngay, không cần chờ lâu.
 */
const WAKE_TIMEOUT_MS = import.meta.env.VITE_SERVER_URL ? 120_000 : 3_000;

/**
 * Gọi thử địa chỉ http của server tới khi server trả lời (trang "Colyseus 0.18...").
 * Trả về true nếu server đã dậy, false nếu chờ quá WAKE_TIMEOUT_MS.
 */
async function wakeServer(): Promise<boolean> {
  const url = SERVER_URL.replace(/^ws/, 'http');   // ws:// -> http://, wss:// -> https://
  const start = performance.now();
  while (performance.now() - start < WAKE_TIMEOUT_MS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return true;
    } catch { /* server chưa dậy: thử lại */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/** Link mời: mở link này sẽ điền sẵn mã phòng ở menu */
function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

/** Dòng hướng dẫn phím M */
const muteHelp = (muted: boolean) => `M ${muted ? 'bật' : 'tắt'} tiếng`;

/** Vòng lặp chung: phần logic chạy bước cố định 120 lần/giây, phần vẽ chạy theo tốc độ màn hình */
function runLoop(step: () => void, frame: (frameDt: number) => void): void {
  const timer = new THREE.Timer();
  let acc = 0;
  const loop = () => {
    timer.update();
    const frameDt = Math.min(timer.getDelta(), 0.1);
    acc += frameDt;
    while (acc >= FIXED_DT) { step(); acc -= FIXED_DT; }
    frame(frameDt);
    requestAnimationFrame(loop);
  };
  loop();
}

// ===== Chơi với máy (như bước 2) =====
function startOffline(): void {
  const human = new Player('near', false, { aimErrorDeg: 2 });
  const ai = new Player('far', true, { aimErrorDeg: 3 });
  const match = new Match(human, ai);
  const kb = new Keyboard();
  // Thêm ?demo vào URL để xem 2 AI tự đấu
  const demo = new URLSearchParams(location.search).has('demo');
  human.controller = demo ? new RuleBasedAI(human, match) : new HumanController(kb);
  ai.controller = new RuleBasedAI(ai, match);
  const logger = new RallyLogger(match);
  const view = new GameView(match, 'near');

  runLoop(
    () => match.update(FIXED_DT),
    (frameDt) => {
      if (kb.consume('KeyR') && match.phase === 'matchOver') match.restart();
      // Phím P tải log chỉ có khi chạy dev (npm run dev), bản deploy không có
      if (kb.consume('KeyP') && LOG_DOWNLOAD_ENABLED) downloadText(logger.fileName, logger.toJsonl());
      if (kb.consume('KeyM')) view.sfx.toggleMute();
      const mute = muteHelp(view.sfx.muted);
      view.hud.lastHelpLine = LOG_DOWNLOAD_ENABLED ? `R chơi lại | ${mute} | P tải log (${logger.count} dòng)` : `R chơi lại | ${mute}`;
      view.render(frameDt);
    },
  );
}

// ===== Chơi online =====
/** Chờ tin 'welcome' để biết mình đứng phía nào */
function waitWelcome(room: Room): Promise<WelcomeMsg> {
  return new Promise((resolve) => room.onMessage('welcome', (w: WelcomeMsg) => resolve(w)));
}

function startOnline(room: Room, welcome: WelcomeMsg): void {
  try { sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken); } catch { /* bỏ qua */ }
  // Đã vào phòng: bỏ ?room=... khỏi thanh địa chỉ, để lần sau mở lại trang không bị điền sẵn mã cũ
  if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
  room.onMessage('welcome', () => {}); // các lần vào lại sau (đã biết phía sân rồi)
  const kb = new Keyboard();
  const game = new OnlineGame(room, welcome.side, new HumanController(kb, welcome.side));
  const view = new GameView(game.match, welcome.side);
  let dropped = false;
  room.onDrop(() => { dropped = true; });
  room.onReconnect(() => { dropped = false; });
  room.onLeave(() => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* bỏ qua */ }
  });

  runLoop(
    () => game.step(),
    (frameDt) => {
      if (kb.consume('KeyR')) game.requestRematch();
      if (kb.consume('Escape')) { room.leave().finally(() => location.reload()); }
      if (kb.consume('KeyM')) view.sfx.toggleMute();
      const waiting = game.status === 'waiting';
      if (kb.consume('KeyC') && waiting) view.hud.copyInvite();
      game.frame(frameDt);
      const hud = view.hud;
      hud.lastHelpLine = `R đấu lại (khi hết ván) | ${muteHelp(view.sfx.muted)} | Esc rời phòng`;
      hud.setInvite(waiting ? inviteLink(welcome.code) : null);
      hud.messageOverride = dropped ? 'Mất kết nối, đang thử kết nối lại...' : game.localMessage;
      const ping = `ping ${Math.round(game.rtt * 1000)} ms`;
      hud.extra = waiting
        ? `MÃ PHÒNG: ${welcome.code}  (gửi mã này cho đối thủ)`
        : `Phòng ${welcome.code} | ${ping}${game.connectedOpp ? '' : ' | đối thủ mất kết nối'}`;
      view.render(frameDt);
    },
  );
}

function joinErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/locked|full/i.test(msg)) return 'Phòng đã đủ 2 người';
  if (/not found|invalid/i.test(msg)) return 'Không tìm thấy phòng với mã này';
  return import.meta.env.VITE_SERVER_URL
    ? 'Không kết nối được server, thử lại sau ít phút'
    : 'Không kết nối được server. Bạn đã chạy "npm run server" chưa?';
}

async function main(): Promise<void> {
  const menu = new Menu();
  const client = new Client(SERVER_URL);
  // Đánh thức server ngay khi mở trang: trong lúc người chơi gõ tên, server đã kịp khởi động
  let awake = wakeServer();

  // Tải lại trang giữa trận: thử vào lại phòng cũ trước
  let token: string | null = null;
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* bỏ qua */ }
  if (token) {
    try {
      const room = await client.reconnect(token);
      const welcome = waitWelcome(room);
      menu.hide();
      startOnline(room, await welcome);
      return;
    } catch {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* bỏ qua */ }
    }
  }

  for (;;) {
    const choice = await menu.choose();
    if (choice.mode === 'ai') { menu.hide(); startOffline(); return; }
    // Chờ server dậy. Quá 2 giây thì báo cho người chơi biết vì sao phải chờ
    const ready = await Promise.race([awake, new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
    if (ready === null || ready === false) {
      if (ready === false) awake = wakeServer(); // lần trước bỏ cuộc rồi: đánh thức lại từ đầu
      const t0 = performance.now();
      const show = () => menu.status(
        `Server đang khởi động (bản miễn phí ngủ khi không ai chơi)... ${Math.round((performance.now() - t0) / 1000) + 2}s, thường mất khoảng 1 phút`);
      show();
      const tick = setInterval(show, 1000);
      const ok = await awake.finally(() => clearInterval(tick));
      menu.status('Đang kết nối tới server...');
      if (!ok) { awake = wakeServer(); menu.error(joinErrorText(new Error('timeout'))); continue; }
    }
    try {
      const room = choice.mode === 'create'
        ? await client.create(ROOM_NAME, { name: choice.name })
        : await client.joinById(choice.code, { name: choice.name });
      const welcome = waitWelcome(room);
      menu.hide();
      startOnline(room, await welcome);
      return;
    } catch (err) {
      awake = wakeServer(); // có thể server vừa ngủ lại (để menu mở quá lâu): lần bấm sau sẽ chờ server dậy
      menu.error(joinErrorText(err));
    }
  }
}

main();