import type { EventBus } from '../core/EventBus';
import type { NavEvent } from '../core/inputMapping';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Digits with thousands separators, as a retro score counter shows them. */
export function fmtScore(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Shared by every screen. */
export interface UiContext {
  bus: EventBus;
}

/**
 * A screen is one DOM subtree with show/hide, a per-frame update and a nav handler.
 * No framework: modules build their own elements in the constructor.
 */
export abstract class Screen {
  readonly root: HTMLElement;
  protected visible = false;

  constructor(
    protected readonly ctx: UiContext,
    cls: string,
  ) {
    this.root = el('div', `screen ${cls}`);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.root.classList.add('show');
    this.onShow();
  }

  hide(): void {
    this.visible = false;
    this.root.classList.remove('show');
    this.onHide();
  }

  /** Per-frame update, only called while visible. */
  update(dtS: number): void {
    void dtS;
  }

  /** Returns true when the event was used. */
  handleNav(e: NavEvent): boolean {
    void e;
    return false;
  }

  protected onShow(): void {
    /* optional */
  }

  protected onHide(): void {
    /* optional */
  }

  /** Re-triggers the two-frame pop on a panel. */
  protected pop(target: HTMLElement): void {
    target.classList.remove('pop');
    void target.offsetWidth;
    target.classList.add('pop');
  }
}

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

/** A vertical list of big buttons with a blinking cursor. Mouse hover selects, click activates. */
export class Menu {
  readonly root = el('div', 'menu');
  index = 0;
  private items: MenuItem[] = [];
  private buttons: HTMLButtonElement[] = [];

  constructor(
    items: MenuItem[],
    private readonly onActivate: (id: string) => void,
    private readonly bus?: EventBus,
  ) {
    this.setItems(items);
  }

  setItems(items: MenuItem[]): void {
    this.items = items;
    this.root.textContent = '';
    this.buttons = items.map((it, i) => {
      const b = el('button', it.disabled ? 'locked' : '', it.label);
      b.type = 'button';
      b.addEventListener('mouseenter', () => this.select(i));
      b.addEventListener('click', () => {
        this.select(i);
        this.activate();
      });
      this.root.appendChild(b);
      return b;
    });
    this.index = Math.min(this.index, Math.max(0, items.length - 1));
    this.paint();
  }

  select(i: number): void {
    if (i === this.index || i < 0 || i >= this.items.length) return;
    this.index = i;
    this.bus?.emit('ui-move');
    this.paint();
  }

  move(delta: number): void {
    if (this.items.length === 0) return;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.bus?.emit('ui-move');
    this.paint();
  }

  activate(): void {
    const it = this.items[this.index];
    if (!it || it.disabled) return;
    this.bus?.emit('ui-select');
    this.onActivate(it.id);
  }

  reset(): void {
    this.index = 0;
    this.paint();
  }

  handleNav(e: NavEvent): boolean {
    switch (e) {
      case 'up':
        this.move(-1);
        return true;
      case 'down':
        this.move(1);
        return true;
      case 'confirm':
        this.activate();
        return true;
      default:
        return false;
    }
  }

  private paint(): void {
    this.buttons.forEach((b, i) => b.classList.toggle('sel', i === this.index));
  }
}
