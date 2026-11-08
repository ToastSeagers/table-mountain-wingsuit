/**
 * Dev switch `?nofloat=1&noclip=1`: makes WebGL pretend a GPU lacks `OES_texture_float_linear` and
 * `EXT_clip_control`, which many phone GPUs do. Must run before the renderer is created, because
 * Three.js asks the context for extensions once. Production pages never pass these parameters.
 */
export interface HiddenExtensions {
  float: boolean;
  clip: boolean;
}

const FLOAT_LINEAR = 'OES_texture_float_linear';
const CLIP_CONTROL = 'EXT_clip_control';

export function hiddenExtensionsFromQuery(search: string): HiddenExtensions {
  const q = new URLSearchParams(search);
  return { float: q.get('nofloat') === '1', clip: q.get('noclip') === '1' };
}

export function hiddenNames(h: HiddenExtensions): string[] {
  return [...(h.float ? [FLOAT_LINEAR] : []), ...(h.clip ? [CLIP_CONTROL] : [])];
}

export function installHiddenExtensions(h: HiddenExtensions): void {
  const names = new Set(hiddenNames(h));
  if (names.size === 0 || typeof WebGL2RenderingContext === 'undefined') return;
  for (const proto of [WebGL2RenderingContext.prototype, typeof WebGLRenderingContext === 'undefined' ? null : WebGLRenderingContext.prototype]) {
    if (!proto) continue;
    // The DOM typings overload getExtension per extension name; a loose signature is the honest one here.
    const target = proto as unknown as { getExtension: (name: string) => unknown };
    const getExtension = target.getExtension;
    const getSupported = proto.getSupportedExtensions;
    target.getExtension = function (this: WebGLRenderingContext, name: string) {
      return names.has(name) ? null : getExtension.call(this, name);
    };
    proto.getSupportedExtensions = function (this: WebGLRenderingContext) {
      return (getSupported.call(this) ?? []).filter((n) => !names.has(n));
    };
  }
  console.warn(`[dev] hiding WebGL extensions: ${[...names].join(', ')}`);
}
