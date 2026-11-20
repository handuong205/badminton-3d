import type { Match } from '@badminton/shared/match';
import type { Side } from '@badminton/shared/types';
import { Hud } from '../ui/hud';
import { AimMarker } from './aimMarker';
import { ThirdPersonCamera } from './camera';
import { PlayerView, ShuttleView } from './entities';
import { LandingMarker } from './landingMarker';
import { createWorld } from './scene';
import { StatusBars } from './statusBars';
import { SoundFx } from '../audio/sfx';

/**
 * Toàn bộ phần VẼ của một trận: sân, 2 người, quả cầu, các chỉ báo riêng của người chơi trên máy này, camera, HUD.
 * Chỉ ĐỌC dữ liệu từ Match, nên dùng chung được cho cả 2 chế độ:
 * - Chơi với máy: Match chạy thật trên trình duyệt.
 * - Online: Match trên trình duyệt chỉ là "bản sao" được cập nhật từ server (xem net/onlineGame.ts).
 */
export class GameView {
  readonly hud: Hud;
  readonly sfx: SoundFx;
  private readonly world = createWorld();
  private readonly views: PlayerView[];
  private readonly shuttle = new ShuttleView();
  private readonly landing: LandingMarker;
  private readonly aim: AimMarker;
  private readonly bars: StatusBars;
  private readonly cam: ThirdPersonCamera;
  private readonly match: Match;
  private lastScore: { near: number; far: number };

  constructor(match: Match, local: Side) {
    this.match = match;
    this.lastScore = { ...match.score };
    const me = match.players[local];
    const { scene, camera } = this.world;
    this.views = [new PlayerView(match.players.near, 0x1565c0), new PlayerView(match.players.far, 0xc62828)];
    for (const v of this.views) scene.add(v.group);
    scene.add(this.shuttle.group);
    // 3 thứ dưới đây chỉ vẽ cho người chơi trên máy này, đối thủ không thấy
    this.landing = new LandingMarker(match, me);
    this.aim = new AimMarker(match, me);
    this.bars = new StatusBars(me);
    scene.add(this.landing.mesh, this.aim.group, this.bars.group);
    this.cam = new ThirdPersonCamera(camera, me);
    this.hud = new Hud(match, local);
    this.sfx = new SoundFx(match, local);
  }

  render(frameDt: number): void {
    const m = this.match;
    // Vừa có người ghi điểm (so tỉ số, nên chạy được cả khi online): bên thắng ăn mừng, bên thua cúi đầu.
    // Dùng tỉ số thay vì sự kiện của Match vì ở chế độ online Match chỉ là bản sao, không phát sự kiện
    const scored = m.score.near > this.lastScore.near ? 'near' : m.score.far > this.lastScore.far ? 'far' : null;
    if (scored) for (const v of this.views) v.react(v.side === scored);
    this.lastScore = { ...m.score };
    for (const v of this.views) v.sync(frameDt, m.shuttlePos);
    this.shuttle.sync(m.shuttlePos, m.shuttleVel);
    this.landing.update();
    this.aim.update();
    this.bars.sync();
    this.cam.update(m.shuttlePos);
    this.hud.update();
    this.sfx.update();
    this.world.renderer.render(this.world.scene, this.world.camera);
  }
}