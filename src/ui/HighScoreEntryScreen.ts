import type { NavEvent } from '../core/inputMapping';
import { el, fmtScore, Menu, Screen, type UiContext } from './dom';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Three-letter initials, the arcade way: up / down spin a letter, left / right change slot. */
export class HighScoreEntryScreen extends Screen {
  private readonly slots: HTMLElement[] = [];
  private readonly letters = [0, 0, 0];
  private slot = 0;
  private readonly sub = el('p', 'hint');

  constructor(
    ctx: UiContext,
    private readonly onDone: (initials: string) => void,
  ) {
    super(ctx, 'entry');
    const panel = el('div', 'panel pop');
    const row = el('div', 'initials');
    for (let i = 0; i < 3; i++) {
      const s = el('div', 'slot');
      s.addEventListener('click', () => {
        this.slot = i;
        this.paint();
      });
      this.slots.push(s);
      // Up / down arrows per letter for touch (brief 07 section 5); they work with a mouse too.
      const col = el('div', 'slot-col');
      col.append(this.arrow('\u25B2', 'Next letter', i, 1), s, this.arrow('\u25BC', 'Previous letter', i, -1));
      row.appendChild(col);
    }
    const hint = el('p', 'hint');
    hint.append(el('span', 'kb-only', 'UP/DOWN: LETTER   LEFT/RIGHT: SLOT   ENTER: OK'), el('span', 'touch-only', 'TAP THE ARROWS TO SPIN EACH LETTER'));
    const ok = new Menu([{ id: 'ok', label: 'OK' }], () => onDone(this.initials()), ctx.bus);
    ok.root.classList.add('entry-ok');
    panel.append(el('h2', '', 'NEW HIGH SCORE'), this.sub, row, hint, ok.root);
    const bg = el('div', 'dim-bg');
    bg.appendChild(panel);
    this.root.appendChild(bg);
  }

  private arrow(glyph: string, label: string, slot: number, dir: 1 | -1): HTMLButtonElement {
    const b = el('button', 'letter-arrow', glyph);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      this.slot = slot;
      this.letters[slot] = (this.letters[slot] + (dir > 0 ? 1 : 25)) % 26;
      this.ctx.bus.emit('ui-move');
      this.paint();
    });
    return b;
  }

  open(score: number, exitName: string, lastInitials: string): void {
    this.sub.textContent = `${exitName.toUpperCase()}  ${fmtScore(score)}`;
    const init = (lastInitials + 'AAA').slice(0, 3);
    for (let i = 0; i < 3; i++) this.letters[i] = Math.max(0, LETTERS.indexOf(init[i]));
    this.slot = 0;
    this.paint();
  }

  protected override onShow(): void {
    this.pop(this.root.querySelector('.panel') as HTMLElement);
    this.paint();
  }

  /** Raw keyboard (the Game routes keys here while this screen is up so WASD does not navigate). */
  handleKey(e: KeyboardEvent): void {
    if (e.code === 'Backspace') {
      this.slot = Math.max(0, this.slot - 1);
      this.paint();
    } else if (/^Key[A-Z]$/.test(e.code)) {
      this.letters[this.slot] = LETTERS.indexOf(e.code.slice(3));
      this.ctx.bus.emit('ui-move');
      if (this.slot < 2) this.slot++;
      this.paint();
    } else {
      const nav: Record<string, NavEvent> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'confirm', Space: 'confirm' };
      const n = nav[e.code];
      if (n) this.handleNav(n);
    }
  }

  override handleNav(e: NavEvent): boolean {
    const i = this.slot;
    switch (e) {
      case 'up':
        this.letters[i] = (this.letters[i] + 1) % 26;
        break;
      case 'down':
        this.letters[i] = (this.letters[i] + 25) % 26;
        break;
      case 'left':
        this.slot = Math.max(0, i - 1);
        break;
      case 'right':
        this.slot = Math.min(2, i + 1);
        break;
      case 'confirm':
        this.ctx.bus.emit('ui-select');
        if (i < 2) this.slot = i + 1;
        else this.onDone(this.initials());
        break;
      default:
        return true;
    }
    this.ctx.bus.emit('ui-move');
    this.paint();
    return true;
  }

  initials(): string {
    return this.letters.map((n) => LETTERS[n]).join('');
  }

  private paint(): void {
    this.slots.forEach((s, i) => {
      s.textContent = LETTERS[this.letters[i]];
      s.classList.toggle('sel', i === this.slot);
    });
  }
}
