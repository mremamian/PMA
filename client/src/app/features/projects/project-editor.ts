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
import { JalaliDateInputComponent } from '../../shared/jalali-date-input';
import { addDays, todayIso } from '../../core/jalali';
import {
  PROJECT_STATUS_LABELS,
  type Project,
  type ProjectInput,
  type ProjectStatus,
} from '../../core/models';

@Component({
  selector: 'pma-project-editor',
  imports: [ModalComponent, JalaliDateInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pma-modal [title]="heading()" [width]="760" (closed)="cancelled.emit()">
      <div body>
        <div class="field">
          <label for="project-name">نام پروژه</label>
          <input
            id="project-name"
            type="text"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            placeholder="مثلاً: چمدانی ۶۰-۴۰"
          />
          @if (showErrors() && !name().trim()) {
            <p class="field__error">وارد کردن نام الزامی است.</p>
          }
        </div>

        <div class="field">
          <label for="project-description">توضیحات</label>
          <textarea
            id="project-description"
            [value]="description()"
            (input)="description.set($any($event.target).value)"
            placeholder="این پروژه قرار است چه چیزی تحویل دهد؟"
          ></textarea>
        </div>

        <div class="field-row">
          <div class="field">
            <label>تاریخ شروع (شمسی)</label>
            <pma-jalali-date-input [(value)]="startDate" ariaLabel="تاریخ شروع پروژه" />
          </div>
          <div class="field">
            <label>تاریخ پایان (شمسی)</label>
            <pma-jalali-date-input
              [(value)]="endDate"
              [min]="startDate()"
              ariaLabel="تاریخ پایان پروژه"
            />
          </div>
        </div>
        @if (showErrors() && datesInvalid()) {
          <p class="field__error">تاریخ پایان نباید پیش از تاریخ شروع باشد.</p>
        }

        <div class="field-row">
          <div class="field">
            <label for="project-status">وضعیت</label>
            <select
              id="project-status"
              [value]="status()"
              (change)="status.set($any($event.target).value)"
            >
              @for (option of statusOptions; track option.value) {
                <option [value]="option.value" [selected]="option.value === status()">
                  {{ option.label }}
                </option>
              }
            </select>
          </div>

          <div class="field">
            <label for="project-color">رنگ شاخص</label>
            <input
              id="project-color"
              type="color"
              class="colour"
              [value]="color()"
              (input)="color.set($any($event.target).value)"
            />
          </div>
        </div>
      </div>

      <div footer>
        <button type="button" class="btn" (click)="cancelled.emit()">انصراف</button>
        <button type="button" class="btn btn--primary" (click)="submit()">
          {{ project() ? 'ذخیرهٔ تغییرات' : 'ساخت پروژه' }}
        </button>
      </div>
    </pma-modal>
  `,
  styles: `
    .colour { height: 34px; padding: 3px; cursor: pointer; }
  `,
})
export class ProjectEditorComponent {
  /** `null` opens the dialog in create mode. */
  readonly project = input<Project | null>(null);

  readonly saved = output<ProjectInput>();
  readonly cancelled = output<void>();

  protected readonly statusOptions = (
    Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]
  ).map((value) => ({ value, label: PROJECT_STATUS_LABELS[value] }));

  // linkedSignal: writable while the user edits, but re-seeded from the input
  // whenever a different project is passed in.
  protected readonly name = linkedSignal(() => this.project()?.name ?? '');
  protected readonly description = linkedSignal(() => this.project()?.description ?? '');
  protected readonly startDate = linkedSignal(() => this.project()?.startDate ?? todayIso());
  protected readonly endDate = linkedSignal(
    () => this.project()?.endDate ?? addDays(todayIso(), 90),
  );
  protected readonly status = linkedSignal<ProjectStatus>(
    () => this.project()?.status ?? 'active',
  );
  protected readonly color = linkedSignal(() => this.project()?.color ?? '#6366f1');

  protected readonly showErrors = signal(false);

  protected readonly heading = computed(() =>
    this.project() ? 'ویرایش پروژه' : 'پروژهٔ جدید',
  );

  protected readonly datesInvalid = computed(() => this.endDate() < this.startDate());

  protected submit(): void {
    if (!this.name().trim() || this.datesInvalid()) {
      this.showErrors.set(true);
      return;
    }

    this.saved.emit({
      name: this.name().trim(),
      description: this.description().trim(),
      startDate: this.startDate(),
      endDate: this.endDate(),
      status: this.status(),
      color: this.color(),
    });
  }
}
