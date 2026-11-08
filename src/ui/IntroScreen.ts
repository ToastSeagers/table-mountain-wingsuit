import type { ExitDef } from '../game/ExitRegistry';
import { el, Screen, type UiContext } from './dom';

/** The flyover caption: exit name card in the event-select style and the skip prompt. */
export class IntroScreen extends Screen {
  private readonly name = el('div', 'name');
  private readonly sub = el('div', 'sub');
  private readonly skip = el('div', 'skip blink', 'ENTER: SKIP');

  constructor(ctx: UiContext) {
    super(ctx, 'intro');
    const banner = el('div', 'banner');
    banner.append(this.name, this.sub);
    this.root.append(banner, this.skip);
  }

  setExit(exit: ExitDef, lineLabel: string | null): void {
    this.name.textContent = exit.name.toUpperCase();
    this.sub.textContent = lineLabel ? `${exit.subtitle.toUpperCase()}  -  ${lineLabel.toUpperCase()}` : exit.subtitle.toUpperCase();
  }
}
