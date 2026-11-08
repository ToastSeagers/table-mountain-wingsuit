import type { QualityPreset } from './Settings';

/** The bits of the browser the touch and quality decisions need, as plain data so they test headless. */
export interface DeviceEnv {
  maxTouchPoints: number;
  /** Physical screen size in CSS px (not the window), so a small desktop window is not mistaken for a phone. */
  screenWidthPx: number;
  screenHeightPx: number;
  /** `(pointer: coarse)` matches: the primary pointer is a finger. */
  coarsePointer: boolean;
}

/** Brief 07 section 7: a touch device whose shorter screen side is under this is treated as a phone. */
export const MOBILE_SHORT_SIDE_PX = 900;

export function isMobileDevice(env: DeviceEnv): boolean {
  return env.maxTouchPoints > 0 && Math.min(env.screenWidthPx, env.screenHeightPx) < MOBILE_SHORT_SIDE_PX;
}

/** Quality preset used until the player picks one in settings. */
export function autoQuality(env: DeviceEnv): QualityPreset {
  return isMobileDevice(env) ? 'mobile' : 'medium';
}

/**
 * Whether to show the on-screen flight controls: a touch-first device, or `?touch=1` for testing on
 * a desktop browser. A touch laptop with a mouse stays on the desktop controls until a finger is used.
 */
export function wantsTouchUi(env: DeviceEnv, forced: boolean): boolean {
  return forced || (env.maxTouchPoints > 0 && (env.coarsePointer || isMobileDevice(env)));
}

export function readDeviceEnv(): DeviceEnv {
  const scr = typeof screen === 'undefined' ? null : screen;
  return {
    maxTouchPoints: typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0,
    screenWidthPx: scr?.width || window.innerWidth,
    screenHeightPx: scr?.height || window.innerHeight,
    coarsePointer: typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
  };
}
