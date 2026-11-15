import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MenuScreen, type MenuChoice } from './MenuScreen';

export type { MenuChoice };

/**
 * Màn hình chọn chế độ. Giao diện nằm ở MenuScreen.tsx (React),
 * class này giữ nguyên cách gọi cho main.ts: choose() / error() / hide().
 * Trả về Promise: chờ tới khi người chơi bấm một nút hợp lệ.
 */
export class Menu {
  private readonly root: Root = createRoot(document.getElementById('menu')!);
  private resolve: ((c: MenuChoice) => void) | null = null;
  private lastError = '';

  choose(): Promise<MenuChoice> {
    return new Promise((r) => {
      this.resolve = r;
      this.render(this.lastError, false); // main.ts gọi error() rồi choose() lại: giữ lỗi để người chơi thấy
    });
  }

  error(msg: string): void {
    this.lastError = msg;
    this.render(msg, false);
  }

  hide(): void { this.root.render(null); }

  private render(error: string, busy: boolean): void {
    this.root.render(createElement(MenuScreen, { error, busy, onChoose: (c) => this.pick(c) }));
  }

  private pick(c: MenuChoice): void {
    if (!this.resolve) return;
    const r = this.resolve;
    this.resolve = null;
    this.lastError = '';
    if (c.mode !== 'ai') this.render('', true); // đang kết nối: khóa nút tới khi có kết quả
    r(c);
  }
}
