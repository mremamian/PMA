import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

export interface MultiSelectOption {
  id: string;
  label: string;
  /** Optional swatch, e.g. a project or team colour. */
  color?: string | null;
  /** Optional trailing detail, e.g. a count. */
  hint?: string;
}

/**
 * A dropdown that filters by several values at once.
 *
 * An empty selection means "everything", which is why the trigger reads
 * "All projects" rather than showing zero selected — a filter nobody has
 * touched should not look like one that excludes everything.
 */
@Component({
  selector: 'pma-multi-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <div class="wrap">
      <button
        type="button"
        class="trigger"
        [class.trigger--active]="selected().size > 0"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <span class="trigger__label truncate">{{ summary() }}</span>
        <span class="trigger__caret" aria-hidden="true">▾</span>
      </button>

      @if (open()) {
        <div class="backdrop" (click)="close()"></div>

        <div class="menu" role="listbox" [attr.aria-label]="label()">
          @if (options().length > 6) {
            <input
              type="search"
              class="menu__search"
              [placeholder]="'جستجو در ' + label() + '…'"
              [value]="search()"
              (input)="search.set($any($event.target).value)"
              (click)="$event.stopPropagation()"
            />
          }

          <div class="menu__list">
            @for (option of visibleOptions(); track option.id) {
              <label class="option">
                <input
                  type="checkbox"
                  [checked]="selected().has(option.id)"
                  (change)="toggleOption(option.id)"
                />
                @if (option.color) {
                  <span class="option__dot" [style.background]="option.color"></span>
                }
                <span class="option__label truncate">{{ option.label }}</span>
                @if (option.hint) {
                  <span class="option__hint">{{ option.hint }}</span>
                }
              </label>
            }
            @if (visibleOptions().length === 0) {
              <p class="menu__empty">چیزی پیدا نشد.</p>
            }
          </div>

          <div class="menu__foot">
            <button type="button" class="link" (click)="selectAll()">انتخاب همه</button>
            <button type="button" class="link" (click)="clear()">پاک کردن</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: inline-block; }

    .wrap { position: relative; }

    .trigger {
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 150px;
      max-width: 230px;
      padding: 5px 10px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);
      font-size: 12px;
      color: var(--text-muted);

      &:hover { background: var(--surface-hover); }

      &--active {
        border-color: var(--accent);
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: 500;
      }
    }

    .trigger__label { min-width: 0; }
    .trigger__caret { flex: 0 0 auto; font-size: 9px; opacity: 0.7; }

    .backdrop { position: fixed; inset: 0; z-index: 59; }

    .menu {
      position: absolute;
      z-index: 60;
      top: calc(100% + 4px);
      inset-inline-start: 0;
      width: 250px;
      padding: 6px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow-lg);
    }

    .menu__search {
      width: 100%;
      margin-bottom: 5px;
      padding: 5px 8px;
      font-size: 12px;
    }

    .menu__list { max-height: 240px; overflow-y: auto; }

    .menu__empty { margin: 6px; font-size: 12px; color: var(--text-subtle); }

    .option {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      font-size: 12.5px;
      font-weight: 400;
      cursor: pointer;

      &:hover { background: var(--surface-hover); }

      input {
        width: auto;
        margin: 0;
        padding: 0;
        accent-color: var(--accent);
        cursor: pointer;
        flex: 0 0 auto;
      }
    }

    .option__dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .option__label { flex: 1 1 auto; min-width: 0; }
    .option__hint { flex: 0 0 auto; font-size: 11px; color: var(--text-subtle); }

    .menu__foot {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-top: 5px;
      padding-top: 5px;
      border-top: 1px solid var(--border);
    }

    .link {
      padding: 2px 4px;
      border: 0;
      background: transparent;
      color: var(--accent);
      font-size: 11.5px;

      &:hover { text-decoration: underline; }
    }
  `,
})
export class MultiSelectComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly label = input.required<string>();
  readonly options = input.required<readonly MultiSelectOption[]>();
  readonly selected = input.required<ReadonlySet<string>>();
  /** Shown on the trigger when nothing is selected. */
  readonly allLabel = input('همه');

  readonly selectionChange = output<Set<string>>();

  protected readonly open = signal(false);
  protected readonly search = signal('');

  protected readonly visibleOptions = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.options();
    return this.options().filter((o) => o.label.toLowerCase().includes(term));
  });

  protected readonly summary = computed(() => {
    const count = this.selected().size;
    if (count === 0) return this.allLabel();

    if (count === 1) {
      const [id] = this.selected();
      return this.options().find((o) => o.id === id)?.label ?? this.allLabel();
    }

    return `${count} ${this.label()}`;
  });

  protected toggle(): void {
    this.open.update((v) => !v);
    if (!this.open()) this.search.set('');
  }

  protected close(): void {
    this.open.set(false);
    this.search.set('');
  }

  protected toggleOption(id: string): void {
    const next = new Set(this.selected());
    if (!next.delete(id)) next.add(id);
    this.selectionChange.emit(next);
  }

  protected selectAll(): void {
    this.selectionChange.emit(new Set(this.options().map((o) => o.id)));
  }

  protected clear(): void {
    this.selectionChange.emit(new Set());
  }
}
