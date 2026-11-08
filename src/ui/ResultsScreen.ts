import type { NavEvent } from '../core/inputMapping';
import type { RunOutcome } from '../game/RunController';
import { el, fmtScore, Menu, Screen, type UiContext } from './dom';

export type ResultsChoice = 'continue' | 'again' | 'change' | 'title' | 'feedback';

/** Seconds the black WIPEOUT card holds before the tally. */
export const WIPEOUT_HOLD_S = 1.8;
/** Points counted per second on the tally, and the pause between lines. */
const COUNT_RATE = 2600;
const LINE_PAUSE_S = 0.25;
const COUNT_STEP = 10;

interface TallyLine {
  label: string;
  target: number;
  shown: number;
  row: HTMLElement;
  value: HTMLElement;
}

/**
 * Results: the replay backdrop is the Game's job; this draws the tally panel (DISTANCE, AIR TIME,
 * PROXIMITY, LANDING, BONUSES, TOTAL counting up in steps, one tick per 100 points) and, for a
 * crash or leaving the map, the black WIPEOUT card first.
 */
export class ResultsScreen extends Screen {
  private readonly panel = el('div', 'panel tally');
  private readonly wipeout = el('div', 'wipeout');
  private readonly wipeTitle = el('div', 'card-w');
  private readonly body = el('div');
  private readonly menu: Menu;
  private lines: TallyLine[] = [];
  private lineIndex = 0;
  private pauseS = 0;
  private tickCarry = 0;
  private wipeLeftS = 0;
  private tallyDone = true;
  private qualifies = false;
  private onBackdrop: (() => void) | null = null;

  constructor(
    ctx: UiContext,
    private readonly onChoose: (c: ResultsChoice) => void,
    private readonly showFeedback = false,
  ) {
    super(ctx, 'results');
    this.menu = new Menu([], (id) => this.onChoose(id as ResultsChoice), ctx.bus);
    this.wipeout.appendChild(this.wipeTitle);
    this.root.append(this.panel, this.wipeout);
  }

  /** `onBackdrop` fires when the replay should start behind the panel. */
  present(outcome: RunOutcome, exitName: string, qualifies: boolean, onBackdrop: () => void): void {
    this.qualifies = qualifies;
    this.onBackdrop = onBackdrop;
    const b = outcome.breakdown;
    this.panel.textContent = '';
    this.panel.appendChild(el('h2', '', exitName.toUpperCase()));
    this.body.textContent = '';
    this.panel.append(this.body);

    const rows: [string, number, string][] = [
      [`DISTANCE ${fmtScore(b.distanceM)} M`, b.distanceScore, ''],
      [`AIR TIME ${b.airTimeS.toFixed(1)} S`, b.airTimeScore, ''],
      ['PROXIMITY', b.proximityScore, ''],
      ['LANDING', b.landingScore, ''],
      ['BONUSES', b.bonusScore, ''],
    ];
    this.lines = rows.map(([label, target]) => this.addLine(label, target));
    const bonusList = el('div', 'bonus-list');
    if (b.bonuses.length === 0) bonusList.textContent = 'NO STYLE BONUSES';
    for (const x of b.bonuses) bonusList.appendChild(el('div', '', `${x.label}  +${x.points}`));
    this.lines[4].row.after(bonusList);
    this.lines.push(this.addLine('TOTAL', b.total, 'total'));

    const note = this.noteFor(outcome);
    if (note) this.panel.appendChild(el('div', 'note', note));
    this.panel.appendChild(this.menu.root);
    this.menu.root.style.visibility = 'hidden';

    this.lineIndex = 0;
    this.pauseS = 0.4;
    this.tickCarry = 0;
    this.tallyDone = false;
    this.pop(this.panel);

    const wipe = outcome.reason === 'crashed' || outcome.reason === 'out-of-bounds';
    this.wipeout.classList.toggle('show', wipe);
    this.panel.style.visibility = wipe ? 'hidden' : 'visible';
    if (wipe) {
      this.wipeTitle.textContent = '';
      this.wipeTitle.append(
        outcome.reason === 'out-of-bounds' ? 'OUT OF BOUNDS' : 'WIPEOUT',
        el('small', '', 'RUN SCORED ANYWAY'),
      );
      this.wipeLeftS = WIPEOUT_HOLD_S;
    } else {
      this.wipeLeftS = 0;
      this.onBackdrop?.();
    }
  }

