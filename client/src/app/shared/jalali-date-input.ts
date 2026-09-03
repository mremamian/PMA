import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';

import { SettingsStore } from '../core/settings.store';
import {
  JALALI_WEEKDAYS_EN,
  JALALI_WEEKDAYS_FA,
  addDays,
  formatShort,
  jalaliMonthLength,
  jalaliWeekday,
  monthName,
  parseJalaliInput,
  toIso,
  toJalali,
  todayIso,
  toPersianDigits,
} from '../core/jalali';

interface DayCell {
  iso: string;
  day: string;
  isToday: boolean;
  isSelected: boolean;
  isOutOfRange: boolean;
}

/**
 * A text field that reads and writes Shamsi dates while its value stays a
 * Gregorian ISO string, plus a month-grid picker.
 *
 * Typing is accepted in either script — `1405/6/11` and `۱۴۰۵/۰۶/۱۱` both
 * parse — and an unparseable entry reverts on blur rather than clearing a date
 * the user had already set.
 */
@Component({
  selector: 'pma-jalali-date-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" [class.wrap--open]="open()">
      <input
        #textInput
        type="text"
        class="input"
        inputmode="numeric"
        dir="ltr"
        [value]="text()"
        [disabled]="disabled()"
        [attr.aria-label]="ariaLabel()"
        [placeholder]="placeholder()"
        (input)="onType($any($event.target).value)"
        (blur)="commit()"
        (keydown.enter)="commit(); $event.preventDefault()"
        (keydown.escape)="close()"
      />

      <button
        type="button"
        class="trigger"
        [disabled]="disabled()"
        (click)="toggle()"
        [attr.aria-expanded]="open()"
        aria-label="باز کردن تقویم شمسی"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M4.5 1v1.5M11.5 1v1.5M2 5h12M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
          />
        </svg>
      </button>

      @if (open()) {
        <div
          class="popup"
          [class.fa-text]="settings.locale() === 'fa'"
          [style.top.px]="popupPosition().top"
          [style.left.px]="popupPosition().left"
        >
          <div class="popup__head">
            <button type="button" class="nav" (click)="shiftMonth(-1)" aria-label="ماه قبل">‹</button>
            <div class="popup__title">{{ headingText() }}</div>
            <button type="button" class="nav" (click)="shiftMonth(1)" aria-label="ماه بعد">›</button>
          </div>

          <div class="popup__weekdays">
            @for (label of weekdayLabels(); track label) {
              <span>{{ label }}</span>
            }
          </div>

          <div class="popup__grid">
            @for (blank of leadingBlanks(); track $index) {
              <span class="cell cell--blank"></span>
            }
            @for (cell of dayCells(); track cell.iso) {
              <button
                type="button"
                class="cell"
                [class.cell--today]="cell.isToday"
                [class.cell--selected]="cell.isSelected"
                [disabled]="cell.isOutOfRange"
                (click)="pick(cell.iso)"
              >
                {{ cell.day }}
              </button>
            }
          </div>

          <div class="popup__foot">
            <button type="button" class="btn btn--sm" (click)="pick(today)">امروز</button>
            @if (value()) {
              <span class="popup__current">{{ formatted() }}</span>
            }
          </div>
        </div>

        <!-- Click-away target; sits behind the popup, above everything else. -->
        <div class="backdrop" (click)="close()"></div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }

    .wrap { position: relative; }

    /* Dates are typed and shown left-to-right even in the RTL layout, so the
       field is forced LTR and the trigger pinned with logical properties. */
    .input {
      padding-inline-end: 32px;
      font-variant-numeric: tabular-nums;
      text-align: start;
    }

    .trigger {
      position: absolute;
      top: 50%;
      inset-inline-end: 6px;
      transform: translateY(-50%);
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--text-subtle);

      &:hover:not(:disabled) { background: var(--surface-hover); color: var(--text); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    .backdrop { position: fixed; inset: 0; z-index: 119; }

    /* Fixed, not absolute: inside a dialog the field sits in a vertically
       scrolling body, where an absolutely positioned popup would add to the
       scroll height and make the dialog scroll instead of opening over it.
       Fixed takes it out of that container entirely, so the coordinates are
       measured from the trigger when it opens. */
    .popup {
      position: fixed;
      z-index: 120;
      width: 244px;
      padding: 10px;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
    }

    .popup__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .popup__title { font-size: 13px; font-weight: 600; }

    .nav {
      width: 24px;
      height: 24px;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: var(--surface);
      color: var(--text-muted);
      line-height: 1;

      &:hover { background: var(--surface-hover); color: var(--text); }
    }

    .popup__weekdays,
    .popup__grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }

    .popup__weekdays {
      margin-bottom: 4px;
      font-size: 10px;
      color: var(--text-subtle);
      text-align: center;
    }

    .cell {
      height: 28px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--text);
      font-size: 12px;
      font-variant-numeric: tabular-nums;

      &:hover:not(:disabled):not(.cell--blank) { background: var(--surface-hover); }
      &:disabled { opacity: 0.3; cursor: not-allowed; }
    }

    .cell--blank { pointer-events: none; }

    .cell--today {
      box-shadow: inset 0 0 0 1px var(--accent);
      color: var(--accent);
      font-weight: 600;
    }

    .cell--selected {
      background: var(--accent);
      color: var(--text-inverse);
      font-weight: 600;

      &:hover { background: var(--accent-hover); }
    }

    .popup__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }

    .popup__current { font-size: 11px; color: var(--text-muted); }
  `,
})
export class JalaliDateInputComponent {
  protected readonly settings = inject(SettingsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Gregorian ISO `YYYY-MM-DD`; empty string means unset. */
  readonly value = model<string>('');
  readonly disabled = input(false);
  readonly ariaLabel = input<string>('Date');
  /** Optional bounds, e.g. a module cannot start before its project. */
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);

  protected readonly today = todayIso();
  protected readonly open = signal(false);

  /** Viewport coordinates for the fixed-position popup. */
  protected readonly popupPosition = signal({ top: 0, left: 0 });

  /** Tears down the reposition listeners when the popup closes. */
  private popupListeners: AbortController | null = null;

  private static readonly POPUP_WIDTH = 244;
  private static readonly POPUP_HEIGHT = 296;
  private static readonly VIEWPORT_MARGIN = 8;

  /** Raw text while the user is typing; null means "mirror `value`". */
  private readonly draft = signal<string | null>(null);
  private readonly viewAnchor = signal<string | null>(null);

  protected readonly formatted = computed(() =>
    this.value() ? formatShort(this.value(), this.settings.dateFormat()) : '',
  );

  protected readonly text = computed(() => this.draft() ?? this.formatted());

  protected readonly placeholder = computed(() =>
    this.settings.persianDigits() ? toPersianDigits('1405/01/01') : '1405/01/01',
  );

  /** Month the grid is showing: the selected date, else today. */
  private readonly viewMonth = computed(() => {
    const anchor = this.viewAnchor() ?? (this.value() || this.today);
    const { jy, jm } = toJalali(anchor);
    return { jy, jm };
  });

  protected readonly headingText = computed(() => {
    const { jy, jm } = this.viewMonth();
    const label = `${monthName(jm, this.settings.locale())} ${jy}`;
    return this.settings.persianDigits() ? toPersianDigits(label) : label;
  });

  protected readonly weekdayLabels = computed(() =>
    this.settings.locale() === 'fa' ? JALALI_WEEKDAYS_FA : JALALI_WEEKDAYS_EN,
  );

  /** Empty cells before the 1st, so the month lands on the right weekday. */
  protected readonly leadingBlanks = computed(() => {
    const { jy, jm } = this.viewMonth();
    return new Array(jalaliWeekday(toIso(jy, jm, 1))).fill(0);
  });

  protected readonly dayCells = computed<DayCell[]>(() => {
    const { jy, jm } = this.viewMonth();
    const selected = this.value();
    const persian = this.settings.persianDigits();
    const min = this.min();
    const max = this.max();

    return Array.from({ length: jalaliMonthLength(jy, jm) }, (_, index) => {
      const day = index + 1;
      const iso = toIso(jy, jm, day);
      return {
        iso,
        day: persian ? toPersianDigits(day) : String(day),
        isToday: iso === this.today,
        isSelected: iso === selected,
        isOutOfRange: (!!min && iso < min) || (!!max && iso > max),
      };
    });
  });

  protected toggle(): void {
    if (this.disabled()) return;

    if (this.open()) {
      this.close();
      return;
    }

    this.viewAnchor.set(this.value() || this.today);
    this.reposition();
    this.open.set(true);

    // The field can move under the popup — the dialog body scrolls, the window
    // resizes — so follow it rather than leaving the calendar stranded.
    this.popupListeners?.abort();
    this.popupListeners = new AbortController();
    const options = { signal: this.popupListeners.signal, capture: true, passive: true };
    window.addEventListener('scroll', () => this.reposition(), options);
    window.addEventListener('resize', () => this.reposition(), options);
  }

  protected close(): void {
    this.open.set(false);
    this.popupListeners?.abort();
    this.popupListeners = null;
  }

  /**
   * Places the popup under the field, flipping above when there is not enough
   * room below, and clamped so it never hangs off the viewport edge.
   */
  private reposition(): void {
    const anchor = this.host.nativeElement.querySelector<HTMLElement>('.wrap');
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const { POPUP_WIDTH, POPUP_HEIGHT, VIEWPORT_MARGIN } = JalaliDateInputComponent;

    const roomBelow = window.innerHeight - rect.bottom;
    const top =
      roomBelow >= POPUP_HEIGHT + VIEWPORT_MARGIN
        ? rect.bottom + 5
        : Math.max(VIEWPORT_MARGIN, rect.top - POPUP_HEIGHT - 5);

    // Align the popup's leading edge with the field's, which is the right edge
    // under RTL.
    const rtl = getComputedStyle(anchor).direction === 'rtl';
    const preferred = rtl ? rect.right - POPUP_WIDTH : rect.left;

    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, preferred),
      window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN,
    );

    this.popupPosition.set({ top, left });
  }

  protected onType(raw: string): void {
    this.draft.set(raw);
  }

  /** Apply typed text, or put back the previous value if it does not parse. */
  protected commit(): void {
    const raw = this.draft();
    if (raw === null) return;

    this.draft.set(null);

    if (!raw.trim()) {
      this.value.set('');
      return;
    }

    const parsed = parseJalaliInput(raw);
    if (parsed && !this.isOutOfRange(parsed)) this.value.set(parsed);
  }

  protected pick(iso: string): void {
    if (this.isOutOfRange(iso)) return;
    this.draft.set(null);
    this.value.set(iso);
    this.close();
    this.host.nativeElement.querySelector('input')?.focus();
  }

  ngOnDestroy(): void {
    this.popupListeners?.abort();
  }

  protected shiftMonth(delta: number): void {
    const { jy, jm } = this.viewMonth();
    // Step to the 1st, then jump a whole month so day 31 never overflows.
    const first = toIso(jy, jm, 1);
    const target =
      delta > 0
        ? addDays(first, jalaliMonthLength(jy, jm))
        : addDays(first, -1);
    this.viewAnchor.set(target);
  }

  private isOutOfRange(iso: string): boolean {
    const min = this.min();
    const max = this.max();
    return (!!min && iso < min) || (!!max && iso > max);
  }
}
