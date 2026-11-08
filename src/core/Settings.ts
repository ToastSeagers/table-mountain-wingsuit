import { Persistence } from './Persistence';

export type QualityPreset = 'low' | 'medium' | 'high';
export const QUALITY_PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high'];

/** Player settings, persisted under `tmw.settings.v1`. Stage 5 reads the audio and quality fields. */
export interface Settings {
  masterVolume: number;
  worldVolume: number;
  uiVolume: number;
  quality: QualityPreset;
  vhsOverlay: boolean;
  invertPitch: boolean;
  cameraShake: boolean;
  mouseSensitivity: number;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  worldVolume: 1,
  uiVolume: 0.8,
  quality: 'medium',
  vhsOverlay: true,
  invertPitch: false,
  cameraShake: true,
  mouseSensitivity: 1,
};

const SETTINGS_NAME = 'settings';
const SETTINGS_VERSION = 1;

function unit(v: unknown, fallback: number, max = 1): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Accepts partial or foreign JSON and fills every field, so old saves survive new settings. */
export function sanitiseSettings(raw: unknown): Settings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    masterVolume: unit(r.masterVolume, d.masterVolume),
    worldVolume: unit(r.worldVolume, d.worldVolume),
    uiVolume: unit(r.uiVolume, d.uiVolume),
    quality: QUALITY_PRESETS.includes(r.quality as QualityPreset) ? (r.quality as QualityPreset) : d.quality,
    vhsOverlay: bool(r.vhsOverlay, d.vhsOverlay),
    invertPitch: bool(r.invertPitch, d.invertPitch),
    cameraShake: bool(r.cameraShake, d.cameraShake),
    mouseSensitivity: Math.max(0.25, unit(r.mouseSensitivity, d.mouseSensitivity, 3)),
  };
}

/** Live settings object with change notification and persistence. */
export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(s: Readonly<Settings>) => void>();

  constructor(private readonly persistence: Persistence) {
    this.current = persistence.load(SETTINGS_NAME, SETTINGS_VERSION, sanitiseSettings, () => ({ ...DEFAULT_SETTINGS }));
  }

  get value(): Readonly<Settings> {
    return this.current;
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.current = { ...this.current, [key]: value };
    this.persistence.save(SETTINGS_NAME, SETTINGS_VERSION, this.current);
    for (const l of this.listeners) l(this.current);
  }

  onChange(listener: (s: Readonly<Settings>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
