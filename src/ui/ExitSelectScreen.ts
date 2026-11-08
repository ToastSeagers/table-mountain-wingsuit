import type { NavEvent } from '../core/inputMapping';
import type { ExitDef } from '../game/ExitRegistry';
import type { Profile } from '../game/Profile';
import type { LandingZone } from '../types/game';
import type { TerrainBounds } from '../types/terrain';
import { el, fmtScore, Screen, type UiContext } from './dom';
import { posterise } from './posterise';

export interface ExitSelectDeps {
  exits: () => readonly ExitDef[];
  zones: () => readonly LandingZone[];
  profile: Profile;
  bounds: () => TerrainBounds;
  overviewUrl: string;
  imageUrl: (exitId: string) => string;
  /** Fired when the highlighted exit changes (the Game preloads its terrain). */
  onFocus: (exit: ExitDef) => void;
  onChoose: (exit: ExitDef, headingDeg: number) => void;
  onBack: () => void;
}

/**
 * Event select, California Games style: a posterised overview map with a pin per exit on the left,
 * one chunky card per exit on the right. Cards and pins are built from the exit registry, so a
 * fourth exit in data/exits.json appears here with no code change.
 */
export class ExitSelectScreen extends Screen {
  private readonly mapBox = el('div', 'map-box');
  private readonly canvas = el('canvas');
  private readonly cardsEl = el('div', 'cards');
  private readonly status = el('div', 'footer-hint');
  private cards: HTMLElement[] = [];
  private pins: HTMLElement[] = [];
  private index = 0;
  private altIndex: number[] = [];
  private mapReady = false;
  private loading = false;

  constructor(
    ctx: UiContext,
    private readonly d: ExitSelectDeps,
  ) {
    super(ctx, 'exit-select-screen');
    const wrap = el('div', 'exit-select');
    const left = el('div', 'map-panel');
    left.append(el('h2', 'heading', 'SELECT EVENT'), this.mapBox);
    this.mapBox.appendChild(this.canvas);
    wrap.append(left, this.cardsEl);
    this.root.append(wrap, this.status);
  }

  /** Rebuilds cards and pins (unlocks and best scores may have changed). */
  refresh(selectId?: string): void {
    const exits = this.d.exits();
    if (selectId) this.index = Math.max(0, exits.findIndex((e) => e.id === selectId));
    this.index = Math.min(this.index, exits.length - 1);
    this.altIndex = exits.map((_, i) => this.altIndex[i] ?? 0);
    this.cardsEl.textContent = '';
    this.cards = exits.map((e, i) => this.buildCard(e, i));
    this.cards.forEach((c) => this.cardsEl.appendChild(c));
    this.buildPins();
    this.paint();
  }

  /** Shown while terrain for the highlighted exit streams in. */
  setLoading(loading: boolean): void {
    this.loading = loading;
    this.paintStatus();
  }

  get selected(): ExitDef {
    return this.d.exits()[this.index];
  }

  protected override onShow(): void {
    this.refresh();
    this.drawMap();
    this.d.onFocus(this.selected);
    this.paintStatus();
  }

  override handleNav(e: NavEvent): boolean {
    const exits = this.d.exits();
    switch (e) {
      case 'up':
      case 'down':
        this.move(e === 'up' ? -1 : 1);
        return true;
      case 'left':
      case 'right': {
        const alts = this.selected.altHeadings;
        if (alts.length > 1) {
          const n = alts.length;
          this.altIndex[this.index] = (this.altIndex[this.index] + (e === 'left' ? -1 : 1) + n) % n;
          this.ctx.bus.emit('ui-move');
          this.refresh();
        } else {
          this.move(e === 'left' ? -1 : 1);
        }
        return true;
      }
      case 'confirm':
        this.choose(this.index);
        return true;
      case 'back':
        this.ctx.bus.emit('ui-back');
        this.d.onBack();
        return true;
      default:
        return exits.length === 0;
    }
  }

  private move(delta: number): void {
    const n = this.d.exits().length;
    this.index = (this.index + delta + n) % n;
    this.ctx.bus.emit('ui-move');
    this.paint();
    this.d.onFocus(this.selected);
  }

  private choose(i: number): void {
    const exit = this.d.exits()[i];
    if (!exit || !this.d.profile.isUnlocked(exit)) {
      this.ctx.bus.emit('ui-back');
      return;
    }
    this.ctx.bus.emit('ui-select');
    this.d.onChoose(exit, this.headingFor(i));
  }

  private headingFor(i: number): number {
    const exit = this.d.exits()[i];
    return exit.altHeadings.length > 0 ? exit.altHeadings[this.altIndex[i] ?? 0].headingDeg : exit.headingDeg;
  }

  private lockText(e: ExitDef): string {
    const u = e.unlock;
    if (u.type === 'always') return '';
    const src = this.d.exits().find((x) => x.id === u.exitId);
    const name = (src?.name ?? u.exitId).toUpperCase();
    return u.type === 'completed' ? `FLY ${name} FIRST` : `SCORE ${fmtScore(u.min)} ON ${name}`;
  }

