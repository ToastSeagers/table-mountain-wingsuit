import { EventBus } from '../core/EventBus';
import { FixedStepLoop } from '../core/FixedStepLoop';
import { InputManager } from '../core/InputManager';
import { Persistence } from '../core/Persistence';
import { SettingsStore, type QualityPreset, type Settings } from '../core/Settings';
import type { NavEvent } from '../core/inputMapping';
import type { SurfaceKind } from '../audio/Canopy';
import { GameAudio } from '../audio/GameAudio';
import { CameraEffects, introEase } from '../fx/CameraEffects';
import { PlayerAvatar } from '../fx/PlayerAvatar';
import { PostStack, type PostParams } from '../fx/PostStack';
import { ReplayDirector } from '../fx/ReplayDirector';
import { ZoneMarkers } from '../fx/ZoneMarkers';
import type { Quat, Vec3 } from '../types/math';
import { CountdownScreen } from '../ui/CountdownScreen';
import { ExitSelectScreen } from '../ui/ExitSelectScreen';
import { HighScoreEntryScreen } from '../ui/HighScoreEntryScreen';
import { HighScoresScreen } from '../ui/HighScoresScreen';
import { Hud } from '../ui/Hud';
import { IntroScreen } from '../ui/IntroScreen';
import { PauseScreen } from '../ui/PauseScreen';
import { ResultsScreen } from '../ui/ResultsScreen';
import { SettingsScreen } from '../ui/SettingsScreen';
import { TitleScreen } from '../ui/TitleScreen';
import { DevCamera } from '../world/DevCamera';
import { PerfOverlay } from '../world/PerfOverlay';
import { measurementViewpoints } from '../world/viewpoints';
import { World } from '../world/World';
import { Autopilot } from './Autopilot';
import { CameraRig, type CameraMode, type CameraPose, type CameraSubject } from './CameraRig';
import { ExitRegistry, type ExitDef } from './ExitRegistry';
import { GameStateMachine, type GameEvent, type GameState } from './GameStateMachine';
import { LandingZoneRegistry } from './LandingZoneRegistry';
import { Profile } from './Profile';
import { ReplayPlayer } from './Replay';
import { RunController, type RunOutcome, type RunPose } from './RunController';
import { TriggerRegistry } from './TriggerRegistry';
import type { FlightInput } from '../types/flight';

export interface GameOptions {
  container: HTMLElement;
  /** `?dev=1`: free camera (F2), perf overlay, Shift+1..N starts a flight at exit N. */
  dev: boolean;
  /** `?dev=1&auto=1`: runs are flown by the Autopilot. */
  auto?: boolean;
  /** Skip menus and start this exit's countdown at boot (dev). */
  startExit?: string | null;
}

/** Seconds the landing cam holds after a clean touchdown before the results. */
const LANDED_HOLD_S = 2.8;
const CRASH_HOLD_S = 0.45;
const COUNTDOWN_STEP_S = 0.9;
/** How long an unfinished terrain preload may hold the countdown on "3" before we fly anyway. */
const PRELOAD_WAIT_MAX_S = 6;
const PRELOAD_RADIUS_M = 3000;
const GO_BANNER_S = 0.9;

const QUALITY: Record<QualityPreset, Parameters<World['applySettings']>[0]> = {
  low: { maxTerrainTriangles: 300_000, lodErrorPx: 4, maxResidentTextureTiles: 24, shadows: false },
  medium: { maxTerrainTriangles: 560_000, lodErrorPx: 2, maxResidentTextureTiles: 40, shadows: false },
  high: { maxTerrainTriangles: 560_000, lodErrorPx: 2, maxResidentTextureTiles: 40, shadows: true },
};

function yawQuat(headingDeg: number): Quat {
  // Forward is -Z at identity; heading h should face (sin h, 0, -cos h): rotate about +Y by -h.
  const a = (-headingDeg * Math.PI) / 180 / 2;
  return { x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) };
}

/**
 * The game: owns the world, the screens, the input and the run, and moves between the states of
 * docs/01-architecture.md section 7. One `tick(dt)` per animation frame (or from `advance` in
 * tests and hidden panes).
 */
export class Game {
  readonly bus = new EventBus();
  readonly persistence = new Persistence();
  readonly settings = new SettingsStore(this.persistence);
  readonly profile = new Profile(this.persistence);
  readonly exits = ExitRegistry.fromData();
  readonly zones = LandingZoneRegistry.fromData();
  readonly triggers = TriggerRegistry.fromData();
  readonly machine = new GameStateMachine('title');
  readonly input: InputManager;
  readonly rig: CameraRig;
  readonly avatar = new PlayerAvatar();
  readonly markers: ZoneMarkers;
  readonly loop = new FixedStepLoop();
  readonly post: PostStack;
  readonly camFx: CameraEffects;
  readonly audio: GameAudio;
  run: RunController | null = null;
  auto: boolean;

