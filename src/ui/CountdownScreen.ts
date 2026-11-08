import { el, Screen, type UiContext } from './dom';

/** "3 2 1 GO" in the pixel font, plus the controls cheat sheet underneath. */
export class CountdownScreen extends Screen {
  private readonly num = el('div', 'num');
  private readonly controls = el('div', 'controls');

  constructor(ctx: UiContext) {
    super(ctx, 'countdown-screen');
    const wrap = el('div', 'countdown');
    wrap.append(this.num, this.controls);
    this.root.appendChild(wrap);
    const rows: [string, string][] = [
      ['W / S', 'DIVE / PULL UP'],
      ['A / D', 'BANK LEFT / RIGHT'],
      ['Q / E', 'YAW'],
      ['SPACE', 'DEPLOY, THEN FLARE'],
      ['SHIFT', 'BRAKE'],
      ['C  R  ESC', 'CAMERA  RESTART  PAUSE'],
      ['MOUSE', 'CLICK TO STEER'],
      ['PAD', 'STICK, TRIGGERS, A'],
    ];
    for (const [k, v] of rows) this.controls.append(el('b', '', k), el('span', '', v));
  }

  /** 3, 2, 1 or 0 for GO. */
  showNumber(n: number): void {
    this.num.className = `num${n === 0 ? ' go' : ''}`;
    this.num.textContent = n === 0 ? 'GO!' : String(n);
    // Restart the slam animation for each number.
    void this.num.offsetWidth;
    this.num.style.animation = 'none';
    void this.num.offsetWidth;
    this.num.style.animation = '';
  }

  showWait(text: string): void {
    this.num.className = 'num wait';
    this.num.textContent = text;
  }
}
