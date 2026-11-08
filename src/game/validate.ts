/** Thrown for a malformed data file; the message names the file and the path of the bad field. */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return typeof v === 'undefined' ? 'missing' : `${typeof v} ${JSON.stringify(v)}`;
}

/** Small readers that fail with `file: path: expected X, got Y` instead of a bare TypeError. */
export class Reader {
  constructor(
    readonly file: string,
    readonly path: string,
    readonly value: unknown,
  ) {}

  private fail(expected: string): never {
    throw new DataError(`${this.file}: ${this.path}: expected ${expected}, got ${describe(this.value)}`);
  }

  child(key: string | number): Reader {
    const v = (this.value as Record<string | number, unknown> | undefined)?.[key];
    const path = typeof key === 'number' ? `${this.path}[${key}]` : `${this.path}.${key}`;
    return new Reader(this.file, path, v);
  }

  object(): Record<string, unknown> {
    if (typeof this.value !== 'object' || this.value === null || Array.isArray(this.value)) this.fail('an object');
    return this.value as Record<string, unknown>;
  }

  array(): Reader[] {
    if (!Array.isArray(this.value)) this.fail('an array');
    return (this.value as unknown[]).map((_, i) => this.child(i));
  }

  string(): string {
    if (typeof this.value !== 'string' || this.value.length === 0) this.fail('a non-empty string');
    return this.value as string;
  }

  number(min = -Infinity, max = Infinity): number {
    const v = this.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) this.fail('a finite number');
    if ((v as number) < min || (v as number) > max) this.fail(`a number between ${min} and ${max}`);
    return v as number;
  }

  oneOf<T extends string | number>(options: readonly T[]): T {
    if (!options.includes(this.value as T)) this.fail(`one of ${options.map((o) => JSON.stringify(o)).join(', ')}`);
    return this.value as T;
  }

  stringArray(): string[] {
    return this.array().map((r) => r.string());
  }

  optional(key: string): Reader | null {
    const o = this.object();
    return o[key] === undefined ? null : this.child(key);
  }
}

export function root(file: string, value: unknown): Reader {
  return new Reader(file, '$', value);
}