  override update(dtS: number): void {
    if (this.wipeLeftS > 0) {
      this.wipeLeftS -= dtS;
      if (this.wipeLeftS <= 0) {
        this.wipeout.classList.remove('show');
        this.panel.style.visibility = 'visible';
        this.pop(this.panel);
        this.onBackdrop?.();
      }
      return;
    }
    if (this.tallyDone) return;
    if (this.pauseS > 0) {
      this.pauseS -= dtS;
      return;
    }
    const line = this.lines[this.lineIndex];
    if (!line) return;
    if (line.target === 0) {
      this.finishLine(line);
      return;
    }
    const before = line.shown;
    line.shown = Math.min(line.target, line.shown + COUNT_RATE * dtS);
    const stepped =
      line.shown >= line.target ? line.target : Math.floor(line.shown / COUNT_STEP) * COUNT_STEP;
    line.value.textContent = fmtScore(stepped);
    this.tickCarry += line.shown - before;
    while (this.tickCarry >= 100) {
      this.tickCarry -= 100;
      this.ctx.bus.emit('tally-tick');
    }
    if (line.shown >= line.target) this.finishLine(line);
  }

  override handleNav(e: NavEvent): boolean {
    if (this.wipeLeftS > 0) {
      if (e === 'confirm' || e === 'skip') this.wipeLeftS = 0.001;
      return true;
    }
    if (!this.tallyDone) {
      if (e === 'confirm' || e === 'skip') this.finishAll();
      return true;
    }
    return this.menu.handleNav(e);
  }

  private addLine(label: string, target: number, cls = ''): TallyLine {
    const row = el('div', `line hidden ${cls}`);
    const value = el('span', 'v', '0');
    row.append(el('span', '', label), value);
    this.body.appendChild(row);
    return { label, target, shown: 0, row, value };
  }

  private finishLine(line: TallyLine): void {
    line.shown = line.target;
    line.value.textContent = fmtScore(line.target);
    line.row.classList.remove('hidden');
    this.lineIndex++;
    this.pauseS = LINE_PAUSE_S;
    const next = this.lines[this.lineIndex];
    if (next) next.row.classList.remove('hidden');
    else this.finishAll();
  }

  private finishAll(): void {
    for (const l of this.lines) {
      l.shown = l.target;
      l.value.textContent = fmtScore(l.target);
      l.row.classList.remove('hidden');
    }
    this.tallyDone = true;
    // FEEDBACK sits right after a run, when the opinion is fresh; it opens the form in a new tab and
    // leaves this screen as it is.
    const feedback = this.showFeedback ? [{ id: 'feedback', label: 'FEEDBACK' }] : [];
    this.menu.setItems(
      this.qualifies
        ? [{ id: 'continue', label: 'NEW HIGH SCORE!' }, ...feedback]
        : [
            { id: 'again', label: 'JUMP AGAIN' },
            { id: 'change', label: 'CHANGE EXIT' },
            ...feedback,
            { id: 'title', label: 'TITLE' },
          ],
    );
    this.menu.reset();
    this.menu.root.style.visibility = 'visible';
  }

  protected override onShow(): void {
    const first = this.lines[0];
    if (first) first.row.classList.remove('hidden');
  }

  private noteFor(o: RunOutcome): string {
    if (o.breakdown.surface === 'water') return 'WET SUIT! NO POINTS FOR SWIMMING.';
    if (o.reason === 'out-of-bounds') return 'YOU LEFT THE MAP. THE SEA GOT YOU.';
    if (o.reason === 'crashed') return 'HARD CUT TO BLACK. DISTANCE COUNTED HALF.';
    if (o.lowPull) return 'LOW PULL. THAT WAS CLOSE.';
    if (o.landingClass === 'hard') return 'HARD LANDING. FLARE EARLIER NEXT TIME.';
    if (o.breakdown.surface === 'land') return 'NOT IN A LANDING ZONE. LOOK FOR THE GREEN RINGS.';
    return '';
  }
}
