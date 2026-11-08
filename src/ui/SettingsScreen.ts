import type { NavEvent } from '../core/inputMapping';
import { QUALITY_PRESETS, type Settings, type SettingsStore } from '../core/Settings';
import pkg from '../../package.json';
import { el, Screen, type UiContext } from './dom';

export type SettingsRow =
  | { kind: 'slider'; key: 'masterVolume' | 'worldVolume' | 'uiVolume'; label: string }
  | { kind: 'quality'; label: string }
  | { kind: 'toggle'; key: 'vhsOverlay' | 'invertPitch' | 'cameraShake'; label: string }
  | { kind: 'steps'; key: 'mouseSensitivity'; label: string; values: readonly number[] }
  | { kind: 'info'; label: string; text: () => string }
  | { kind: 'back'; label: string };

const ATTRIBUTION = [
  'ELEVATION: CITY OF CAPE TOWN GROUND LEVEL MAP 2019.',
  'AERIAL IMAGERY: CITY OF CAPE TOWN, JANUARY 2025.',
  'CONTAINS MODIFIED COPERNICUS SENTINEL DATA 2026.',
  'COPERNICUS WORLDDEM-30 (C) DLR E.V. 2010-2014 AND (C) AIRBUS DEFENCE AND SPACE GMBH 2014-2018, PROVIDED UNDER COPERNICUS BY THE EUROPEAN UNION AND ESA.',
  'FONT: PRESS START 2P, SIL OFL 1.1.',
  'SOUNDS AND TITLE MUSIC ARE SYNTHESISED IN YOUR BROWSER. NO SAMPLES.',
];

/**
 * Settings skeleton: audio sliders (Stage 5 reads them), quality preset, VHS overlay, invert pitch,
 * camera shake, mouse sensitivity, a gamepad indicator, attribution and version. Stage 5 adds
 * entries with `addRow`. Left / right adjust, ENTER toggles or cycles, ESC closes.
 */
export class SettingsScreen extends Screen {
  private readonly rows: SettingsRow[] = [
    { kind: 'slider', key: 'masterVolume', label: 'MASTER VOLUME' },
    { kind: 'slider', key: 'worldVolume', label: 'WORLD VOLUME' },
    { kind: 'slider', key: 'uiVolume', label: 'UI VOLUME' },
    { kind: 'quality', label: 'QUALITY' },
    { kind: 'toggle', key: 'vhsOverlay', label: 'VHS OVERLAY' },
    { kind: 'toggle', key: 'invertPitch', label: 'INVERT PITCH' },
    { kind: 'toggle', key: 'cameraShake', label: 'CAMERA SHAKE' },
    { kind: 'steps', key: 'mouseSensitivity', label: 'MOUSE SENSITIVITY', values: [0.5, 0.75, 1, 1.5, 2, 3] },
    { kind: 'info', label: 'GAMEPAD', text: () => 'NOT DETECTED' },
    { kind: 'back', label: 'BACK' },
  ];
  private readonly list = el('div', 'rows');
  private buttons: HTMLButtonElement[] = [];
  private index = 0;

  constructor(
    ctx: UiContext,
    private readonly settings: SettingsStore,
    private readonly gamepadConnected: () => boolean,
    private readonly onClose: () => void,
  ) {
    super(ctx, 'settings');
    const panel = el('div', 'panel pop');
    panel.append(el('h2', '', 'SETTINGS'), this.list);
    panel.appendChild(el('p', 'attribution', ATTRIBUTION.join(' ')));
    panel.appendChild(el('p', 'attribution', `VERSION ${pkg.version}`));
    const bg = el('div', 'dim-bg');
    bg.appendChild(panel);
    this.root.appendChild(bg);
    this.rows[8] = { kind: 'info', label: 'GAMEPAD', text: () => (this.gamepadConnected() ? 'DETECTED' : 'NOT DETECTED') };
    this.build();
    settings.onChange(() => this.paint());
  }

  /** Stage 5 hook: add a row before BACK. */
  addRow(row: SettingsRow): void {
    this.rows.splice(this.rows.length - 1, 0, row);
    this.build();
  }

