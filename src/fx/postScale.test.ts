import { PerspectiveCamera, Scene, Vector2, Vector3, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_TARGET_SETS, PostStack, type PostParams } from './PostStack';

/** Just enough renderer for the post stack's bookkeeping: no GL, so only target allocation can be observed. */
function fakeRenderer(w: number, h: number): { r: WebGLRenderer; sizes: string[] } {
  const sizes: string[] = [];
  const r = {
    getDrawingBufferSize: (v: Vector2) => v.set(w, h),
    getRenderTarget: () => null,
    setRenderTarget: (t: { width: number; height: number } | null) => {
      if (t) sizes.push(`${t.width}x${t.height}`);
    },
    clear: () => undefined,
    render: () => undefined,
    initRenderTarget: () => undefined,
    compileAsync: () => Promise.resolve(),
  } as unknown as WebGLRenderer;
  return { r, sizes };
}

const params = (): PostParams => ({
  airspeedMps: 40,
  sunDir: new Vector3(0, 1, 0),
  vhs: false,
  timeS: 0,
  reducedMotion: false,
});

function draw(post: PostStack, n = 1): void {
  const scene = new Scene();
  const cam = new PerspectiveCamera();
  for (let i = 0; i < n; i++) post.render(scene, cam, params());
}

describe('PostStack render scale', () => {
  it('renders the scene at the scaled size and the bloom chain from it', () => {
    const { r, sizes } = fakeRenderer(800, 400);
    const post = new PostStack(r);
    post.setPreset('medium');
    post.setSceneScale(0.5);
    draw(post);
    expect(sizes[0]).toBe('400x200');
    expect(sizes).toContain('200x100'); // first bloom mip is half of the scene target
  });

  it('allocates a target set once per size and reuses it when the scale returns', () => {
    const { r } = fakeRenderer(800, 400);
    const post = new PostStack(r);
    post.setPreset('mobile');
    draw(post);
    expect(post.allocations).toBe(1);
    for (const s of [0.9, 0.8, 1, 0.9, 0.8, 1, 0.8]) {
      post.setSceneScale(s);
      draw(post, 3);
    }
    // 1.0, 0.9 and 0.8 are the only sizes ever used: three sets in total, none rebuilt by a scale change.
    expect(post.allocations).toBe(3);
  });

  it('prepareScales builds every level up front, so stepping in flight allocates nothing', () => {
    const { r } = fakeRenderer(800, 400);
    const post = new PostStack(r);
    post.setPreset('mobile');
    post.prepareScales([1, 0.9, 0.8, 0.7, 0.6]);
    const before = post.allocations;
    expect(before).toBe(5);
    for (const s of [1, 0.9, 0.8, 0.7, 0.6, 0.7, 0.8, 0.9, 1]) {
      post.setSceneScale(s);
      draw(post);
    }
    expect(post.allocations).toBe(before);
  });

  it('keeps a bounded number of sets', () => {
    const { r } = fakeRenderer(800, 400);
    const post = new PostStack(r);
    post.setPreset('mobile');
    for (let i = 0; i < 30; i++) {
      post.setSceneScale(0.3 + i * 0.02);
      draw(post);
    }
    expect(post.allocations).toBe(30);
    // The oldest were disposed: going back to the first size allocates again rather than holding 30 sets.
    post.setSceneScale(0.3);
    draw(post);
    expect(post.allocations).toBe(31);
    expect(MAX_TARGET_SETS).toBeLessThan(30);
  });

  it('a quality change drops the cached sets (the new preset has different targets)', () => {
    const { r } = fakeRenderer(800, 400);
    const post = new PostStack(r);
    post.setPreset('medium');
    draw(post);
    post.setPreset('low');
    draw(post);
    expect(post.allocations).toBe(2);
  });
});
