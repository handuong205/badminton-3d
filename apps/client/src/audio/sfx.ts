import type { Match } from '@badminton/shared/match';
import type { Side } from '@badminton/shared/types';

const MUTE_KEY = 'badminton.muted';

/**
 * Âm thanh của trận, tự tạo bằng Web Audio (không cần file mp3).
 *
 * Không nghe sự kiện của Match mà tự so trạng thái giữa 2 khung hình:
 * - rallyShots tăng   -> có người vừa đánh trúng (tiếng "bốp", cú càng mạnh càng to và đanh)
 * - hết pha 'rally'   -> cầu chạm đất hoặc chạm lưới
 * - tỉ số đổi         -> tiếng chuông báo điểm (mình ghi điểm thì cao, đối thủ ghi thì trầm)
 * Nhờ vậy dùng chung được cho cả chơi với máy (Match chạy thật) lẫn online (Match là bản sao từ server,
 * không phát sự kiện).
 */
export class SoundFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly match: Match;
  private readonly local: Side;
  private last: { shots: number; phase: string; near: number; far: number };
  muted: boolean;

  constructor(match: Match, local: Side) {
    this.match = match;
    this.local = local;
    this.last = { shots: match.rallyShots, phase: match.phase, near: match.score.near, far: match.score.far };
    let saved = false;
    try { saved = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* bỏ qua */ }
    this.muted = saved;
    // Trình duyệt chỉ cho phát âm thanh sau khi người dùng bấm phím / chuột lần đầu
    const unlock = () => { this.ensure(); void this.ctx?.resume(); };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* bỏ qua */ }
    return this.muted;
  }

  /** Gọi mỗi khung hình, sau khi Match đã được cập nhật */
  update(): void {
    const m = this.match;
    const l = this.last;
    if (m.rallyShots > l.shots) this.hit(Math.min(m.shuttleVel.length() / 30, 1));
    if (l.phase === 'rally' && m.phase !== 'rally') {
      if (Math.abs(m.shuttlePos.z) < 0.3 && m.shuttlePos.y > 0.2) this.net(); else this.land();
    }
    const scored = m.score.near > l.near ? 'near' : m.score.far > l.far ? 'far' : null;
    if (scored) {
      if (m.phase === 'matchOver') this.fanfare(scored === this.local);
      else this.chime(scored === this.local);
    }
    this.last = { shots: m.rallyShots, phase: m.phase, near: m.score.near, far: m.score.far };
  }

  // ===== Các tiếng cụ thể =====

  /** Vợt chạm cầu: tiếng "tách" của dây vợt + tiếng "bốp" ngắn. power 0..1 */
  private hit(power: number): void {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, 0.05, 2500 + power * 2500, 4, 0.25 + power * 0.45);
    this.tone(t, 700 + power * 500, 300, 0.06, 0.2 + power * 0.25, 'triangle');
  }

  /** Cầu rơi xuống sàn: tiếng "bịch" trầm, nhỏ */
  private land(): void {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, 0.12, 500, 1, 0.25);
    this.tone(t, 160, 70, 0.12, 0.25, 'sine');
  }

  /** Cầu chạm lưới: tiếng "sột" mềm */
  private net(): void {
    const c = this.ensure();
    if (!c) return;
    this.noiseBurst(c.currentTime, 0.18, 1200, 0.7, 0.2);
  }

  /** Báo điểm: 2 nốt đi lên (mình ghi điểm) hoặc đi xuống (đối thủ ghi điểm) */
  private chime(good: boolean): void {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime + 0.15;
    const [a, b] = good ? [880, 1320] : [520, 390];
    this.tone(t, a, a, 0.18, 0.12, 'sine');
    this.tone(t + 0.12, b, b, 0.3, 0.12, 'sine');
  }

  /** Hết ván: 4 nốt đi lên khi thắng, đi xuống khi thua */
  private fanfare(win: boolean): void {
    const c = this.ensure();
    if (!c) return;
    const notes = win ? [523, 659, 784, 1047] : [440, 392, 349, 262];
    notes.forEach((f, i) => this.tone(c.currentTime + 0.2 + i * 0.14, f, f, 0.35, 0.14, 'triangle'));
  }

  // ===== Công cụ tạo âm =====

  /** Tạo AudioContext lần đầu cần dùng. Bị tắt tiếng hoặc trình duyệt không hỗ trợ thì trả về null */
  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
        // 1 giây tiếng ồn trắng, dùng lại cho mọi tiếng "tách", "bịch"
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch {
        return null;
      }
    }
    return this.muted ? null : this.ctx;
  }

  /** Tiếng ồn ngắn qua bộ lọc dải tần (bandpass): tần số cao nghe "tách", thấp nghe "bịch" */
  private noiseBurst(t: number, dur: number, freq: number, q: number, vol: number): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5, dur);
  }

  /** Một nốt có cao độ trượt từ f0 xuống f1 và nhỏ dần */
  private tone(t: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType): void {
    const c = this.ctx!;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}