/** The slice of Storage we use, so tests and private-mode browsers can swap in a memory store. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** localStorage if it works (it throws in some private modes and sandboxed frames), else memory. */
export function defaultStore(): KeyValueStore {
  try {
    const probe = '__tmw_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return new MemoryStore();
  }
}

/** Keys are `tmw.<name>.v<version>`; bumping a version abandons the old data. */
export function storageKey(name: string, version: number): string {
  return `tmw.${name}.v${version}`;
}

/**
 * Versioned JSON storage. A corrupt or wrong-shape value is treated as missing (the player
 * loses that entry, never the game). `validate` narrows unknown JSON to T or returns null.
 */
export class Persistence {
  constructor(private readonly store: KeyValueStore = defaultStore()) {}

  load<T>(name: string, version: number, validate: (raw: unknown) => T | null, fallback: () => T): T {
    try {
      const text = this.store.getItem(storageKey(name, version));
      if (text === null) return fallback();
      const parsed = validate(JSON.parse(text) as unknown);
      return parsed ?? fallback();
    } catch {
      return fallback();
    }
  }

  save(name: string, version: number, value: unknown): boolean {
    try {
      this.store.setItem(storageKey(name, version), JSON.stringify(value));
      return true;
    } catch {
      // Quota or private mode: play on without persistence.
      return false;
    }
  }

  remove(name: string, version: number): void {
    try {
      this.store.removeItem(storageKey(name, version));
    } catch {
      /* nothing to do */
    }
  }
}
