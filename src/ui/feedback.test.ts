import { describe, expect, it } from 'vitest';
import {
  describeBrowser,
  feedbackUrl,
  shortGpuName,
  techSummary,
  type FeedbackContext,
} from './feedback';

const ctx: FeedbackContext = {
  version: '0.2.0-alpha.2',
  device: 'phone',
  gpu: 'ANGLE (ARM, Mali-G78 MP20, OpenGL ES 3.2)',
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  canvasW: 838,
  canvasH: 328,
  renderRatio: 1,
  preset: 'mobile',
  run: { exitId: 'the-table', score: 6767, reason: 'landed', fps: 57.9 },
};

describe('describeBrowser', () => {
  it('names the family, major version and OS', () => {
    expect(describeBrowser(ctx.userAgent)).toBe('Chrome 142 Android');
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari 17 iOS');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
      ),
    ).toBe('Edge 142 Windows');
    expect(
      describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'),
    ).toBe('Firefox 133 Linux');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Samsung Internet 27 Android');
  });

  it('degrades to unknowns', () => {
    expect(describeBrowser('')).toBe('unknown browser unknown OS');
  });
});

describe('shortGpuName', () => {
  it('drops the ANGLE wrapper, device ids, API tails and the doubled vendor', () => {
    expect(
      shortGpuName(
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028A0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe('NVIDIA GeForce RTX 4060 Laptop GPU');
    expect(shortGpuName('ANGLE (ARM, Mali-G78 MP20, OpenGL ES 3.2)')).toBe('ARM Mali-G78 MP20');
    expect(shortGpuName('ANGLE (Apple, Apple M2, OpenGL 4.1 Metal - 88)')).toBe('Apple M2');
    expect(shortGpuName('Apple GPU')).toBe('Apple GPU');
    expect(
      shortGpuName(
        'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe('Intel(R) Iris(R) Xe Graphics');
  });
});

describe('techSummary', () => {
  it('is one pipe-separated line with the short GPU name', () => {
    expect(techSummary(ctx)).toBe(
      'v0.2.0-alpha.2 | phone | ARM Mali-G78 MP20 | Chrome 142 Android | 838x328 @1.0 | mobile | the-table 6,767 landed 58 fps',
    );
  });

  it('says so when no run has been flown and omits a zero fps', () => {
    expect(techSummary({ ...ctx, run: null })).toContain('| no run yet');
    expect(techSummary({ ...ctx, run: { ...ctx.run!, fps: 0 } })).toMatch(/landed$/);
  });
});

describe('feedbackUrl', () => {
  it('is null until a form is configured', () => {
    expect(feedbackUrl({ url: '', techEntry: '' }, ctx)).toBeNull();
  });

  it('prefills the technical details entry', () => {
    const url = feedbackUrl(
      { url: 'https://docs.google.com/forms/d/e/ABC/viewform', techEntry: '123456' },
      ctx,
    );
    expect(url).not.toBeNull();
    const u = new URL(url!);
    expect(u.origin + u.pathname).toBe('https://docs.google.com/forms/d/e/ABC/viewform');
    expect(u.searchParams.get('usp')).toBe('pp_url');
    expect(u.searchParams.get('entry.123456')).toBe(techSummary(ctx));
  });

  it('still opens the form when the entry id is unknown', () => {
    const url = feedbackUrl(
      { url: 'https://docs.google.com/forms/d/e/ABC/viewform', techEntry: '' },
      ctx,
    )!;
    expect([...new URL(url).searchParams.keys()]).toEqual(['usp']);
  });
});
