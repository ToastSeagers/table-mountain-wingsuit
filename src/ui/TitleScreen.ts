import type { NavEvent } from '../core/inputMapping';
import { el, Menu, Screen, type UiContext } from './dom';

export type TitleChoice = 'jump' | 'scores' | 'settings' | 'feedback';

/** Seconds of no input on the title before the attract hook fires (look spec section 5). */
export const ATTRACT_IDLE_S = 30;

export const DISCLAIMER =
  'FICTIONAL LAUNCH POINTS ON REAL GEOGRAPHY. DO NOT ATTEMPT. BASE JUMPING IS PROHIBITED IN TABLE MOUNTAIN NATIONAL PARK.';

/**
 * Title: logo over the drifting world camera, JUMP / HIGH SCORES / SETTINGS (and FEEDBACK while a
 * tester form is configured), the disclaimer line.
 * After 30 s idle `onIdle` fires so Stage 5 (or the Game's basic replay) can run attract mode.
 */
export class TitleScreen extends Screen {
  private readonly menu: Menu;
  private idleS = 0;
  private idleFired = false;

  constructor(
    ctx: UiContext,
    private readonly onChoose: (c: TitleChoice) => void,
    private readonly onIdle: () => void,
    showFeedback = false,
  ) {
    super(ctx, 'title');
    const wrap = el('div', 'title-wrap');
    const logo = el('h1', 'logo');
    logo.append('TABLE MOUNTAIN', el('br'), 'WINGSUIT');
    logo.appendChild(el('small', '', 'A CAPE TOWN FLIGHT SIM'));
    this.menu = new Menu(
      [
        { id: 'jump', label: 'JUMP' },
        { id: 'scores', label: 'HIGH SCORES' },
        { id: 'settings', label: 'SETTINGS' },
        ...(showFeedback ? [{ id: 'feedback', label: 'FEEDBACK' }] : []),
      ],
      (id) => this.onChoose(id as TitleChoice),
      ctx.bus,
    );
    wrap.append(logo, this.menu.root);
    this.root.append(wrap, el('p', 'disclaimer', DISCLAIMER));
  }

  protected override onShow(): void {
    this.menu.reset();
    this.poke();
  }

  /** Any input resets the idle timer. */
  poke(): void {
    this.idleS = 0;
    this.idleFired = false;
  }

  override update(dtS: number): void {
    this.idleS += dtS;
    if (!this.idleFired && this.idleS >= ATTRACT_IDLE_S) {
      this.idleFired = true;
      this.onIdle();
    }
  }

  override handleNav(e: NavEvent): boolean {
    this.poke();
    return this.menu.handleNav(e);
  }
}
