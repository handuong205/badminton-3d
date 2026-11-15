import * as THREE from 'three';
import './style.css';
import { RuleBasedAI } from './ai/ruleBasedAI';
import { RallyLogger } from './data/rallyLogger';
import { Match } from './game/match';
import { Player } from './game/player';
import { HumanController } from './input/humanController';
import { Keyboard } from './input/keyboard';
import { ThirdPersonCamera } from './render/camera';
import { PlayerView, ShuttleView } from './render/entities';
import { createWorld } from './render/scene';
import { FIXED_DT } from './shared/physics';
import { Hud, LOG_DOWNLOAD_ENABLED } from './ui/hud';
import { LandingMarker } from './render/landingMarker';
import { AimMarker } from './render/aimMarker';
import { StatusBars } from './render/statusBars';

// ===== Khởi tạo logic trận đấu =====
const human = new Player('near', false, { aimErrorDeg: 2 });
const ai = new Player('far', true, { aimErrorDeg: 3 });
const match = new Match(human, ai);
const kb = new Keyboard();
// Thêm ?demo vào URL (vd: localhost:5173/?demo) để xem 2 AI tự đấu, tiện để kiểm tra/cân chỉnh
const demo = new URLSearchParams(location.search).has('demo');
human.controller = demo ? new RuleBasedAI(human, match) : new HumanController(kb);
ai.controller = new RuleBasedAI(ai, match);
const logger = new RallyLogger(match);

// ===== Khởi tạo phần vẽ =====
const { scene, camera, renderer } = createWorld();
const views = [new PlayerView(human, 0x1565c0), new PlayerView(ai, 0xc62828)];
for (const v of views) scene.add(v.group);
const shuttleView = new ShuttleView();
scene.add(shuttleView.group);
const landing = new LandingMarker(match, human); // chỉ cho người chơi trên máy này
scene.add(landing.mesh);
const aimMarker = new AimMarker(match, human); // hướng đánh lúc nạp lực, cũng chỉ cho người chơi trên máy này
scene.add(aimMarker.group);
const bars = new StatusBars(human); // thanh lực + thể lực, cũng chỉ cho người chơi trên máy này
scene.add(bars.group);
const cam = new ThirdPersonCamera(camera, human);
const hud = new Hud(match);

// ===== Vòng lặp game: vật lý chạy bước cố định, vẽ theo tốc độ màn hình =====
const timer = new THREE.Timer();
let acc = 0;

function loop() {
  timer.update();
  const frameDt = Math.min(timer.getDelta(), 0.1);
  acc += frameDt;
  if (kb.consume('KeyR') && match.phase === 'matchOver') match.restart();
  if (kb.consume('KeyP') && LOG_DOWNLOAD_ENABLED) logger.download();
  while (acc >= FIXED_DT) { match.update(FIXED_DT); acc -= FIXED_DT; }

  for (const v of views) v.sync(frameDt, match.shuttlePos);
  shuttleView.sync(match.shuttlePos, match.shuttleVel);
  landing.update();
  aimMarker.update();
  bars.sync();
  cam.update(match.shuttlePos);
  hud.update(logger.count);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();