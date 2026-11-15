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
      view.hud.lastHelpLine = LOG_DOWNLOAD_ENABLED ? `R chơi lại | P tải log (${logger.count} dòng)` : 'R chơi lại';
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
  room.onMessage('welcome', () => {}); // các lần vào lại sau (đã biết phía sân rồi)
  const kb = new Keyboard();
  const game = new OnlineGame(room, welcome.side, new HumanController(kb, welcome.side));
  const view = new GameView(game.match, welcome.side);
  view.hud.lastHelpLine = 'R đấu lại (khi hết ván) | Esc rời phòng';
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
      game.frame();
      const hud = view.hud;
      hud.messageOverride = dropped ? 'Mất kết nối, đang thử kết nối lại...' : game.localMessage;
      const ping = `ping ${Math.round(game.rtt * 1000)} ms`;
      hud.extra = game.status === 'waiting'
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
  return 'Không kết nối được server. Bạn đã chạy "npm run server" chưa?';
}

async function main(): Promise<void> {
  const menu = new Menu();
  const client = new Client(SERVER_URL);

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
    try {
      const room = choice.mode === 'create'
        ? await client.create(ROOM_NAME, { name: choice.name })
        : await client.joinById(choice.code, { name: choice.name });
      const welcome = waitWelcome(room);
      menu.hide();
      startOnline(room, await welcome);
      return;
    } catch (err) {
      menu.error(joinErrorText(err));
    }
  }
}

main();