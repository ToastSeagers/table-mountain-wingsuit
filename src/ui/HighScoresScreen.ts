import type { NavEvent } from '../core/inputMapping';
import type { ExitDef } from '../game/ExitRegistry';
import { MAX_SCORES_PER_EXIT, type Profile } from '../game/Profile';
import { el, fmtScore, Menu, Screen, type UiContext } from './dom';

export type ScoresChoice = 'again' | 'change' | 'title' | 'back';

/**
 * The top-ten table, one exit at a time (left / right switch). Opened from the title it has a BACK
 * button; opened after saving initials it highlights the new row and offers JUMP AGAIN, CHANGE
 * EXIT and TITLE.
 */
export class HighScoresScreen extends Screen {
  private readonly menu: Menu;
  private readonly table = el('table');
  private readonly title = el('div', 'tabs');
  private exitIndex = 0;
  private highlight = -1;
  private afterRun = false;

  constructor(
    ctx: UiContext,
    private readonly exits: () => readonly ExitDef[],
    private readonly profile: Profile,
    private readonly onChoose: (c: ScoresChoice) => void,
  ) {
    super(ctx, 'scores');
    this.menu = new Menu([{ id: 'back', label: 'BACK' }], (id) => this.onChoose(id as ScoresChoice), ctx.bus);
    const panel = el('div', 'panel scores-panel pop');
    panel.append(el('h2', '', 'HIGH SCORES'), this.title, this.table, this.menu.root);
    const bg = el('div', 'dim-bg');
    bg.appendChild(panel);
    this.root.appendChild(bg);
  }

  /** `exitId` picks the table; `rank` (0-based) highlights a fresh entry. */
  open(exitId: string, afterRun: boolean, rank = -1): void {
    this.exitIndex = Math.max(0, this.exits().findIndex((e) => e.id === exitId));
    this.highlight = rank;
    this.afterRun = afterRun;
    this.menu.setItems(
      afterRun
        ? [
            { id: 'again', label: 'JUMP AGAIN' },
            { id: 'change', label: 'CHANGE EXIT' },
            { id: 'title', label: 'TITLE' },
          ]
        : [{ id: 'back', label: 'BACK' }],
    );
    this.menu.reset();
    this.render();
  }

  protected override onShow(): void {
    this.pop(this.root.querySelector('.panel') as HTMLElement);
    this.render();
  }

  override handleNav(e: NavEvent): boolean {
    if (e === 'left' || e === 'right') {
      const n = this.exits().length;
      this.exitIndex = (this.exitIndex + (e === 'left' ? -1 : 1) + n) % n;
      this.highlight = -1;
      this.ctx.bus.emit('ui-move');
      this.render();
      return true;
    }
    if (e === 'back') {
      this.onChoose(this.afterRun ? 'title' : 'back');
      return true;
    }
    return this.menu.handleNav(e);
  }

  private render(): void {
    const exit = this.exits()[this.exitIndex];
    if (!exit) return;
    this.title.textContent = '';
    const l = el('button', 'tab-arrow', '\u25C0');
    const r = el('button', 'tab-arrow', '\u25B6');
    l.type = r.type = 'button';
    l.setAttribute('aria-label', 'Previous exit');
    r.setAttribute('aria-label', 'Next exit');
    l.addEventListener('click', () => this.handleNav('left'));
    r.addEventListener('click', () => this.handleNav('right'));
    this.title.append(l, el('b', '', exit.name.toUpperCase()), r);
    this.table.textContent = '';
    const list = this.profile.entries(exit.id);
    for (let i = 0; i < MAX_SCORES_PER_EXIT; i++) {
      const row = el('tr', i === this.highlight ? 'me' : '');
      const e = list[i];
      row.append(el('td', '', `${i + 1}.`), el('td', '', e ? e.initials : '---'), el('td', '', e ? fmtScore(e.total) : '-'));
      this.table.appendChild(row);
    }
  }
}
