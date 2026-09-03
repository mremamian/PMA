import { Injectable, computed, effect, signal } from '@angular/core';

import type { JalaliLocale } from './jalali';
import { DEFAULT_ZOOM, ZOOM_PRESETS, type ZoomLevel } from './timeline';

const STORAGE_KEY = 'pma.settings.v1';

interface PersistedSettings {
  locale: JalaliLocale;
  persianDigits: boolean;
  zoom: ZoomLevel;
  cascade: boolean;
  showDependencies: boolean;
  hideEmptyRows: boolean;
  /** `"<projectId>:<teamId>"` for each collapsed row. */
  collapsedRows: string[];
}

const DEFAULTS: PersistedSettings = {
  locale: 'fa',
  persianDigits: true,
  zoom: DEFAULT_ZOOM,
  // Moving a bar drags its dependents with it. On by default: a plan that
  // silently breaks its own constraints is worse than one that shifts.
  cascade: true,
  showDependencies: true,
  // Teams are global, so a chart lists every team including ones with no work
  // here. Off by default — an empty row is where you plan that team's work.
  hideEmptyRows: false,
  collapsedRows: [],
};

function read(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PersistedSettings>) } : DEFAULTS;
  } catch {
    // Private mode, blocked site data, or corrupt JSON — defaults are fine.
    return DEFAULTS;
  }
}

/** View preferences, remembered per browser. */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly initial = read();

  readonly locale = signal<JalaliLocale>(this.initial.locale);
  readonly persianDigits = signal(this.initial.persianDigits);
  readonly zoom = signal<ZoomLevel>(this.initial.zoom);
  readonly cascade = signal(this.initial.cascade);
  readonly showDependencies = signal(this.initial.showDependencies);
  readonly hideEmptyRows = signal(this.initial.hideEmptyRows);

  /**
   * Which rows are collapsed, keyed by project *and* team.
   *
   * A team is shared by every project, so this cannot live on the team itself
   * — collapsing "Mechanics" while planning one programme should not fold it
   * away in another.
   */
  private readonly collapsedRows = signal<ReadonlySet<string>>(
    new Set(this.initial.collapsedRows),
  );

  isRowCollapsed(projectId: string, teamId: string): boolean {
    return this.collapsedRows().has(`${projectId}:${teamId}`);
  }

  toggleRowCollapsed(projectId: string, teamId: string): void {
    const key = `${projectId}:${teamId}`;
    this.collapsedRows.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  readonly zoomPreset = computed(
    () => ZOOM_PRESETS.find((preset) => preset.id === this.zoom()) ?? ZOOM_PRESETS[1],
  );

  /** Date-formatting options, ready to spread into the jalali helpers. */
  readonly dateFormat = computed(() => ({
    locale: this.locale(),
    persianDigits: this.persianDigits(),
  }));

  constructor() {
    effect(() => {
      const snapshot: PersistedSettings = {
        locale: this.locale(),
        persianDigits: this.persianDigits(),
        zoom: this.zoom(),
        cascade: this.cascade(),
        showDependencies: this.showDependencies(),
        hideEmptyRows: this.hideEmptyRows(),
        collapsedRows: [...this.collapsedRows()],
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // Persisting preferences is a convenience; never break the app over it.
      }
    });
  }

  toggleLocale(): void {
    const next: JalaliLocale = this.locale() === 'fa' ? 'en' : 'fa';
    this.locale.set(next);
    // Latin month names next to Persian numerals reads as a mistake, so the
    // digit script follows the language unless the user overrides it after.
    this.persianDigits.set(next === 'fa');
  }

  setZoom(zoom: ZoomLevel): void {
    this.zoom.set(zoom);
  }
}
