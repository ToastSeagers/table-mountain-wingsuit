import type { WingsuitFlightState } from '../flight/state';
import { el, fmtScore, fmtTime, Screen, type UiContext } from './dom';

/** Below this AGL the altitude readout turns coral and pulses (look spec section 5). */
export const DEPLOY_WARNING_AGL_M = 160;
const STAMP_SHOW_S = 2.4;
const SCORE_SHOW_S = 2;
/** Glide ratios above this read "--" (the model reports 99 before any sink exists). */
const GLIDE_DISPLAY_MAX = 15;

export interface HudInfo {
  /** Running score, shown briefly when it changes. */
  score: number;
  /** 0..1 proximity multiplier building; 0 hides the bar. */
  proximity: number;
  prompt: string | null;
  mouseHint: boolean;
}

/** Airspeed km/h, AGL m, glide ratio, elapsed time; proximity line; score; bonus stamps; prompts. */
export class Hud extends Screen {
  private readonly speed = el('div', 'corner tl');
  private readonly agl = el('div', 'corner tr');
  private readonly glide = el('div', 'corner bl');
  private readonly time = el('div', 'corner br');
  private readonly proximity = el('div', 'proximity');
  private readonly proxFill = el('i');
  private readonly score = el('div', 'score');
  private readonly prompt = el('div', 'prompt');
  private readonly mouseHint = el('div', 'mouse-hint', 'CLICK TO CAPTURE MOUSE');
  private readonly stamps = el('div', 'stamps');
  private readonly values = new Map<HTMLElement, string>();
  private lastScore = -1;
  private scoreShownS = 0;
  private readonly live: { el: HTMLElement; ttl: number }[] = [];

  constructor(ctx: UiContext) {
    super(ctx, 'hud');
    this.proximity.appendChild(this.proxFill);
    this.root.append(this.speed, this.agl, this.glide, this.time, this.proximity, this.score, this.prompt, this.mouseHint, this.stamps);
  }

  protected override onShow(): void {
    this.lastScore = -1;
    this.scoreShownS = 0;
    this.score.classList.remove('on');
    this.stamps.textContent = '';
    this.live.length = 0;
  }

  addStamp(label: string, points: number): void {
    const s = el('div', 'stamp', label);
    s.appendChild(el('b', '', `+${points}`));
    this.stamps.appendChild(s);
    this.live.push({ el: s, ttl: STAMP_SHOW_S });
  }

  /** Per frame from the Game. */
  render(st: Readonly<WingsuitFlightState>, info: HudInfo, dtS: number): void {
    this.set(this.speed, 'SPEED KM/H', String(Math.round(st.airspeedMps * 3.6)));
    const warn = st.aglM < DEPLOY_WARNING_AGL_M && (st.phase === 'wingsuit' || st.phase === 'freefall');
    this.set(this.agl, 'AGL M', String(Math.max(0, Math.round(st.aglM))));
    this.agl.classList.toggle('warn', warn);
    const g = st.sinkMps > 0.5 && st.glideRatio < GLIDE_DISPLAY_MAX ? st.glideRatio.toFixed(1) : '--';
    this.set(this.glide, 'GLIDE', g);
    this.set(this.time, 'TIME', fmtTime(st.elapsedS));

    this.proximity.classList.toggle('on', info.proximity > 0.02);
    this.proxFill.style.width = `${Math.round(Math.min(1, info.proximity) * 100)}%`;

    if (info.score !== this.lastScore) {
      if (this.lastScore >= 0) this.scoreShownS = SCORE_SHOW_S;
      this.lastScore = info.score;
      this.score.textContent = fmtScore(info.score);
    }
    this.scoreShownS = Math.max(0, this.scoreShownS - dtS);
    this.score.classList.toggle('on', this.scoreShownS > 0);

    if (this.prompt.textContent !== (info.prompt ?? '')) this.prompt.textContent = info.prompt ?? '';
    this.prompt.classList.toggle('blink', info.prompt !== null && warn);
    this.mouseHint.style.display = info.mouseHint ? '' : 'none';

    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.ttl -= dtS;
      if (s.ttl < 0.4) s.el.classList.add('out');
      if (s.ttl <= 0) {
        s.el.remove();
        this.live.splice(i, 1);
      }
    }
  }

  private set(target: HTMLElement, label: string, value: string): void {
    const key = `${label}|${value}`;
    if (this.values.get(target) === key) return;
    this.values.set(target, key);
    target.textContent = '';
    target.append(el('small', '', label), value);
  }
}
