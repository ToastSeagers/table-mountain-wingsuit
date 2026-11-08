import type { NavEvent } from '../core/inputMapping';
import { el, Menu, Screen, type UiContext } from './dom';

export type PauseChoice = 'resume' | 'restart' | 'settings' | 'quit';

/** Dimmed world with RESUME / RESTART / SETTINGS / QUIT. */
export class PauseScreen extends Screen {
  private readonly menu: Menu;

  constructor(
    ctx: UiContext,
    private readonly onChoose: (c: PauseChoice) => void,
  ) {
    super(ctx, 'pause');
    this.menu = new Menu(
      [
        { id: 'resume', label: 'RESUME' },
        { id: 'restart', label: 'RESTART' },
        { id: 'settings', label: 'SETTINGS' },
        { id: 'quit', label: 'QUIT' },
      ],
      (id) => this.onChoose(id as PauseChoice),
      ctx.bus,
    );
    const panel = el('div', 'panel pop');
    panel.append(el('h2', '', 'PAUSED'), this.menu.root);
    const bg = el('div', 'dim-bg');
    bg.appendChild(panel);
    this.root.appendChild(bg);
  }

  protected override onShow(): void {
    this.menu.reset();
    this.pop(this.root.querySelector('.panel') as HTMLElement);
  }

  override handleNav(e: NavEvent): boolean {
    if (e === 'back' || e === 'pause') {
      this.onChoose('resume');
      return true;
    }
    return this.menu.handleNav(e);
  }
}
