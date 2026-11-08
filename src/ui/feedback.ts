/**
 * Tester feedback goes to a Google Form. The game opens it from a FEEDBACK menu item with one
 * question prefilled: a compact line of technical details (version, device, GPU, browser, preset,
 * the run just flown and its frame rate) so testers only answer the questions about how it felt.
 *
 * Google Forms prefill: `<viewform url>?usp=pp_url&entry.<id>=<value>`. The entry id comes from
 * the form editor's "Get pre-filled link". Leave `url` empty to hide the FEEDBACK items.
 */
export interface FeedbackForm {
  url: string;
  /** Entry id of the "technical details" short-answer question. */
  techEntry: string;
}

export const FEEDBACK_FORM: FeedbackForm = {
  url: '',
  techEntry: '',
};

export interface FeedbackContext {
  version: string;
  /** 'phone' when the touch UI is on, else 'desktop'. */
  device: 'phone' | 'desktop';
  gpu: string;
  userAgent: string;
  /** Canvas size in device pixels and the CSS pixel ratio actually rendered. */
  canvasW: number;
  canvasH: number;
  renderRatio: number;
  preset: string;
  /** The last run, if the player has flown one this session. */
  run: {
    exitId: string;
    score: number;
    reason: string;
    fps: number;
  } | null;
}

/** "Chrome 142 Android" from a user-agent string; the raw family and OS, no versions beyond the major. */
export function describeBrowser(ua: string): string {
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'unknown OS';
  // Order matters: Edge and Samsung carry "Chrome", Chrome carries "Safari".
  const m =
    /Edg(?:e|A|iOS)?\/(\d+)/.exec(ua) ??
    /SamsungBrowser\/(\d+)/.exec(ua) ??
    /OPR\/(\d+)/.exec(ua) ??
    /Firefox\/(\d+)|FxiOS\/(\d+)/.exec(ua) ??
    /CriOS\/(\d+)/.exec(ua) ??
    /Chrome\/(\d+)/.exec(ua) ??
    /Version\/(\d+).*Safari/.exec(ua);
  let name = 'unknown browser';
  if (m) {
    const src = m[0];
    name = src.startsWith('Edg')
      ? 'Edge'
      : src.startsWith('Samsung')
        ? 'Samsung Internet'
        : src.startsWith('OPR')
          ? 'Opera'
          : src.startsWith('F')
            ? 'Firefox'
            : src.startsWith('Cr') || src.startsWith('Chrome')
              ? 'Chrome'
              : 'Safari';
    const ver = m.slice(1).find((g) => g !== undefined);
    if (ver) name += ` ${ver}`;
  }
  return `${name} ${os}`;
}

/** One line a tester never has to edit, e.g. `v0.2.0-alpha.2 | phone | Mali-G78 | Chrome 142 Android | 838x328 @1.0 | mobile | the-table 6,767 landed 58 fps`. */
export function techSummary(c: FeedbackContext): string {
  const gpu = c.gpu.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 60);
  const parts = [
    `v${c.version}`,
    c.device,
    gpu,
    describeBrowser(c.userAgent),
    `${c.canvasW}x${c.canvasH} @${c.renderRatio.toFixed(1)}`,
    c.preset,
  ];
  if (c.run) {
    const fps = c.run.fps > 0 ? ` ${Math.round(c.run.fps)} fps` : '';
    parts.push(
      `${c.run.exitId} ${Math.round(c.run.score).toLocaleString('en-US')} ${c.run.reason}${fps}`,
    );
  } else {
    parts.push('no run yet');
  }
  return parts.join(' | ');
}

/** The prefilled form link, or null when no form is configured. */
export function feedbackUrl(form: FeedbackForm, c: FeedbackContext): string | null {
  if (!form.url) return null;
  const u = new URL(form.url);
  u.searchParams.set('usp', 'pp_url');
  if (form.techEntry) u.searchParams.set(`entry.${form.techEntry}`, techSummary(c));
  return u.toString();
}
