import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';

import { ModalComponent } from '../../shared/modal';
import { TEAM_COLORS, type Team, type TeamInput, type TeamKind } from '../../core/models';

@Component({
  selector: 'pma-team-editor',
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pma-modal [title]="heading()" [width]="660" (closed)="cancelled.emit()">
      <div body>
        <div class="field">
          <label for="team-name">نام تیم</label>
          <input
            id="team-name"
            type="text"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            placeholder="مثلاً: مکانیک"
          />
          @if (showErrors() && !name().trim()) {
            <p class="field__error">وارد کردن نام الزامی است.</p>
          }
        </div>

        <div class="field">
          <label>نوع ردیف</label>
          <div class="kinds">
            <button
              type="button"
              class="kind"
              [class.kind--active]="kind() === 'team'"
              (click)="kind.set('team')"
            >
              <strong>تیم اجرایی</strong>
              <span>تیمی که ماژول‌ها را می‌سازد.</span>
            </button>
            <button
              type="button"
              class="kind"
              [class.kind--active]="kind() === 'external'"
              (click)="kind.set('external')"
            >
              <strong>وابستگی بیرونی</strong>
              <span>مالی، خرید، پیمانکاران — کارهایی که بقیه منتظرشان هستند.</span>
            </button>
          </div>
          <p class="hint">
            تیم‌ها میان همهٔ پروژه‌ها مشترک‌اند و در نمودار هر پروژه نمایش داده می‌شوند.
          </p>
        </div>

        <div class="field">
          <label>رنگ ردیف</label>
          <div class="palette">
            @for (swatch of palette; track swatch) {
              <button
                type="button"
                class="swatch"
                [class.swatch--active]="color() === swatch"
                [style.background]="swatch"
                (click)="color.set(swatch)"
                [attr.aria-label]="'انتخاب رنگ ' + swatch"
              ></button>
            }
            <input
              type="color"
              class="swatch swatch--custom"
              [value]="color()"
              (input)="color.set($any($event.target).value)"
              aria-label="رنگ دلخواه"
            />
          </div>
        </div>
      </div>

      <div footer>
        <button type="button" class="btn" (click)="cancelled.emit()">انصراف</button>
        <button type="button" class="btn btn--primary" (click)="submit()">
          {{ team() ? 'ذخیرهٔ تیم' : 'افزودن تیم' }}
        </button>
      </div>
    </pma-modal>
  `,
  styles: `
    .kinds { display: grid; gap: 8px; }

    .kind {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 9px 11px;
      text-align: start;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);

      strong { font-size: 13px; font-weight: 600; }
      span { font-size: 12px; color: var(--text-muted); }

      &:hover { background: var(--surface-hover); }

      &--active {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
    }

    .hint { margin: 7px 0 0; font-size: 11.5px; color: var(--text-subtle); }

    .palette { display: flex; flex-wrap: wrap; gap: 6px; }

    .swatch {
      width: 26px;
      height: 26px;
      padding: 0;
      border: 2px solid transparent;
      border-radius: 6px;
      box-shadow: inset 0 0 0 1px rgb(0 0 0 / 10%);

      &--active { border-color: var(--text); }
      &--custom { cursor: pointer; background: var(--surface); }
    }
  `,
})
export class TeamEditorComponent {
  /** `null` opens the dialog in create mode. */
  readonly team = input<Team | null>(null);

  readonly saved = output<TeamInput>();
  readonly cancelled = output<void>();

  protected readonly palette = TEAM_COLORS;

  protected readonly name = linkedSignal(() => this.team()?.name ?? '');
  protected readonly kind = linkedSignal<TeamKind>(() => this.team()?.kind ?? 'team');
  protected readonly color = linkedSignal(() => this.team()?.color ?? TEAM_COLORS[0]);
  protected readonly showErrors = signal(false);

  protected readonly heading = computed(() => (this.team() ? 'ویرایش تیم' : 'تیم جدید'));

  protected submit(): void {
    if (!this.name().trim()) {
      this.showErrors.set(true);
      return;
    }

    this.saved.emit({
      name: this.name().trim(),
      kind: this.kind(),
      color: this.color(),
    });
  }
}
