import { controlsCard } from './controlsCard';
import { el, Screen, type UiContext } from './dom';

/** "3 2 1 GO" in the pixel font, plus the controls cheat sheet and scoring hint underneath. */
export class CountdownScreen extends Screen {
  private readonly num = el('div', 'num');

  constructor(ctx: UiContext) {
    super(ctx, 'countdown-screen');
    const wrap = el('div', 'countdown');
    wrap.append(this.num, controlsCard());
    this.root.appendChild(wrap);
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
