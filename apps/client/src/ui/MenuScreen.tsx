import { useState, type FormEvent } from 'react';
import { NAME_MAX } from '@badminton/shared/protocol';

/** Lựa chọn của người chơi ở màn hình đầu */
export type MenuChoice =
  | { mode: 'ai' }
  | { mode: 'create'; name: string }
  | { mode: 'join'; name: string; code: string };

const NAME_KEY = 'badminton.name';
const CODE_LEN = 6;

function load(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* chế độ ẩn danh: bỏ qua */ }
}
/** Ô mã phòng chỉ nhận chữ số, tối đa 6 ký tự */
const onlyDigits = (s: string) => s.replace(/\D/g, '').slice(0, CODE_LEN);

interface Props {
  /** Thông báo lỗi từ phía game (ví dụ không tìm thấy phòng) */
  error: string;
  /** Đang chờ kết nối server: khóa các nút */
  busy: boolean;
    /** Dòng chữ lúc đang chờ (mặc định "Đang kết nối tới server...") */
  busyText?: string;
  onChoose: (c: MenuChoice) => void;
}

/**
 * Màn hình nhập thông tin phòng: tên, chơi với máy, tạo phòng hoặc vào phòng bằng mã 6 số.
 * Link dạng ?room=123456 sẽ điền sẵn mã phòng (tiện gửi cho bạn bè).
 */
