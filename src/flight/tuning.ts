// Flight tuning constants. Every value names its source: a row of
// docs/design/flight-model.md (sections 2, 3, 4) or the reasoning that produced it.
// Stage 6 may change these; record old, new and why in the stage report.

/** Simulation constants (spec section 4). */
export const SIM = {
  /** Fixed physics step the caller is expected to use (spec section 4, architecture section 6). */
  dtS: 1 / 120,
  /** Standard gravity, m/s^2. */
  gravityMps2: 9.81,
  /** Air density, sea level on a warm day (spec section 4). Altitude variation ignored. */
  rhoKgM3: 1.15,
  /** Pilot plus gear (spec table, "fixed"). */
  massKg: 90,
} as const;

/** Wingsuit aerodynamics and control (spec sections 2 and 4). */
export const WINGSUIT = {
  /** Effective wing area, m^2. Spec section 4 starts at 1.6 and says to tune S to hit the
   *  table. 1.8 puts best glide near 36 m/s and min sink near 11 m/s with the polar below;
   *  the start-arc catch gets its extra lift from arcLiftBoost instead of a larger S. Every
   *  CL anchor below is derived with 1.8. */
  wingAreaM2: 1.8,
  /** A running exit: horizontal speed along the heading at t = 0. Design choice, "step off". */
  exitSpeedMps: 3,

  // --- Lift curve CL(alpha). Derived from the trim and max-glide rows with S = 1.8: CL 0.40
  //     at 45 m/s and glide 3.0, CL 0.567 at 38 m/s and glide 3.4 (steady glide L = W cos g,
  //     D = W sin g).
  /** Lift slope per degree. 0.07/deg puts trim at alpha 3.7 deg, best glide near 7 deg and
   *  CL max 1.4 at the stall. */
  clSlopePerDeg: 0.07,
  /** Zero-lift angle of attack, deg (cambered body). */
  zeroLiftAlphaDeg: -2,
  /** Soft stall starts here (spec section 4: "soft stall past 18 degrees"). CL max = 1.4. */
  stallAlphaDeg: 18,
  /** Negative-alpha stall, deg. Suits fly badly inverted; design choice. */
  negStallAlphaDeg: -10,
  /** Fraction of CL lost over postStallWidthDeg beyond the stall. Soft, not a cliff. */
  postStallLoss: 0.45,
  postStallWidthDeg: 12,

  // --- Drag polar CD = cd0 + cdK (CL - clMinDrag)^2 + separation + sideslip + mush + flutter.
  /** Parabola through the trim (CL 0.40, CD 0.133) and max-glide (CL 0.567, CD 0.167) anchors
   *  with clMinDrag 0.10. Its best L/D is 3.44 at CL 0.66 (35 m/s). */
  cd0: 0.1097,
  cdK: 0.2617,
  clMinDrag: 0.1,
  /** Pre-stall separation drag: sepK (alpha - sepAlpha)^2 between sepAlphaDeg and
   *  sepEndAlphaDeg, constant beyond. A small bump (0.09 max) that pulls the best glide from
   *  the parabola's 34 m/s out to 36-38 m/s and starts the fall-off into mush. */
  sepAlphaDeg: 7,
  sepEndAlphaDeg: 13,
  sepKPerDeg2: 0.004,
  /** Flat-plate drag coefficient blended in past the stall (falling flat at exit). */
  cdFlatPlate: 0.9,
  /** Sideslip drag, times sin^2(beta) (spec section 4 "sideslip adds drag"). */
  cdSideslip: 0.6,
  /** Sideslip side-force coefficient, times sin(beta): a yaw nudge skids the suit into a turn. */
  cySideslip: 0.8,
  /** High-speed suit flutter drag: cdFastK (v - fastDragOnsetMps)^2 above the onset.
   *  Why: the spec's dive test (70-80 m/s within 6 s from trim) cannot be met with plain v^2
   *  drag and a terminal speed under 80 (the vertical-dive solution needs 6.9 s). The suit
   *  therefore accelerates like a ~90 m/s body and this soft wall pins the terminal near 77. */
  fastDragOnsetMps: 68,
  cdFastKPerMps2: 0.002,

  // --- Mush (spec table "mush onset 32 m/s"; section 4 "add a sink term and halve roll").
  /** Mush begins below this airspeed and is fully developed at mushFullMps. */
  mushOnsetMps: 31,
  mushFullMps: 24,
  /** Lift lost and drag added at full mush: the "sink term". */
  mushLiftLoss: 0.35,
  mushDragCd: 0.25,
  /** Roll authority lost at full mush (spec: "roll authority halves"). */
  mushRollLoss: 0.5,
  /** Pitch command range lost at full mush ("controls go soft"). */
  mushPitchLoss: 0.4,

  // --- Start arc (spec section 4: S ramps 0.3 -> 1.0 over 3 s, gated by airspeed).
  areaRampS: 3,
  areaRampStart: 0.3,
  /** Airspeed gate for the area ramp: no wing below 5 m/s, full wing possible from 28 m/s. */
  areaGateLowMps: 5,
  areaGateHighMps: 28,
  /** Phase freefall -> wingsuit when the ramp reaches this fraction (brief, design notes). */
  flyingAreaFraction: 0.9,
  /** Angle of attack the pilot holds while "getting the suit flying", relaxed to trim over
   *  arcRelaxS once the wingsuit phase begins. Gives the catch its pull. */
  arcAlphaDeg: 12,
  arcRelaxS: 1,
  /** The arc counts as caught when the instantaneous glide first exceeds this. */
  arcDoneGlide: 2,
  /** Extra lift fraction during the arc only (fades with arcRelaxS after the catch). Game knob:
   *  with v^2 lift from a 3 m/s exit the catch cannot turn the path to glide 2.5 inside 4.5 s
   *  at any honest CL (the drag of CL 1.3 stalls the suit at 33 m/s). Read as the body and legs
   *  working during the catch. */
  arcLiftBoost: 2.0,

  // --- Control authority and rates (spec table and section 4).
  /** Trim airspeed, the authority reference (spec table). */
  vTrimMps: 45,
  /** authority = clamp(v / vTrim, min, max)^2 (spec section 4). */
  authorityMin: 0.3,
  authorityMax: 1.2,
  /** Trim angle of attack, deg: CL 0.45 on the lift curve above. Zero input holds this. */
  trimAlphaDeg: 3.71,
  /** Lift coefficient at trim (derived above); the residual lift that fades at deploy. */
  trimCl: 0.4,
  /** Pitch rate at trim on full input (spec table 45 deg/s). */
  pitchRateTrimDegPerS: 45,
  /** Floor on the alpha-alignment rate so the nose still follows the velocity at low speed
   *  (the start arc's "horizon tilts forward"). */
  alignFloorDegPerS: 40,
  /** Alpha-command spring gain, 1/s. Full input reaches its alpha in about 0.5 s. */
  alphaGainPerS: 4.5,
  // --- Pitch input commands a flight-path angle (the pilot flies the glide; an alpha spring
  //     does the rest). Holding an input then converges first-order on its steady speed instead
  //     of riding a 20 s phugoid, and release returns to trim in a few seconds.
  /** Flight-path angle below the horizon at zero input: glide 3.0 (spec table). */
  trimGammaDeg: 18.43,
  /** Full nose-up asks for a 9 deg path (glide 6.3), which cannot be sustained: the suit
   *  slows past max glide into mush, which is feel #2. */
  upGammaRangeDeg: 9.4,
  /** Full nose-down asks for a 75 deg path. The curve exponent puts half input at about 41 deg
   *  (glide 1.2, the spec's "steep dive" note). */
  maxDiveGammaDeg: 75,
  diveGammaExponent: 1.3,
  /** Outer-loop gain: alpha per degree of path error, on top of the feed-forward alpha. */
  pathGainDegPerDeg: 0.6,
  /** The pilot aims steeper when slower than the commanded path's equilibrium speed and
   *  flatter when faster, deg of path per m/s. Trades height for speed after the arc and
   *  after a flare instead of waiting on the 7 s speed time constant. */
  speedToPathGainDegPerMps: 0.6,
  speedToPathMaxDeg: 15,
  /** Path-rate damping: alpha per deg/s of path rotation (clamped), the pilot's feel. */
  pathDampingDegPerDegPerS: 0.3,
  pathDampingMaxDeg: 4,
  /** Low-pass on the measured path rate before it feeds the damping (breaks the one-step
   *  algebraic loop that would otherwise oscillate at 120 Hz). */
  pathRateFilterS: 0.25,
  /** Nose-down input folds the wing (arms and legs in): S_eff x (1 - diveFoldMax * |pitch|).
   *  Half the area at full nose-down is what lets the dive test reach 70 m/s in 6 s. */
  diveFoldMax: 0.5,
  /** Roll rate at trim on full input (spec table 120 deg/s). */
  rollRateTrimDegPerS: 120,
  /** First-order lag on the roll rate so taps do not jerk. */
  rollLagS: 0.12,
  /** Auto-level rate at 90 deg bank with no roll input, deg/s. Keyboard-friendly. */
  levelRateDegPerS: 60,
  /** Direct yaw nudge on full input (spec table: "yaw authority low"). */
  yawNudgeDegPerS: 15,
  /** Weathercock gain, deg/s per deg of sideslip. Keeps the nose on the velocity. */
  weathercockGainPerS: 2,
  yawRateMaxDegPerS: 40,
  /** Max g-load (spec table 3.5 g). Lift beyond this is capped ... */
  gMax: 3.5,
  /** ... and the capped lift turns into drag at this fraction ("bleeds speed hard") ... */
  buffetDragFraction: 0.3,
  /** ... with the total aero force (lift plus buffet drag) never above this many g. */
  gMaxTotal: 3.9,
} as const;