  private buildCard(e: ExitDef, i: number): HTMLElement {
    const unlocked = this.d.profile.isUnlocked(e);
    const card = el('button', `card${unlocked ? '' : ' locked'}`);
    card.type = 'button';
    const pic = el('div', 'pic');
    // The gradient is the fallback when an exit has no picture in public/img/.
    pic.style.backgroundImage = `url("${this.d.imageUrl(e.id)}"), linear-gradient(#3fb8c9 0 45%, #ffb347 45% 55%, #7fb069 55%)`;
    if (!unlocked) {
      const pad = el('div', 'pad');
      pad.appendChild(el('div', 'padlock'));
      pic.appendChild(pad);
    }
    const info = el('div', 'info');
    info.appendChild(el('div', 'name', e.name.toUpperCase()));
    info.appendChild(el('div', 'sub', e.subtitle.toUpperCase()));
    const stars = el('div', 'stars');
    for (let s = 1; s <= 3; s++) stars.appendChild(el('span', s <= e.difficulty ? '' : 'off', '★'));
    info.appendChild(stars);
    if (unlocked) {
      info.appendChild(el('div', 'blurb', e.blurb));
      if (e.altHeadings.length > 1) {
        const pick = el('div', 'heading-pick');
        pick.append('◀ LINE: ', el('b', '', e.altHeadings[this.altIndex[i] ?? 0].label.toUpperCase()), ' ▶');
        info.appendChild(pick);
      }
      const best = this.d.profile.bestScore(e.id);
      info.appendChild(el('div', 'best', best > 0 ? `BEST ${fmtScore(best)}` : 'NO SCORE YET'));
    } else {
      info.appendChild(el('div', 'blurb coral', this.lockText(e)));
    }
    card.append(pic, info);
    card.addEventListener('mouseenter', () => {
      if (this.index !== i) {
        this.index = i;
        this.ctx.bus.emit('ui-move');
        this.paint();
        this.d.onFocus(this.selected);
      }
    });
    card.addEventListener('click', () => {
      this.index = i;
      this.paint();
      this.choose(i);
    });
    return card;
  }

  private buildPins(): void {
    for (const p of this.pins) p.remove();
    this.pins = [];
    const b = this.d.bounds();
    const at = (x: number, z: number): [number, number] => [((x - b.minX) / (b.maxX - b.minX)) * 100, ((z - b.minZ) / (b.maxZ - b.minZ)) * 100];
    for (const z of this.d.zones()) {
      const dot = el('div', 'zone-dot');
      const [px, py] = at(z.centre.x, z.centre.z);
      dot.style.left = `${px}%`;
      dot.style.top = `${py}%`;
      this.mapBox.appendChild(dot);
      this.pins.push(dot);
    }
    this.d.exits().forEach((e) => {
      const pin = el('div', `pin${this.d.profile.isUnlocked(e) ? '' : ' locked'}`);
      pin.appendChild(el('span', '', e.name.toUpperCase()));
      const [px, py] = at(e.position.x, e.position.z);
      pin.style.left = `${px}%`;
      pin.style.top = `${py}%`;
      this.mapBox.appendChild(pin);
      this.pins.push(pin);
    });
  }

  private paint(): void {
    this.cards.forEach((c, i) => c.classList.toggle('sel', i === this.index));
    const pinStart = this.pins.length - this.d.exits().length;
    this.pins.forEach((p, i) => {
      if (i >= pinStart) p.classList.toggle('sel', i - pinStart === this.index);
    });
    this.cards[this.index]?.scrollIntoView({ block: 'nearest' });
    this.paintStatus();
  }

  private paintStatus(): void {
    const exit = this.d.exits()[this.index];
    this.status.textContent = this.loading
      ? 'LOADING TERRAIN...'
      : exit && this.d.profile.isUnlocked(exit)
        ? 'ARROWS: CHOOSE    ENTER: JUMP    ESC: BACK'
        : 'LOCKED  -  ARROWS: CHOOSE    ESC: BACK';
    this.status.classList.toggle('blink', this.loading);
  }

  private drawMap(): void {
    if (this.mapReady) return;
    this.mapReady = true;
    const b = this.d.bounds();
    const aspect = (b.maxX - b.minX) / (b.maxZ - b.minZ);
    const h = 84; // chunky pixels: the poster look needs few of them
    this.canvas.height = h;
    this.canvas.width = Math.round(h * aspect);
    const img = new Image();
    img.onload = () => {
      const ctx = this.canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Average the aerial down first, or every roof and tree becomes its own palette speckle.
      ctx.filter = 'blur(1.2px)';
      ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
      ctx.filter = 'none';
      posterise(ctx, this.canvas.width, this.canvas.height);
    };
    img.onerror = () => {
      this.mapReady = false;
    };
    img.src = this.d.overviewUrl;
  }
}