export function MenuScreen({ error, busy, busyText, onChoose }: Props) {
  const [name, setName] = useState(() => load(NAME_KEY));
  const [code, setCode] = useState(() => onlyDigits(new URLSearchParams(location.search).get('room') ?? ''));
  const [localError, setLocalError] = useState('');

  /** Online bắt buộc có tên. Trả về tên đã làm sạch, hoặc null nếu chưa nhập */
  const onlineName = (): string | null => {
    const n = name.trim();
    save(NAME_KEY, n);
    if (!n) { setLocalError('Nhập tên trước khi chơi online'); return null; }
    setLocalError('');
    return n;
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const n = onlineName();
    if (!n) return;
    if (code.length !== CODE_LEN) { setLocalError(`Mã phòng gồm đúng ${CODE_LEN} chữ số`); return; }
    onChoose({ mode: 'join', name: n, code });
  };

  const message = busy ? '' : localError || error;

  return (
    <div className="fixed inset-0 z-10 overflow-y-auto bg-[radial-gradient(ellipse_at_top,#064e3b_0%,#020617_60%)] text-white">
      <CourtLines />
      <div className="relative flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* ===== Tiêu đề ===== */}
          <header className="mb-6 text-center">
            <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-lime-300 to-emerald-500 text-3xl shadow-lg shadow-emerald-500/30">
              🏸
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight">Badminton 3D</h1>
            <p className="mt-1 text-sm text-white/55">Đánh cầu lông 1-1 với máy hoặc với bạn bè</p>
          </header>

          <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/60 backdrop-blur-xl">
            {/* ===== Tên ===== */}
            <label htmlFor="name" className="text-[11px] font-semibold uppercase tracking-wider text-white/45">
              Tên của bạn
            </label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35">👤</span>
              <input
                id="name"
                value={name}
                maxLength={NAME_MAX}
                placeholder="Ví dụ: Han"
                autoComplete="off"
                disabled={busy}
                onChange={(e) => { setName(e.target.value); setLocalError(''); }}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-white placeholder-white/30 outline-none transition focus:border-emerald-400 focus:bg-white/[0.07] focus:ring-4 focus:ring-emerald-400/15 disabled:opacity-50"
              />
            </div>

            {/* ===== Chơi với máy ===== */}
            <button
              type="button"
              disabled={busy}
              onClick={() => { save(NAME_KEY, name.trim()); onChoose({ mode: 'ai' }); }}
              className="group mt-5 flex w-full items-center gap-4 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 p-4 text-left shadow-lg shadow-sky-950/50 transition hover:brightness-110 active:scale-[0.99] disabled:cursor-wait disabled:opacity-50"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 text-2xl">🤖</span>
              <span className="flex-1">
                <span className="block font-bold">Chơi với máy</span>
                <span className="block text-xs text-white/75">Luyện tập ngay, không cần mạng</span>
              </span>
              <span className="text-xl transition group-hover:translate-x-1">→</span>
            </button>

            {/* ===== Online ===== */}
            <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
              <span className="h-px flex-1 bg-white/10" />Chơi online<span className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => { const n = onlineName(); if (n) onChoose({ mode: 'create', name: n }); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-semibold shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-400 active:scale-[0.99] disabled:cursor-wait disabled:opacity-50"
            >
              <span className="text-lg leading-none">＋</span> Tạo phòng mới
            </button>

            <form onSubmit={join} className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <label htmlFor="code" className="text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Hoặc nhập mã phòng của bạn bè
              </label>
              <CodeBoxes value={code} disabled={busy} onChange={(v) => { setCode(v); setLocalError(''); }} />
              <button
                type="submit"
                disabled={busy || code.length !== CODE_LEN}
                className="mt-3 w-full rounded-xl bg-white/10 px-4 py-2.5 font-semibold transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Vào phòng
              </button>
            </form>

            {/* ===== Trạng thái ===== */}
            <div className="mt-4 min-h-5 text-center text-sm" aria-live="polite">
              {busy ? (
                <span className="inline-flex items-center gap-2 text-white/70">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                     {busyText ?? 'Đang kết nối tới server...'}
                </span>
              ) : message ? (
                <span className="text-rose-400">{message}</span>
              ) : null}
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-white/35">
            WASD di chuyển · Giữ J / K / L để nạp lực, nhả để đánh
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Ô nhập mã dạng 6 ô số riêng. Thực chất là 1 ô input trong suốt phủ lên trên 6 ô vẽ,
 * nên gõ, xóa, dán (Ctrl+V) đều hoạt động bình thường như một ô input.
 */
function CodeBoxes({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative mt-2">
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {Array.from({ length: CODE_LEN }, (_, i) => {
          const active = focused && i === Math.min(value.length, CODE_LEN - 1);
          const look = active
            ? 'border-emerald-400 bg-white/10 ring-4 ring-emerald-400/15'
            : value[i] ? 'border-white/20 bg-white/[0.07]' : 'border-white/10 bg-white/5';
          return (
            <div key={i} className={`grid h-12 place-items-center rounded-xl border font-mono text-xl font-bold transition ${look}`}>
              {value[i] ?? (active ? <span className="h-5 w-0.5 animate-pulse bg-emerald-400" /> : null)}
            </div>
          );
        })}
      </div>
      <input
        id="code"
        value={value}
        inputMode="numeric"
        autoComplete="off"
        maxLength={CODE_LEN}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(onlyDigits(e.target.value))}
        className="absolute inset-0 w-full cursor-text opacity-0"
        aria-label="Mã phòng 6 chữ số"
      />
    </div>
  );
}

/** Vạch sân cầu lông mờ phía sau, chỉ để trang trí */
function CourtLines() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 610 1340"
      className="pointer-events-none absolute left-1/2 top-1/2 h-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-[18deg] opacity-[0.06]"
      fill="none"
      stroke="white"
      strokeWidth="5"
    >
      <rect x="5" y="5" width="600" height="1330" />
      <line x1="46" y1="5" x2="46" y2="1335" />
      <line x1="564" y1="5" x2="564" y2="1335" />
      <line x1="5" y1="670" x2="605" y2="670" strokeWidth="9" />
      <line x1="5" y1="472" x2="605" y2="472" />
      <line x1="5" y1="868" x2="605" y2="868" />
      <line x1="5" y1="81" x2="605" y2="81" />
      <line x1="5" y1="1259" x2="605" y2="1259" />
      <line x1="305" y1="5" x2="305" y2="472" />
      <line x1="305" y1="868" x2="305" y2="1335" />
    </svg>
  );
}