/** Parachute opening sequence (spec sections 3 and 4). */
export const OPENING = {
  /** Deploy input to full canopy (spec table 2.5 s). */
  durationS: 2.5,
  /** Wingsuit lift fades out over this time as the pilot goes head-high. */
  liftFadeS: 0.3,
  /** Snivel: drag area ramps from dragAreaStartM2 to dragAreaSnivelM2 until this time. */
  snivelS: 1.2,
  dragAreaStartM2: 0.3,
  dragAreaSnivelM2: 0.6,
  /** Inflating canopy drag area at the end of the opening, m^2 (a pitched-back canopy is
   *  mostly drag; the force cap below is what actually limits the opening). */
  dragAreaFullM2: 18,
  /** Opening force cap in g: the slider analogue. The spec says a 2.5 g peak, but the test
   *  rows (airspeed 9-13 m/s and 55-90 m lost at 2.5 s) need a harder stop than that. */
  gCap: 3.7,
  /** Canopy lift blends in from this time to durationS so flight starts smoothly. */
  liftBlendStartS: 2.1,
} as const;

/** Canopy flight (spec section 3). */
export const CANOPY = {
  /** Canopy reference area, m^2 (about 215 sq ft). */
  areaM2: 20,
  /** Full flight: 11 m/s forward, 4 m/s sink, glide 2.75 (spec table). */
  clFull: 0.53,
  cdFull: 0.19,
  /** Brakes held: 7 m/s forward, 3 m/s sink (spec table). */
  clBrake: 1.27,
  cdBrake: 0.54,
  /** Blend time toward and away from the brake set. */
  brakeLagS: 0.6,
  /** Bank at full turn input. 60 deg/s at 11.7 m/s needs tan(bank) = 1.25 (spec table). */
  bankMaxDeg: 55,
  bankLagS: 0.4,
  /** Turn authority lost in brakes (spec: "turns slower"). */
  bankBrakeLoss: 0.4,
  // --- Flare (spec: hold in the last 3-4 m; soft = vertical under 1.5 and forward under 5).
  //     Holding flare asks the canopy for the lift that holds flareTargetSinkMps, up to
  //     flareClGain of extra CL (the pilot swinging forward under a canopy pitched back), and
  //     adds drag in proportion to the extra lift used. A timed energy pool (flareDurationS)
  //     still drains while it is held, so a flare started too early is spent before touchdown.
  flareClGain: 2.1,
  flareCdGain: 0.55,
  flareTargetSinkMps: 1.3,
  /** Lift demand above weight per m/s of sink above the target. */
  flareSinkGainPerMps: 0.5,
  /** Flare curve shape: full authority once this fraction is spent, fading from flareFadeFrom. */
  flareRiseFraction: 0.1,
  flareFadeFrom: 0.75,
  /** Canopy path-rate damping (pendulum stability), CL per deg/s of path rotation. */
  pathDampingClPerDegPerS: 0.012,
  pathDampingMaxCl: 0.15,
  pathRateFilterS: 0.25,
  /** The flare is spent after this long held (spec: "a timed effect"). */
  flareDurationS: 3,
  /** Time to regain a full flare once released and flying again. */
  flareRechargeS: 4,
  flareRechargeMinSpeedMps: 9,
} as const;

/** Ground contact rules (spec table "landing classification", section 4 "crash"). */
export const LANDING = {
  softMaxVerticalMps: 1.5,
  okMaxVerticalMps: 3,
  hardMaxVerticalMps: 5,
  crashForwardMps: 9,
  /** Minimum safe deploy AGL (spec table, game rule). Below this `lowPull` is flagged. */
  minSafeDeployAglM: 120,
  /** Contact while still deploying: landed "hard" up to this vertical speed, else crashed. */
  deployingLandMaxVerticalMps: 10,
  /** Wingsuit crash rule: AGL under this at airspeed over wingsuitCrashSpeedMps (spec section 4). */
  wingsuitCrashAglM: 0.5,
  wingsuitCrashSpeedMps: 12,
} as const;
