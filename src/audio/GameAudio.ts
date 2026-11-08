import type { EventBus } from '../core/EventBus';
import type { SettingsStore } from '../core/Settings';
import type { WingsuitFlightState } from '../flight/state';
import { Altimeter } from './Altimeter';
import { AudioEngine } from './AudioEngine';
import { Canopy, type SurfaceKind } from './Canopy';
import { UiSounds } from './UiSounds';
import { Wind } from './Wind';

export interface GameAudioHooks {
  bus: EventBus;
  settings: SettingsStore;
  /** The live flight state, or null when there is no run. */
  flightState: () => WingsuitFlightState | null;
  /** True while the world should be audible (flying and not paused). */
  worldActive: () => boolean;
  /** Surface under the pilot, read once at touchdown. */
  surfaceAt: () => SurfaceKind;
}

/** States whose background is the title loop. */
const LOOP_STATES = new Set(['title', 'highScores', 'exitSelect', 'highScoreEntry']);

/**
 * Wires the audio modules to the game: UI sounds from the bus, world sounds from the per-frame
 * flight state. Never touches physics, scoring or states; it only listens.
 */
export class GameAudio {
  readonly engine: AudioEngine;
  readonly wind: Wind;
  readonly altimeter: Altimeter;
  readonly canopy: Canopy;
  readonly ui: UiSounds;
  private state = 'title';
  private attract = false;

  constructor(private readonly hooks: GameAudioHooks) {
    this.engine = new AudioEngine(hooks.settings);
    this.wind = new Wind(this.engine);
    this.altimeter = new Altimeter(this.engine);
    this.canopy = new Canopy(this.engine);
    this.ui = new UiSounds(this.engine);
    this.ui.attach(hooks.bus);
    hooks.bus.on('state', ({ to }) => {
      this.state = to;
      if (to === 'countdown') {
        this.altimeter.reset();
        this.canopy.reset();
      }
    });
  }

  /** Attract mode (a replay on the title) mutes the loop so the replay can have its own sound. */
  setAttract(on: boolean): void {
    this.attract = on;
  }

  update(): void {
    const e = this.engine;
    if (!e.running) return;
    const active = this.hooks.worldActive();
    const fs = this.hooks.flightState();
    this.wind.update(fs, active);
    if (active) {
      this.altimeter.update(fs);
      this.canopy.update(fs, this.hooks.surfaceAt);
    }
    if (LOOP_STATES.has(this.state) && !this.attract) this.ui.startLoop();
    else this.ui.stopLoop();
    this.ui.update();
  }
}
