import {
  ChangeDetectionStrategy,
  Component,
  input,
  linkedSignal,
  output,
} from '@angular/core';

import { ModalComponent } from '../../shared/modal';
import {
  DEPENDENCY_TYPE_LABELS,
  type Dependency,
  type DependencyType,
  type ProjectModule,
} from '../../core/models';

@Component({
  selector: 'pma-dependency-editor',
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pma-modal title="وابستگی" [width]="640" (closed)="cancelled.emit()">
      <div body>
        <div class="link">
          <span class="link__node">{{ from()?.name ?? 'نامشخص' }}</span>
          <span class="link__arrow" aria-hidden="true">←</span>
          <span class="link__node">{{ to()?.name ?? 'نامشخص' }}</span>
        </div>

        <div class="field">
          <label for="dependency-type">نوع پیوند</label>
          <select
            id="dependency-type"
            [value]="type()"
            (change)="type.set($any($event.target).value)"
          >
            @for (option of typeOptions; track option.value) {
              <option [value]="option.value" [selected]="option.value === type()">
                {{ option.value }} — {{ option.label }}
              </option>
            }
          </select>
        </div>

        <div class="field">
          <label for="dependency-lag">فاصله (روز)</label>
          <input
            id="dependency-lag"
            type="number"
            min="-365"
            max="365"
            [value]="lagDays()"
            (input)="lagDays.set(+$any($event.target).value)"
          />
          <p class="hint">
            عدد مثبت پس از پیش‌نیاز فاصله می‌اندازد؛ عدد منفی اجازه می‌دهد این دو هم‌پوشانی داشته باشند.
          </p>
        </div>
      </div>

      <div footer>
        <button type="button" class="btn btn--danger" (click)="removed.emit()">
          حذف پیوند
        </button>
        <span class="spacer"></span>
        <button type="button" class="btn" (click)="cancelled.emit()">انصراف</button>
        <button type="button" class="btn btn--primary" (click)="submit()">ذخیره</button>
      </div>
    </pma-modal>
  `,
  styles: `
    .link {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 10px 12px;
      margin-bottom: 16px;
      border-radius: var(--radius-sm);
      background: var(--surface-sunken);
      border: 1px solid var(--border);
      font-size: 13px;
    }

    .link__node { font-weight: 500; }
    .link__arrow { color: var(--text-subtle); }

    .hint { margin: 5px 0 0; font-size: 11.5px; color: var(--text-subtle); }
    .spacer { flex: 1 1 auto; }
  `,
})
export class DependencyEditorComponent {
  readonly dependency = input.required<Dependency>();
  readonly from = input<ProjectModule | null>(null);
  readonly to = input<ProjectModule | null>(null);

  readonly saved = output<{ type: DependencyType; lagDays: number }>();
  readonly removed = output<void>();
  readonly cancelled = output<void>();

  protected readonly typeOptions = (
    Object.keys(DEPENDENCY_TYPE_LABELS) as DependencyType[]
  ).map((value) => ({ value, label: DEPENDENCY_TYPE_LABELS[value] }));

  protected readonly type = linkedSignal<DependencyType>(() => this.dependency().type);
  protected readonly lagDays = linkedSignal(() => this.dependency().lagDays);

  protected submit(): void {
    this.saved.emit({ type: this.type(), lagDays: this.lagDays() });
  }
}
