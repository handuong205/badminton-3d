/**
 * Giả lập mạng chậm để tự test ở máy mình, không cần người chơi ở xa.
 * Thêm vào URL: ?lag=250&jitter=40  (đơn vị ms)
 * - lag: ping cộng thêm (khứ hồi). Mỗi chiều đi / về bị trễ thêm lag/2.
 * - jitter: mỗi tin bị trễ thêm ngẫu nhiên 0..jitter ms nữa (mạng lúc nhanh lúc chậm).
 * Giữ đúng thứ tự tin như TCP (WebSocket chạy trên TCP): tin sau không bao giờ tới trước tin trước,
 * nên một tin bị trễ sẽ kéo các tin sau trễ theo, giống hệt mạng thật.
 *
 * Đọc URL ngay lúc tải trang, vì main.ts sẽ xóa ?room=... (và cả các tham số khác) sau khi vào phòng.
 */
const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const URL_LAG = Math.max(0, Number(params.get('lag')) || 0);
const URL_JITTER = Math.max(0, Number(params.get('jitter')) || 0);

export class LagSim {
  readonly lag: number;
  readonly jitter: number;
  readonly active: boolean;
  private lastIn = 0;
  private lastOut = 0;

  /** Mặc định lấy theo URL. Script test có thể truyền thẳng số vào */
  constructor(lag = URL_LAG, jitter = URL_JITTER) {
    this.lag = lag;
    this.jitter = jitter;
    this.active = lag > 0 || jitter > 0;
  }

  /** Tin từ server tới mình */
  incoming(fn: () => void): void {
    if (!this.active) return fn();
    this.lastIn = this.schedule(fn, this.lastIn);
  }

  /** Tin mình gửi lên server */
  outgoing(fn: () => void): void {
    if (!this.active) return fn();
    this.lastOut = this.schedule(fn, this.lastOut);
  }

  /** Ping đo được (ms) cộng thêm phần giả lập của 2 chiều */
  ping(ms: number): number {
    return this.active ? ms + this.lag + Math.random() * this.jitter * 2 : ms;
  }

  private schedule(fn: () => void, last: number): number {
    const now = performance.now();
    const at = Math.max(now + this.lag / 2 + Math.random() * this.jitter, last);
    setTimeout(fn, at - now);
    return at;
  }
}