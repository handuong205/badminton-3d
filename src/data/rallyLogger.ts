import type { Match, MatchEvent } from "../game/match";
import type { Side } from "../shared/types";
import { other } from "../shared/types";

/**
 * Ghi log từng cú đánh và kết quả từng pha cầu, xuất ra file JSON Lines
 * (mỗi dòng là một object JSON). Đây là dữ liệu train cho AI học máy ở bước 4.
 *
 * Mỗi dòng "hit" là một mẫu (state -> action):
 *   state  = vị trí cầu, vận tốc cầu trước khi đánh, vị trí 2 người, tỉ số
 *   action = loại cú đánh + điểm nhắm
 * Dòng "point" cho biết pha cầu đó ai thắng, để sau này gán nhãn cú đánh tốt/xấu.
 */
export class RallyLogger {
  private rows: object[] = [];
  private readonly match: Match;
  readonly sessionId = new Date().toISOString();

  constructor(match: Match) {
    this.match = match;
    match.on((e) => this.onEvent(e));
  }

  get count(): number {
    return this.rows.length;
  }

  private onEvent(e: MatchEvent): void {
    const m = this.match;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const vec = (v: { x: number; y: number; z: number }) => [
      r2(v.x),
      r2(v.y),
      r2(v.z),
    ];
    const base = { session: this.sessionId, rally: m.rallyId, t: r2(m.time) };
    if (e.type === "hit") {
      const hitter = m.players[e.hitter];
      const opp = m.players[other(e.hitter)];
      this.rows.push({
        ...base,
        type: "hit",
        shot_idx: m.rallyShots,
        hitter: e.hitter,
        hitter_is_ai: hitter.isAI,
        shot: e.shot,
        power: r2(e.power),
        quality: r2(e.quality),
        stretched: e.stretched,
        contact: vec(e.contact),
        vel_in: vec(e.velIn),
        vel_out: vec(e.velOut),
        target: vec(e.target),
        hitter_stamina: Math.round(hitter.stamina),
        opp_stamina: Math.round(opp.stamina),
        hitter_pos: vec(hitter.pos),
        opp_pos: vec(opp.pos),
        score_hitter: m.score[e.hitter],
        score_opp: m.score[other(e.hitter) as Side],
      });
    } else if (e.type === "whiff") {
      this.rows.push({
        ...base,
        type: "whiff",
        player: e.player,
        pos: vec(m.players[e.player].pos),
        shuttle: vec(m.shuttlePos),
      });
    } else if (e.type === "point") {
      this.rows.push({
        ...base,
        type: "point",
        winner: e.winner,
        reason: e.reason,
        shots: m.rallyShots,
        landing: vec(e.landing),
      });
    }
  }

  /** Tải file .jsonl về máy */
  download(): void {
    const text = this.rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/x-ndjson" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `rallies-${this.sessionId.replace(/[:.]/g, "-")}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
