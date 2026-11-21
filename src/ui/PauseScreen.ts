import type { NavEvent } from '../core/inputMapping';
import { controlsCard } from './controlsCard';
import { el, Menu, Screen, type UiContext } from './dom';

export type PauseChoice = 'resume' | 'restart' | 'settings' | 'quit';

/** Dimmed world with RESUME / RESTART / CONTROLS / SETTINGS / QUIT. CONTROLS shows the cheat sheet in place. */
export class PauseScreen extends Screen {
  private readonly menu: Menu;
  private readonly card = controlsCard();
  private readonly panel: HTMLElement;

  constructor(
    ctx: UiContext,
    private readonly onChoose: (c: PauseChoice) => void,
  ) {
    super(ctx, 'pause');
    this.menu = new Menu(
      [
        { id: 'resume', label: 'RESUME' },
        { id: 'restart', label: 'RESTART' },
        { id: 'controls', label: 'CONTROLS' },
        { id: 'settings', label: 'SETTINGS' },
        { id: 'quit', label: 'QUIT' },
      ],
      (id) => (id === 'controls' ? this.showCard(true) : this.onChoose(id as PauseChoice)),
      ctx.bus,
    );
    this.panel = el('div', 'panel pop');
    this.card.classList.add('hidden');
    this.card.addEventListener('click', () => this.showCard(false));
    this.panel.append(el('h2', '', 'PAUSED'), this.menu.root, this.card);
    const bg = el('div', 'dim-bg');
    bg.appendChild(this.panel);
    this.root.appendChild(bg);
  }

  get cardShown(): boolean {
    return !this.card.classList.contains('hidden');
  }

  private showCard(on: boolean): void {
    this.card.classList.toggle('hidden', !on);
    this.menu.root.classList.toggle('hidden', on);
    this.panel.querySelector('h2')!.textContent = on ? 'CONTROLS' : 'PAUSED';
  }

  protected override onShow(): void {
    this.menu.reset();
    this.showCard(false);
    this.pop(this.panel);
  }

  override handleNav(e: NavEvent): boolean {
    if (this.cardShown) {
      // Any press puts the menu back; the card is read, not navigated.
      if (e !== 'up' && e !== 'down' && e !== 'left' && e !== 'right') this.showCard(false);
      return true;
    }
    if (e === 'back' || e === 'pause') {
      this.onChoose('resume');
      return true;
    }
    return this.menu.handleNav(e);
  }
}