  private readonly ui: HTMLElement;
  private readonly screens: {
    title: TitleScreen;
    scores: HighScoresScreen;
    exitSelect: ExitSelectScreen;
    intro: IntroScreen;
    countdown: CountdownScreen;
    hud: Hud;
    pause: PauseScreen;
    results: ResultsScreen;
    entry: HighScoreEntryScreen;
    settings: SettingsScreen;
  };
  private devCam: DevCamera | null = null;
  private overlay: PerfOverlay | null = null;
  private freeCam = false;
  private clockS = 0;
  private lastFrameMs = -1;

  private selected: { exit: ExitDef; headingDeg: number } | null = null;
  private lastInitials = 'AAA';
  private introT = 0;
  private countdownT = 0;
  private countdownShown = -1;
  private countdownWaitedS = 0;
  private preloads = new Map<string, Promise<void>>();
  private preloaded = new Set<string>();
  private focusedExit: ExitDef | null = null;
  private autopilot: Autopilot | null = null;
  private readonly flightInput: FlightInput = { pitch: 0, roll: 0, yaw: 0, deploy: false, flare: false, brake: false };
  private readonly pose: RunPose = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  private readonly subject: CameraSubject = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    airspeedMps: 0,
    aglM: 0,
    gLoad: 1,
    bankDeg: 0,
    phase: 'freefall',
  };
  private headCam = false;
  private endHoldS = -1;
  private prox = 0;
  private hadPointerLock = false;
  private director: ReplayDirector | null = null;
  private replay: { player: ReplayPlayer; t: number; hold: number; lastP: Vec3 | null; attract: boolean } | null = null;

  private constructor(
    readonly world: World,
    opts: GameOptions,
  ) {
    this.auto = !!opts.auto;
    this.ui = document.createElement('div');
    this.ui.id = 'ui';
    document.body.appendChild(this.ui);
    const ctx = { bus: this.bus };
    const sampler = world.terrain.sampler;
    this.rig = new CameraRig((x, z) => sampler.peekHeight(x, z));
    this.markers = new ZoneMarkers(this.zones.zones, (x, z) => sampler.peekHeight(x, z));
    this.markers.setVisible(false);
    world.scene.add(this.avatar.group, this.markers.group);
    this.input = new InputManager(world.renderer.domElement);
    this.post = new PostStack(world.renderer);
    world.renderHook = (scene, camera) => this.post.render(scene, camera, this.postParams());
    this.camFx = new CameraEffects(this.rig, this.bus);
    this.audio = new GameAudio({
      bus: this.bus,
      settings: this.settings,
      flightState: () => (this.run && this.machine.state !== 'title' ? this.run.state : null),
      worldActive: () => this.machine.state === 'flying' && !this.machine.paused && !this.machine.settingsOpen,
      surfaceAt: () => this.surfaceAtPilot(),
    });

    this.screens = {
      title: new TitleScreen(ctx, (c) => this.onTitleChoice(c), () => this.startAttract()),
      scores: new HighScoresScreen(ctx, () => this.exits.exits, this.profile, (c) => this.onScoresChoice(c)),
      exitSelect: new ExitSelectScreen(ctx, {
        exits: () => this.exits.exits,
        zones: () => this.zones.zones,
        profile: this.profile,
        bounds: () => sampler.bounds,
        overviewUrl: `${import.meta.env.BASE_URL}terrain/overview.webp`,
        imageUrl: (id) => `${import.meta.env.BASE_URL}img/exit-${id}.png`,
        onFocus: (e) => this.focusExit(e),
        onChoose: (e, h) => this.chooseExit(e, h),
        onBack: () => this.dispatch('BACK'),
      }),
      intro: new IntroScreen(ctx),
      countdown: new CountdownScreen(ctx),
      hud: new Hud(ctx),
      pause: new PauseScreen(ctx, (c) => this.onPauseChoice(c)),
      results: new ResultsScreen(ctx, (c) => this.onResultsChoice(c)),
      entry: new HighScoreEntryScreen(ctx, (i) => this.onInitials(i)),
      settings: new SettingsScreen(ctx, this.settings, () => this.input.gamepadConnected, () => this.dispatch('CLOSE_SETTINGS')),
    };
    for (const s of Object.values(this.screens)) this.ui.appendChild(s.root);

    this.machine.onChange((to, from) => this.onState(to, from));
    this.input.onNav((e) => this.onNav(e));
    this.input.onKey((e) => {
      if (this.machine.state === 'highScoreEntry' && !this.machine.settingsOpen) this.screens.entry.handleKey(e);
      if (opts.dev) this.onDevKey(e);
    });
    this.screens.settings.addRow({ kind: 'info', label: 'AUDIO', text: () => (this.audio.engine.running ? 'ON' : 'PRESS ANY KEY') });
    this.screens.settings.addRow({ kind: 'info', label: 'REDUCED MOTION', text: () => (this.camFx.reducedMotion ? 'ON (OS)' : 'OFF') });
    this.settings.onChange((s) => this.applySettings(s));
    this.applySettings(this.settings.value);

    window.addEventListener('resize', () => world.resize(opts.container.clientWidth, opts.container.clientHeight));
    world.renderer.domElement.addEventListener('mousedown', () => this.onCanvasClick());
    document.addEventListener('pointerlockchange', () => this.onPointerLock());
    window.addEventListener('blur', () => {
      if (this.machine.state === 'flying') this.dispatch('PAUSE');
    });

    if (opts.dev) {
      this.devCam = new DevCamera(world.camera, world.renderer.domElement, measurementViewpoints(), (vp) => {
        void world.terrain.preloadAround(vp.position, 1500);
      });
      this.overlay = new PerfOverlay(world.renderer);
    }
    this.onState('title', 'title');
  }

  static async create(opts: GameOptions): Promise<Game> {
    // Validate the data files first: a bad file should fail loudly with a readable message.
    const exits = ExitRegistry.fromData();
    const zones = LandingZoneRegistry.fromData();
    TriggerRegistry.fromData();
    exits.checkZones(zones.ids());
    const focus = exits.exits[0].position;
    const world = await World.create({ container: opts.container, focus });
    const game = new Game(world, opts);
    world.renderer.setAnimationLoop((timeMs: number) => {
      const dt = game.lastFrameMs < 0 ? 0 : Math.min((timeMs - game.lastFrameMs) / 1000, 0.1);
      game.lastFrameMs = timeMs;
      game.tick(dt);
    });
    if (opts.dev) game.installDevHook();
    if (opts.startExit) {
      const e = exits.find(opts.startExit);
      if (e) game.startRunAt(e, e.headingDeg);
    }
    return game;
  }

  get state(): GameState {
    return this.machine.state;
  }

  dispatch(event: GameEvent): boolean {
    return this.machine.dispatch(event);
  }

  // ----- per-frame -----------------------------------------------------------------------

  /** Advances the whole game by `dtS` of wall time and renders one frame. */
  tick(dtS: number): void {
    const t0 = performance.now();
    this.clockS += dtS;
    this.input.poll(dtS);
    this.camFx.update(dtS, this.subject);
    this.syncOverlays();
    const state = this.machine.state;
    const paused = this.machine.paused || this.machine.settingsOpen;

    for (const s of Object.values(this.screens)) if (s.isVisible) s.update(dtS);

    if (this.freeCam && this.devCam) {
      this.devCam.update(dtS);
    } else {
      switch (state) {
        case 'title':
          if (this.replay) this.updateReplay(dtS);
          else this.applyPose(this.rig.orbitPose(this.clockS, this.orbitCentre()));
          break;
        case 'exitSelect': {
          const e = this.selected?.exit ?? this.focusedExit ?? this.exits.exits[0];
          this.applyPose(this.rig.orbitPose(this.clockS, e.position, 1300, e.position.y + 380, 120));
          break;
        }
        case 'highScores':
        case 'highScoreEntry':
          this.applyPose(this.rig.orbitPose(this.clockS, this.orbitCentre()));
          break;
        case 'intro':
          if (!paused) this.updateIntro(dtS);
          break;
        case 'countdown':
          if (!paused) this.updateCountdown(dtS);
          break;
        case 'flying':
          this.updateFlying(dtS, paused);
          break;
        case 'results':
          this.updateReplay(dtS);
          break;
      }
    }

    this.audio.update();
    this.overlay?.gpuBegin();
    this.world.frame(this.clockS);
    this.overlay?.gpuEnd();
    if (this.overlay) {
      this.overlay.record(this.clockS, performance.now() - t0);
      this.overlay.draw(
        this.clockS,
        this.world.terrain.stats,
        `state ${state}${this.machine.paused ? ' (paused)' : ''}  cam ${this.freeCam ? 'FREE (F2)' : 'game (F2)'}  shift+1..${this.exits.exits.length}: fly exit`,
      );
    }
  }

  /** Runs `seconds` of game time in `stepS` frames without waiting for animation frames. */
  advance(seconds: number, stepS = 1 / 60): void {
    for (let t = 0; t < seconds; t += stepS) this.tick(stepS);
  }

  // ----- states --------------------------------------------------------------------------

  private onState(to: GameState, from: GameState): void {
    this.bus.emit('state', { from, to });
    this.stopReplay();
    const sc = this.screens;
    for (const s of Object.values(sc)) s.hide();
    this.ui.classList.remove('black-bg');
    this.input.captureKeys = to === 'highScoreEntry';
    if (to !== 'flying' && to !== 'countdown') this.input.releaseMouse();
    this.avatar.setVisible(to === 'intro' || to === 'countdown' || to === 'flying' || to === 'results');
    this.markers.setVisible(to === 'intro' || to === 'countdown' || to === 'flying' || to === 'results');
    this.applyUiClasses();

    switch (to) {
      case 'title':
        sc.title.show();
        break;
      case 'highScores':
        if (from === 'highScoreEntry') {
          const e = this.selected?.exit ?? this.exits.exits[0];
          sc.scores.open(e.id, true, this.lastRank);
        } else {
          sc.scores.open(this.exits.exits[0].id, false);
        }
        sc.scores.show();
        break;
      case 'exitSelect':
        sc.exitSelect.refresh(this.selected?.exit.id);
        sc.exitSelect.show();
        break;
      case 'intro':
        this.beginIntro();
        sc.intro.show();
        break;
      case 'countdown':
        this.beginCountdown();
        sc.countdown.show();
        break;
      case 'flying':
        this.beginFlying();
        sc.hud.show();
        break;
      case 'results':
        this.beginResults();
        sc.results.show();
        break;
      case 'highScoreEntry': {
        const out = this.run?.outcome;
        if (out) sc.entry.open(out.result.total, this.selected?.exit.name ?? '', this.lastInitials);
        sc.entry.show();
        break;
      }
    }
  }

  private lastRank = -1;

  private applyUiClasses(): void {
    const flying = this.machine.state === 'flying' && !this.machine.paused;
    this.ui.classList.toggle('scanlines', this.settings.value.vhsOverlay && !flying && this.machine.state !== 'countdown');
  }

  private onNav(e: NavEvent): void {
    this.screens.title.poke();
    if (e === 'skip' && this.replay && !this.replay.attract && this.director) {
      this.replay.t = this.director.nextShotStart(this.replay.t);
      this.director.restart();
      this.replay.lastP = null;
      return;
    }
    if (this.replay?.attract) {
      this.stopReplay();
      return;
    }
    if (this.machine.settingsOpen) {
      this.screens.settings.handleNav(e);
      return;
    }
    if (this.machine.paused) {
      this.screens.pause.handleNav(e);
      return;
    }
    const sc = this.screens;
    switch (this.machine.state) {
      case 'title':
        sc.title.handleNav(e);
        break;
      case 'highScores':
        sc.scores.handleNav(e);
        break;
      case 'exitSelect':
        sc.exitSelect.handleNav(e);
        break;
      case 'intro':
        if (e === 'confirm' || e === 'skip') this.dispatch('SKIP_INTRO');
        else if (e === 'back') this.dispatch('BACK');
        break;
      case 'countdown':
        if (e === 'back') this.dispatch('BACK');
        break;
      case 'flying':
        if (e === 'pause' || e === 'back') this.dispatch('PAUSE');
        else if (e === 'restart') this.dispatch('JUMP_AGAIN');
        else if (e === 'camera') this.headCam = !this.headCam;
        break;
      case 'results':
        sc.results.handleNav(e);
        break;
      case 'highScoreEntry':
        // Keyboard goes through handleKey; the pad arrives here.
        sc.entry.handleNav(e);
        break;
    }
  }

  private onTitleChoice(c: 'jump' | 'scores' | 'settings'): void {
    if (c === 'jump') this.dispatch('JUMP');
    else if (c === 'scores') this.dispatch('SHOW_SCORES');
    else this.openSettings();
  }

  private onScoresChoice(c: 'again' | 'change' | 'title' | 'back'): void {
    if (c === 'again') this.dispatch('JUMP_AGAIN');
    else if (c === 'change') this.dispatch('CHANGE_EXIT');
    else this.dispatch(c === 'title' ? 'TO_TITLE' : 'BACK');
  }

  private onPauseChoice(c: 'resume' | 'restart' | 'settings' | 'quit'): void {
    if (c === 'resume') this.dispatch('RESUME');
    else if (c === 'restart') this.dispatch('JUMP_AGAIN');
    else if (c === 'settings') this.openSettings();
    else {
      this.run?.abort();
      this.dispatch('TO_TITLE');
    }
  }

  private openSettings(): void {
    this.dispatch('OPEN_SETTINGS');
  }

  private onResultsChoice(c: 'continue' | 'again' | 'change' | 'title'): void {
    if (c === 'continue') this.dispatch('ENTER_INITIALS');
    else if (c === 'again') this.dispatch('JUMP_AGAIN');
    else if (c === 'change') this.dispatch('CHANGE_EXIT');
    else this.dispatch('TO_TITLE');
  }

  private onInitials(initials: string): void {
    const out = this.run?.outcome;
    const exit = this.selected?.exit;
    if (out && exit) {
      this.lastInitials = initials;
      this.lastRank = this.profile.addScore(exit.id, initials, out.result.total, out.result.recordedAt);
      this.bus.emit('fanfare');
    }
    this.dispatch('SCORE_SAVED');
  }

  // Settings overlay is not a state, so hide/show it with the machine flag.
  private syncOverlays(): void {
    const showPause = this.machine.paused && !this.machine.settingsOpen;
    if (showPause && !this.screens.pause.isVisible) this.screens.pause.show();
    if (!showPause && this.screens.pause.isVisible) this.screens.pause.hide();
    if (this.machine.settingsOpen && !this.screens.settings.isVisible) this.screens.settings.show();
    if (!this.machine.settingsOpen && this.screens.settings.isVisible) this.screens.settings.hide();
    this.applyUiClasses();
  }

  // ----- exit select ---------------------------------------------------------------------

  private focusExit(exit: ExitDef): void {
    this.focusedExit = exit;
    this.screens.exitSelect.setLoading(!this.world.terrain.sampler.tilesLoadedAround(exit.position.x, exit.position.z, PRELOAD_RADIUS_M));
    const p = this.preloadFor(exit);
    void p.then(() => {
      if (this.focusedExit === exit) this.screens.exitSelect.setLoading(false);
    });
  }

  private preloadFor(exit: ExitDef): Promise<void> {
    let p = this.preloads.get(exit.id);
    if (!p) {
      p = this.world.terrain
        .preloadAround(exit.position, PRELOAD_RADIUS_M)
        .catch(() => undefined)
        .then(() => {
          this.preloaded.add(exit.id);
        });
      this.preloads.set(exit.id, p);
    }
    return p;
  }

  private chooseExit(exit: ExitDef, headingDeg: number): void {
    this.selected = { exit, headingDeg };
    void this.preloadFor(exit);
    this.dispatch('SELECT_EXIT');
  }

  /** Dev and tests: skip the menus and go straight to the intro or countdown for an exit. */
  startRunAt(exit: ExitDef, headingDeg: number, skipIntro = true): void {
    this.selected = { exit, headingDeg };
    void this.preloadFor(exit);
    if (this.machine.state === 'title') this.dispatch('JUMP');
    if (this.machine.state === 'exitSelect') this.dispatch('SELECT_EXIT');
    if (skipIntro && this.machine.state === 'intro') this.dispatch('SKIP_INTRO');
  }

  // ----- intro / countdown ---------------------------------------------------------------

  private ledgePose(exit: ExitDef, headingDeg: number): void {
    const p = exit.position;
    this.avatar.update(0, p, yawQuat(headingDeg), 'wingsuit');
  }

  private beginIntro(): void {
    const sel = this.selected;
    if (!sel) return;
    this.introT = 0;
    const alt = sel.exit.altHeadings.find((a) => a.headingDeg === sel.headingDeg);
    this.screens.intro.setExit(sel.exit, alt?.label ?? null);
    this.markers.highlight(sel.exit.recommendedLandingZones);
    this.markers.rebuild();
    this.ledgePose(sel.exit, sel.headingDeg);
  }

  private updateIntro(dtS: number): void {
    const sel = this.selected;
    if (!sel) return;
    this.introT += dtS;
    const dur = sel.exit.intro.durationS;
    this.applyPose(this.rig.introPose(introEase(this.introT / dur), sel.exit.position, sel.headingDeg, sel.exit.intro.cameraPath));
    this.ledgePose(sel.exit, sel.headingDeg);
    if (this.introT >= dur) this.dispatch('SKIP_INTRO');
  }

  private beginCountdown(): void {
    const sel = this.selected;
    if (!sel) return;
    this.run = new RunController({
      exit: sel.exit,
      headingDeg: sel.headingDeg,
      terrain: this.world.terrain.sampler,
      zones: this.zones,
      triggers: this.triggers,
      seed: 1,
    });
    this.run.onPhase((from, to) => this.bus.emit('phase', { from, to }));
    this.run.start();
    this.autopilot = this.auto ? new Autopilot({ target: this.autopilotTarget(sel.exit), deployAglM: 45 }) : null;
    this.countdownT = 0;
    this.countdownShown = -1;
    this.countdownWaitedS = 0;
    this.endHoldS = -1;
    this.prox = 0;
    this.input.reset();
    this.markers.highlight(sel.exit.recommendedLandingZones);
    this.markers.rebuild();
    this.copySubject(this.run, this.subject);
    this.rig.reset(this.subject);
    this.avatar.setVisible(true);
    this.world.terrain.sampler.setReadyFocus(sel.exit.position.x, sel.exit.position.z);
    void this.preloadFor(sel.exit);
  }

  private autopilotTarget(exit: ExitDef): Vec3 {
    const id = exit.recommendedLandingZones[0];
    return this.zones.get(id)?.centre ?? exit.position;
  }

  private updateCountdown(dtS: number): void {
    const run = this.run;
    if (!run) return;
    const ready = this.world.terrain.sampler.isReady();
    const preloadDone = this.countdownWaitedS > PRELOAD_WAIT_MAX_S || this.preloadSettled();
    if (!(ready && preloadDone)) {
      this.countdownWaitedS += dtS;
      this.screens.countdown.showWait('LOADING TERRAIN...');
      this.countdownShown = -1;
    } else {
      this.countdownT += dtS;
      const n = 3 - Math.floor(this.countdownT / COUNTDOWN_STEP_S);
      const shown = Math.max(0, n);
      if (shown !== this.countdownShown) {
        this.countdownShown = shown;
        this.screens.countdown.showNumber(shown);
        this.bus.emit('countdown', shown);
      }
      if (this.countdownT >= COUNTDOWN_STEP_S * 3) {
        this.dispatch('COUNTDOWN_DONE');
        return;
      }
    }
    this.copySubject(run, this.subject);
    this.applyPose(this.rig.update(dtS, 'chase', this.subject));
    this.avatar.update(dtS, run.state.position, run.state.orientation, 'wingsuit');
  }

  private preloadSettled(): boolean {
    const sel = this.selected;
    return !sel || this.preloaded.has(sel.exit.id);
  }

  // ----- flying --------------------------------------------------------------------------

  private beginFlying(): void {
    this.loop.reset();
    this.input.reset();
    this.headCam = false;
    this.endHoldS = -1;
    if (this.run) this.screens.hud.render(this.run.state, { score: 0, proximity: 0, prompt: 'GO!', mouseHint: false }, 0);
  }

  private updateFlying(dtS: number, paused: boolean): void {
    const run = this.run;
    if (!run) return;
    if (!paused && !run.ended) {
      const alpha = this.loop.advance(dtS, (step) => {
        if (this.autopilot) {
          this.autopilot.update(run.state, this.flightInput);
          run.step(step, this.flightInput);
        } else {
          run.stepRaw(step, this.input.readRaw(step));
        }
      });
      for (const s of run.drainStamps()) {
        this.screens.hud.addStamp(s.label, s.points);
        this.bus.emit('stamp', s);
      }
      if (run.ended) this.onRunEnded(run.outcome as RunOutcome);
      run.interpolate(alpha, this.pose);
    } else if (run.ended) {
      run.interpolate(1, this.pose);
    }

    const st = run.state;
    this.avatar.setVisible(!(this.headCam && st.phase !== 'canopy' && st.phase !== 'deploying' && !run.ended));
    this.avatar.update(paused ? 0 : dtS, this.pose.position, this.pose.orientation, st.phase);
    this.copySubject(run, this.subject);
    if (!paused) {
      let mode: CameraMode = 'chase';
      if (run.ended && st.phase === 'landed') mode = 'landing';
      else if (st.phase === 'deploying' || st.phase === 'canopy') mode = 'canopy';
      else if (this.headCam) mode = 'head';
      this.applyPose(this.rig.update(dtS, mode, this.subject));
    }

    // HUD
    const k = st.aglM < 40 && st.airspeedMps > 35 ? (40 - st.aglM) / 40 : 0;
    this.prox += (k - this.prox) * Math.min(1, dtS * 6);
    let prompt: string | null = null;
    if (run.ended) prompt = null;
    else if (st.elapsedS < GO_BANNER_S) prompt = 'GO!';
    else if ((st.phase === 'wingsuit' || st.phase === 'freefall') && st.elapsedS > 12 && st.aglM < 260) prompt = this.input.gamepadConnected ? 'A: DEPLOY' : 'SPACE: DEPLOY';
    else if (st.phase === 'canopy' && st.aglM < 40) prompt = this.input.gamepadConnected ? 'HOLD A TO FLARE' : 'TAP SPACE TO FLARE';
    this.screens.hud.render(
      st,
      {
        score: run.tracker.runningScore(st.position),
        proximity: this.prox,
        prompt,
        mouseHint: !this.input.pointerLocked && !this.autopilot && st.elapsedS < 30,
      },
      paused ? 0 : dtS,
    );

    if (run.ended && !paused) {
      this.endHoldS -= dtS;
      if (this.endHoldS <= 0) this.dispatch('RUN_ENDED');
    }
  }

  private onRunEnded(out: RunOutcome): void {
    const sel = this.selected;
    this.bus.emit('run-end', { reason: out.reason });
    this.endHoldS = out.reason === 'landed' || out.reason === 'water' ? LANDED_HOLD_S : CRASH_HOLD_S;
    this.input.releaseMouse();
    if (!sel) return;
    if (out.reason === 'landed' || out.reason === 'water') this.profile.markCompleted(sel.exit.id);
    this.profile.offerBestRun(out.result);
    // The results screen is built when the state flips; remember the facts it needs.
    this.pendingQualifies = this.profile.qualifies(sel.exit.id, out.result.total);
  }

  private pendingQualifies = false;

  // ----- results / replay ----------------------------------------------------------------

  private beginResults(): void {
    const out = this.run?.outcome;
    const sel = this.selected;
    if (!out || !sel) return;
    this.screens.results.present(out, sel.exit.name, this.pendingQualifies, () => this.startReplay(out.result.replay, false));
    this.ui.classList.toggle('black-bg', out.reason === 'crashed' || out.reason === 'out-of-bounds');
  }

  private startReplay(frames: RunOutcome['result']['replay'], attract: boolean): void {
    if (frames.length < 2) return;
    this.ui.classList.remove('black-bg');
    this.replay = { player: new ReplayPlayer(frames), t: 0, hold: 0, lastP: null, attract };
    const sampler = this.world.terrain.sampler;
    this.director = new ReplayDirector(frames, this.rig, (x, z) => sampler.peekHeight(x, z));
    this.audio.setAttract(attract);
    const first = frames[0];
    this.subject.position = { ...first.p };
    this.subject.orientation = { ...first.q };
    this.subject.velocity = { x: 0, y: 0, z: 0 };
    this.subject.airspeedMps = 40;
    this.rig.reset(this.subject);
    this.avatar.setVisible(true);
    this.markers.setVisible(true);
    this.world.terrain.sampler.setReadyFocus(first.p.x, first.p.z);
    if (attract) this.screens.title.hide();
  }

  private stopReplay(): void {
    if (!this.replay) return;
    const wasAttract = this.replay.attract;
    this.replay = null;
    this.director = null;
    this.audio.setAttract(false);
    if (wasAttract && this.machine.state === 'title') {
      this.screens.title.show();
      this.avatar.setVisible(false);
      this.markers.setVisible(false);
    }
  }

  private startAttract(): void {
    if (this.machine.state !== 'title' || this.machine.settingsOpen) return;
    const best = this.profile.bestRunOverall();
    if (best) this.startReplay(best.replay, true);
  }

  private updateReplay(dtS: number): void {
    const r = this.replay;
    if (!r) {
      if (this.machine.state === 'results') this.applyPose(this.rig.orbitPose(this.clockS, this.orbitCentre()));
      return;
    }
    r.t += dtS;
    const end = r.player.durationS;
    if (r.t > end + 2.5) {
      r.t = 0;
      r.lastP = null;
      const f0 = r.player.frames[0];
      this.subject.position = { ...f0.p };
      this.subject.orientation = { ...f0.q };
      this.rig.reset(this.subject);
      this.director?.restart();
    }
    const pose = r.player.at(Math.min(r.t, end));
    const s = this.subject;
    if (r.lastP && dtS > 0) {
      const inv = 1 / dtS;
      const vx = (pose.p.x - r.lastP.x) * inv;
      const vy = (pose.p.y - r.lastP.y) * inv;
      const vz = (pose.p.z - r.lastP.z) * inv;
      const k = Math.min(1, dtS * 8);
      s.velocity.x += (vx - s.velocity.x) * k;
      s.velocity.y += (vy - s.velocity.y) * k;
      s.velocity.z += (vz - s.velocity.z) * k;
    }
    r.lastP = { ...pose.p };
    s.position = { ...pose.p };
    s.orientation = { ...pose.q };
    s.airspeedMps = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
    s.phase = pose.phase;
    s.aglM = Math.max(5, pose.p.y - this.world.terrain.sampler.peekHeight(pose.p.x, pose.p.z));
    s.gLoad = 1;
    s.bankDeg = 0;
    const cam = this.director
      ? this.director.update(r.t, dtS, s)
      : this.rig.update(dtS, r.t >= end ? 'landing' : pose.phase === 'canopy' || pose.phase === 'deploying' ? 'canopy' : 'chase', s);
    this.applyPose(cam);
    this.avatar.update(dtS, pose.p, pose.q, pose.phase);
  }

  // ----- camera, settings, helpers --------------------------------------------------------

  private orbitCentre(): Vec3 {
    // The upper cable station area: the middle of the Table's western edge.
    const e = this.exits.exits[0];
    return { x: e.position.x + 400, y: e.position.y, z: e.position.z - 100 };
  }

  private applyPose(p: CameraPose): void {
    const cam = this.world.camera;
    cam.position.set(p.position.x, p.position.y, p.position.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.target.x, p.target.y, p.target.z);
    if (p.rollDeg !== 0) cam.rotateZ((-p.rollDeg * Math.PI) / 180);
    if (Math.abs(cam.fov - p.fovDeg) > 0.01) {
      cam.fov = p.fovDeg;
      cam.updateProjectionMatrix();
    }
  }

  private copySubject(run: RunController, out: CameraSubject): void {
    const st = run.state;
    out.position = this.pose.position;
    out.orientation = this.pose.orientation;
    if (this.machine.state !== 'flying') {
      out.position = st.position;
      out.orientation = st.orientation;
    }
    out.velocity = st.velocity;
    out.airspeedMps = st.airspeedMps;
    out.aglM = st.aglM;
    out.gLoad = st.gLoad;
    out.bankDeg = st.bankDeg;
    out.phase = st.phase;
  }

  private applySettings(s: Readonly<Settings>): void {
    this.world.applySettings(QUALITY[s.quality]);
    this.post.setPreset(s.quality);
    this.rig.shakeEnabled = s.cameraShake;
    this.input.invertPitch = s.invertPitch;
    this.input.mouseSensitivity = s.mouseSensitivity;
    this.applyUiClasses();
  }

  private postParams(): PostParams {
    const inReplay = this.machine.state === 'results' || !!this.replay;
    return {
      airspeedMps: this.subject.airspeedMps,
      sunDir: this.world.uniforms.uSunDir.value,
      vhs: this.settings.value.vhsOverlay && inReplay,
      timeS: this.clockS,
      reducedMotion: this.camFx.reducedMotion,
    };
  }

  /** Surface under the pilot for the landing thump: a landing zone's surface, else rough ground. */
  private surfaceAtPilot(): SurfaceKind {
    const p = this.run?.state.position;
    if (!p) return 'grass';
    for (const z of this.zones.zones) {
      if (Math.hypot(p.x - z.centre.x, p.z - z.centre.z) <= z.radiusM) return z.surface;
    }
    return 'rock';
  }

  private onCanvasClick(): void {
    const st = this.machine.state;
    if ((st === 'flying' || st === 'countdown') && !this.machine.paused && !this.auto) this.input.requestMouseCapture();
  }

  private onPointerLock(): void {
    const locked = this.input.pointerLocked;
    if (this.hadPointerLock && !locked && this.machine.state === 'flying' && !this.run?.ended) this.dispatch('PAUSE');
    this.hadPointerLock = locked;
  }

  // ----- dev -----------------------------------------------------------------------------

  private onDevKey(e: KeyboardEvent): void {
    if (e.code === 'F2') {
      this.freeCam = !this.freeCam;
      e.preventDefault();
    }
    const n = Number(e.key);
    if (e.shiftKey && n >= 1 && n <= this.exits.exits.length && !this.freeCam) {
      const exit = this.exits.exits[n - 1];
      this.forceState('exitSelect');
      this.startRunAt(exit, exit.headingDeg);
    }
  }

  /** Dev: jump the machine to a state without playing the screens in between. */
  private forceState(target: GameState): void {
    for (let i = 0; i < 12 && this.machine.state !== target; i++) {
      if (this.machine.paused) this.dispatch('RESUME');
      const s = this.machine.state;
      if (s === 'title') this.dispatch('JUMP');
      else if (s === 'highScores' || s === 'intro' || s === 'countdown' || s === 'exitSelect') this.dispatch('BACK');
      else if (s === 'highScoreEntry') this.dispatch('SCORE_SAVED');
      else this.dispatch('TO_TITLE');
    }
  }

  private installDevHook(): void {
    const hook = {
      game: this,
      world: this.world,
      pos: () => ({ ...this.world.camera.position }),
      /** Flies an exit with the autopilot from the console: `__tmw.fly('the-table', true)`. */
      fly: (exitId: string, auto = false, headingDeg?: number) => {
        this.auto = auto;
        const e = this.exits.get(exitId);
        this.forceState('exitSelect');
        this.startRunAt(e, headingDeg ?? e.headingDeg);
      },
      advance: (s: number, step?: number) => this.advance(s, step),
      post: this.post,
      audio: this.audio,
      camFx: this.camFx,
    };
    (window as unknown as { __tmw: typeof hook }).__tmw = hook;
  }
}
