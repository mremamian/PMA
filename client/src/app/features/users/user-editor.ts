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
import { AvatarComponent } from '../../shared/avatar';
import { USER_COLORS, type Team, type User, type UserInput } from '../../core/models';

@Component({
  selector: 'pma-user-editor',
  imports: [ModalComponent, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pma-modal [title]="heading()" [width]="820" (closed)="cancelled.emit()">
      <div body>
        <div class="preview">
          <pma-avatar [user]="preview()" [size]="52" />
          <div class="preview__text">
            <strong>{{ name().trim() || 'فرد جدید' }}</strong>
            <span class="muted">{{ title().trim() || 'بدون سمت' }}</span>
            <span class="subtle">{{ teamLabel() }}</span>
          </div>
        </div>

        <div class="field">
          <label for="user-name">نام</label>
          <input
            id="user-name"
            type="text"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            placeholder="مثلاً: مریم رضایی"
          />
          @if (showErrors() && !name().trim()) {
            <p class="field__error">وارد کردن نام الزامی است.</p>
          }
        </div>

        <div class="field-row">
          <div class="field">
            <label for="user-title">سمت</label>
            <input
              id="user-title"
              type="text"
              [value]="title()"
              (input)="title.set($any($event.target).value)"
              placeholder="مثلاً: مهندس مکانیک"
            />
          </div>

          <div class="field">
            <label for="user-email">ایمیل</label>
            <input
              id="user-email"
              type="email"
              dir="ltr"
              [value]="email()"
              (input)="email.set($any($event.target).value)"
              placeholder="maryam@example.com"
            />
          </div>
        </div>

        <div class="field">
          <label for="user-team">تیم</label>
          <select
            id="user-team"
            [value]="teamId()"
            (change)="teamId.set($any($event.target).value)"
          >
            <option value="" [selected]="teamId() === ''">— بدون تیم —</option>
            @for (team of teams(); track team.id) {
              <option [value]="team.id" [selected]="team.id === teamId()">
                {{ team.name }}{{ team.kind === 'external' ? ' (بیرونی)' : '' }}
              </option>
            }
          </select>
          <p class="hint">
            تیم‌ها میان همهٔ پروژه‌ها مشترک‌اند. هنگام سپردن یک ماژول، ابتدا اعضای همان تیم پیشنهاد می‌شوند.
          </p>
        </div>

        <div class="field">
          <label>رنگ آواتار</label>
          <div class="palette">
            @for (swatch of palette; track swatch) {
              <button
                type="button"
                class="swatch"
                [class.swatch--active]="avatarColor() === swatch"
                [style.background]="swatch"
                (click)="avatarColor.set(swatch)"
                [attr.aria-label]="'انتخاب رنگ ' + swatch"
              ></button>
            }
            <input
              type="color"
              class="swatch swatch--custom"
              [value]="avatarColor()"
              (input)="avatarColor.set($any($event.target).value)"
              aria-label="رنگ دلخواه آواتار"
            />
          </div>
        </div>

        <div class="field">
          <label for="user-avatar">نشانی تصویر (اختیاری)</label>
          <input
            id="user-avatar"
            type="url"
            dir="ltr"
            [value]="avatarUrl()"
            (input)="avatarUrl.set($any($event.target).value)"
            placeholder="https://example.com/photo.jpg"
          />
          @if (showErrors() && avatarInvalid()) {
            <p class="field__error">باید یک نشانی http یا https باشد، یا خالی بماند.</p>
          } @else {
            <p class="hint">خالی بگذارید تا حرف اول نام روی رنگ بالا نمایش داده شود.</p>
          }
        </div>
      </div>

      <div footer>
        @if (user()) {
          <button type="button" class="btn btn--danger" (click)="deleted.emit()">حذف</button>
        }
        <span class="spacer"></span>
        <button type="button" class="btn" (click)="cancelled.emit()">انصراف</button>
        <button type="button" class="btn btn--primary" (click)="submit()">
          {{ user() ? 'ذخیرهٔ فرد' : 'افزودن فرد' }}
        </button>
      </div>
    </pma-modal>
  `,
  styles: `
    .preview {
      display: flex;
      align-items: center;
      gap: 13px;
      padding: 12px 14px;
      margin-bottom: 18px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-sunken);
    }

    .preview__text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;

      strong { font-size: 14px; }
      span { font-size: 12px; }
    }

    .palette { display: flex; flex-wrap: wrap; gap: 6px; }

    .swatch {
      width: 26px;
      height: 26px;
      padding: 0;
      border: 2px solid transparent;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgb(0 0 0 / 10%);

      &--active { border-color: var(--text); }
      &--custom { cursor: pointer; background: var(--surface); border-radius: 6px; }
    }

    .hint { margin: 5px 0 0; font-size: 11.5px; color: var(--text-subtle); }
    .spacer { flex: 1 1 auto; }
  `,
})
export class UserEditorComponent {
  /** `null` opens the dialog in create mode. */
  readonly user = input<User | null>(null);
  readonly teams = input.required<Team[]>();

  readonly saved = output<UserInput>();
  readonly deleted = output<void>();
  readonly cancelled = output<void>();

  protected readonly palette = USER_COLORS;

  protected readonly name = linkedSignal(() => this.user()?.name ?? '');
  protected readonly title = linkedSignal(() => this.user()?.title ?? '');
  protected readonly email = linkedSignal(() => this.user()?.email ?? '');
  protected readonly teamId = linkedSignal(() => this.user()?.teamId ?? '');
  protected readonly avatarUrl = linkedSignal(() => this.user()?.avatarUrl ?? '');
  protected readonly avatarColor = linkedSignal(
    () => this.user()?.avatarColor ?? USER_COLORS[0],
  );

  protected readonly showErrors = signal(false);

  protected readonly heading = computed(() => (this.user() ? 'ویرایش فرد' : 'فرد جدید'));

  protected readonly teamLabel = computed(() => {
    const id = this.teamId();
    if (!id) return 'بدون تیم';
    return this.teams().find((t) => t.id === id)?.name ?? 'بدون تیم';
  });

  protected readonly avatarInvalid = computed(() => {
    const url = this.avatarUrl().trim();
    return url !== '' && !/^https?:\/\//i.test(url);
  });

  /** A throwaway User so the live preview can reuse the avatar component. */
  protected readonly preview = computed<User>(() => ({
    id: 'preview',
    name: this.name().trim() || 'فرد جدید',
    email: null,
    title: this.title(),
    teamId: this.teamId() || null,
    avatarUrl: this.avatarInvalid() ? null : this.avatarUrl().trim() || null,
    avatarColor: this.avatarColor(),
    createdAt: '',
    updatedAt: '',
  }));

  protected submit(): void {
    if (!this.name().trim() || this.avatarInvalid()) {
      this.showErrors.set(true);
      return;
    }

    this.saved.emit({
      name: this.name().trim(),
      title: this.title().trim(),
      email: this.email().trim() || null,
      teamId: this.teamId() || null,
      avatarUrl: this.avatarUrl().trim() || null,
      avatarColor: this.avatarColor(),
    });
  }
}