  protected override onShow(): void {
    this.index = 0;
    this.pop(this.root.querySelector('.panel') as HTMLElement);
    this.paint();
  }

  override update(): void {
    this.paint();
  }

  override handleNav(e: NavEvent): boolean {
    const row = this.rows[this.index];
    switch (e) {
      case 'up':
        this.index = (this.index + this.rows.length - 1) % this.rows.length;
        this.ctx.bus.emit('ui-move');
        break;
      case 'down':
        this.index = (this.index + 1) % this.rows.length;
        this.ctx.bus.emit('ui-move');
        break;
      case 'left':
        this.adjust(row, -1);
        break;
      case 'right':
        this.adjust(row, 1);
        break;
      case 'confirm':
        if (row.kind === 'back') this.close();
        else this.adjust(row, 1, true);
        break;
      case 'back':
        this.close();
        break;
      default:
        return true;
    }
    this.paint();
    return true;
  }

  private close(): void {
    this.ctx.bus.emit('ui-back');
    this.onClose();
  }

  private adjust(row: SettingsRow, dir: number, wrap = false): void {
    const s = this.settings.value;
    switch (row.kind) {
      case 'slider': {
        // A tap (wrap) on a full slider goes back to zero, so touch can reach every value.
        const stepped = wrap && dir > 0 && s[row.key] >= 0.95 ? 0 : s[row.key] + dir * 0.1;
        const v = Math.round(Math.min(1, Math.max(0, stepped)) * 10) / 10;
        this.settings.set(row.key, v);
        break;
      }
      case 'quality': {
        // AUTO follows the device (phones get MOBILE); the rest are explicit choices.
        const options: readonly (Settings['quality'] | 'auto')[] = ['auto', ...QUALITY_PRESETS];
        const i = s.qualityAuto ? 0 : options.indexOf(s.quality);
        const n = options.length;
        const next = options[wrap ? (i + dir + n) % n : Math.min(n - 1, Math.max(0, i + dir))];
        if (next === 'auto') this.settings.setQualityAuto();
        else this.settings.set('quality', next);
        break;
      }
      case 'toggle':
        this.settings.set(row.key, !s[row.key]);
        break;
      case 'steps': {
        const i = Math.max(0, row.values.findIndex((v) => v >= s[row.key] - 1e-6));
        const n = row.values.length;
        const next = wrap ? (i + dir + n) % n : Math.min(n - 1, Math.max(0, i + dir));
        this.settings.set(row.key, row.values[next]);
        break;
      }
      default:
        return;
    }
    this.ctx.bus.emit('ui-move');
  }

  private build(): void {
    this.list.textContent = '';
    this.buttons = this.rows.map((_, i) => {
      const b = el('button', 'row');
      b.type = 'button';
      b.addEventListener('mouseenter', () => {
        this.index = i;
        this.paint();
      });
      b.addEventListener('click', () => {
        this.index = i;
        this.handleNav('confirm');
      });
      this.list.appendChild(b);
      return b;
    });
    this.paint();
  }

  private valueText(row: SettingsRow): string {
    const s = this.settings.value;
    switch (row.kind) {
      case 'slider': {
        const n = Math.round(s[row.key] * 10);
        return '#'.repeat(n) + '-'.repeat(10 - n);
      }
      case 'quality':
        return s.qualityAuto ? `< AUTO: ${s.quality.toUpperCase()} >` : `< ${s.quality.toUpperCase()} >`;
      case 'toggle':
        return s[row.key] ? 'ON' : 'OFF';
      case 'steps':
        return `${s[row.key].toFixed(2)}X`;
      case 'info':
        return row.text();
      default:
        return '';
    }
  }

  private paint(): void {
    this.rows.forEach((r, i) => {
      const b = this.buttons[i];
      if (!b) return;
      b.classList.toggle('sel', i === this.index);
      const text = `${r.label}|${this.valueText(r)}`;
      if (b.dataset.t !== text) {
        b.dataset.t = text;
        b.textContent = '';
        b.append(el('span', '', r.label), el('span', 'val bar', this.valueText(r)));
      }
    });
  }
}
