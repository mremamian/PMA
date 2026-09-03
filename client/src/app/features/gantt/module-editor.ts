import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';

import { ModalComponent } from '../../shared/modal';
import { AvatarComponent } from '../../shared/avatar';
import { DigitsPipe } from '../../shared/digits.pipe';
import { JalaliDateInputComponent } from '../../shared/jalali-date-input';
import { SettingsStore } from '../../core/settings.store';
import { addDays, todayIso, workingDaysBetween } from '../../core/jalali';
import {
  MODULE_STATUS_LABELS,
  type ModuleInput,
  type ModuleKind,
  type ModuleStatus,
  type ProjectModule,
  type Team,
  type User,
} from '../../core/models';

@Component({
  selector: 'pma-module-editor',
  imports: [ModalComponent, AvatarComponent, JalaliDateInputComponent, DigitsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pma-modal [title]="heading()" [width]="920" (closed)="cancelled.emit()">
      <div body>
        <div class="field">
          <label for="module-name">نام ماژول</label>
          <input
            id="module-name"
            type="text"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            placeholder="مثلاً: ساخت شاسی"
          />
          @if (showErrors() && !name().trim()) {
            <p class="field__error">وارد کردن نام الزامی است.</p>
          }
        </div>

        <div class="field-row">
          <div class="field">
            <label for="module-team">ردیف</label>
            <!-- Options carry [selected], not just the select carrying [value]:
                 a select's value is bound before its options exist, so on first
                 render it would silently fall back to the first row. -->
            <select
              id="module-team"
              [value]="teamId()"
              (change)="teamId.set($any($event.target).value)"
            >
              @for (team of teams(); track team.id) {
                <option [value]="team.id" [selected]="team.id === teamId()">
                  {{ team.name }}{{ team.kind === 'external' ? ' (بیرونی)' : '' }}
                </option>
              }
            </select>
          </div>

          <div class="field">
            <label for="module-kind">نوع</label>
            <select
              id="module-kind"
              [value]="kind()"
              (change)="kind.set($any($event.target).value)"
            >
              <option value="task" [selected]="kind() === 'task'">کار (میله)</option>
              <option value="milestone" [selected]="kind() === 'milestone'">
                نقطهٔ عطف (نشانگر)
              </option>
            </select>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>{{ kind() === 'milestone' ? 'تاریخ (شمسی)' : 'تاریخ شروع (شمسی)' }}</label>
            <pma-jalali-date-input [(value)]="startDate" ariaLabel="تاریخ شروع ماژول" />
          </div>

          @if (kind() !== 'milestone') {
            <div class="field">
              <label>تاریخ پایان (شمسی)</label>
              <pma-jalali-date-input
                [(value)]="endDate"
                [min]="startDate()"
                ariaLabel="تاریخ پایان ماژول"
              />
            </div>
          }
        </div>

        @if (kind() !== 'milestone') {
          <p class="duration">
            مدت: <strong>{{ durationDays() | digits: settings.persianDigits() }}</strong> روز
          </p>
          @if (showErrors() && datesInvalid()) {
            <p class="field__error">تاریخ پایان نباید پیش از تاریخ شروع باشد.</p>
          }
        }

        <div class="field-row">
          <div class="field">
            <label for="module-status">وضعیت</label>
            <select
              id="module-status"
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
            <label for="module-assignee">مسئول</label>
            <div class="assignee">
              <pma-avatar [user]="selectedUser()" [size]="28" />
              <select
                id="module-assignee"
                [value]="assigneeId()"
                (change)="assigneeId.set($any($event.target).value)"
              >
                <option value="" [selected]="assigneeId() === ''">— بدون مسئول —</option>
                @for (user of assignableUsers(); track user.id) {
                  <option [value]="user.id" [selected]="user.id === assigneeId()">
                    {{ user.name }}{{ user.title ? ' — ' + user.title : '' }}
                  </option>
                }
              </select>
            </div>

            @if (!users().length) {
              <p class="hint">
                هنوز کسی ثبت نشده — ابتدا در صفحهٔ «افراد» اضافه کنید، سپس اینجا انتخاب شود.
              </p>
            } @else if (!teamMembers().length) {
              <p class="hint">
                هیچ‌کس در این ردیف عضو نیست؛ همهٔ افراد نمایش داده می‌شوند.
              </p>
            } @else {
              <label class="toggle-all">
                <input
                  type="checkbox"
                  [checked]="showAllUsers()"
                  (change)="showAllUsers.set($any($event.target).checked)"
                />
                <span>نمایش افراد سایر ردیف‌ها</span>
              </label>
            }
          </div>
        </div>

        @if (kind() !== 'milestone') {
          <div class="field">
            <label for="module-progress">
              پیشرفت — {{ progress() | digits: settings.persianDigits() }}٪
            </label>
            <input
              id="module-progress"
              type="range"
              min="0"
              max="100"
              step="5"
              class="range"
              [value]="progress()"
              (input)="progress.set(+$any($event.target).value)"
            />
          </div>
        }

        <div class="field">
          <label for="module-description">یادداشت</label>
          <textarea
            id="module-description"
            [value]="description()"
            (input)="description.set($any($event.target).value)"
            placeholder="دامنه، ریسک‌ها، معیار پذیرش…"
          ></textarea>
        </div>
      </div>

      <div footer>
        @if (module()) {
          <button type="button" class="btn btn--danger" (click)="deleted.emit()">حذف</button>
        }
        <span class="spacer"></span>
        <button type="button" class="btn" (click)="cancelled.emit()">انصراف</button>
        <button type="button" class="btn btn--primary" (click)="submit()">
          {{ module() ? 'ذخیرهٔ ماژول' : 'افزودن ماژول' }}
        </button>
      </div>
    </pma-modal>
  `,
  styles: `
    .duration {
      margin: -6px 0 14px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .assignee {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .hint { margin: 5px 0 0; font-size: 11.5px; color: var(--text-subtle); }

    .toggle-all {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 6px 0 0;
      font-size: 11.5px;
      font-weight: 400;
      color: var(--text-subtle);
      cursor: pointer;

      input { width: auto; margin: 0; padding: 0; accent-color: var(--accent); cursor: pointer; }
    }
    .range { padding: 0; }
    .spacer { flex: 1 1 auto; }
  `,
})
export class ModuleEditorComponent {
  protected readonly settings = inject(SettingsStore);

  /** `null` opens the dialog in create mode. */
  readonly module = input<ProjectModule | null>(null);
  readonly teams = input.required<Team[]>();
  readonly users = input.required<User[]>();
  /** Row pre-selected when adding from a row's "+" button. */
  readonly defaultTeamId = input<string | null>(null);

  readonly saved = output<ModuleInput>();
  readonly deleted = output<void>();
  readonly cancelled = output<void>();

  protected readonly statusOptions = (
    Object.keys(MODULE_STATUS_LABELS) as ModuleStatus[]
  ).map((value) => ({ value, label: MODULE_STATUS_LABELS[value] }));

  protected readonly name = linkedSignal(() => this.module()?.name ?? '');
  protected readonly description = linkedSignal(() => this.module()?.description ?? '');
  protected readonly assigneeId = linkedSignal(() => this.module()?.assigneeId ?? '');
  protected readonly kind = linkedSignal<ModuleKind>(() => this.module()?.kind ?? 'task');
  protected readonly status = linkedSignal<ModuleStatus>(
    () => this.module()?.status ?? 'planned',
  );
  protected readonly progress = linkedSignal(() => this.module()?.progress ?? 0);
  protected readonly startDate = linkedSignal(() => this.module()?.startDate ?? todayIso());
  protected readonly endDate = linkedSignal(
    () => this.module()?.endDate ?? addDays(todayIso(), 13),
  );
  protected readonly teamId = linkedSignal(
    () => this.module()?.teamId ?? this.defaultTeamId() ?? this.teams()[0]?.id ?? '',
  );

  protected readonly showErrors = signal(false);

  protected readonly heading = computed(() =>
    this.module() ? 'ویرایش ماژول' : 'ماژول جدید',
  );

  protected readonly datesInvalid = computed(
    () => this.kind() !== 'milestone' && this.endDate() < this.startDate(),
  );

  /** Working days only — Thursdays and Fridays are not scheduled work. */
  protected readonly durationDays = computed(() =>
    workingDaysBetween(this.startDate(), this.endDate()),
  );

  protected readonly selectedUser = computed(
    () => this.users().find((u) => u.id === this.assigneeId()) ?? null,
  );

  /** Opt out of the team filter when the work needs someone from elsewhere. */
  protected readonly showAllUsers = signal(false);

  /** People whose home team is the row this module sits in. */
  protected readonly teamMembers = computed(() =>
    this.users().filter((u) => u.teamId && u.teamId === this.teamId()),
  );

  /**
   * Who this module can be assigned to: by default only the row's own team,
   * since that is nearly always who does the work.
   *
   * Two escape hatches keep the filter from being a trap — a team with no
   * members yet falls back to everyone, and whoever is currently assigned is
   * always listed even if they have since moved teams, so opening the dialog
   * cannot silently drop an existing assignment.
   */
  protected readonly assignableUsers = computed<User[]>(() => {
    const members = this.teamMembers();
    const everyone = this.users();

    const base = this.showAllUsers() || members.length === 0 ? everyone : members;
    const current = everyone.find((u) => u.id === this.assigneeId());

    return current && !base.some((u) => u.id === current.id) ? [current, ...base] : base;
  });

  constructor() {
    // A milestone is a single instant, so its end follows its start.
    effect(() => {
      if (this.kind() === 'milestone') this.endDate.set(this.startDate());
    });
  }

  protected submit(): void {
    if (!this.name().trim() || !this.teamId() || this.datesInvalid()) {
      this.showErrors.set(true);
      return;
    }

    const isMilestone = this.kind() === 'milestone';

    this.saved.emit({
      teamId: this.teamId(),
      name: this.name().trim(),
      description: this.description().trim(),
      startDate: this.startDate(),
      endDate: isMilestone ? this.startDate() : this.endDate(),
      progress: isMilestone ? 0 : this.progress(),
      kind: this.kind(),
      status: this.status(),
      // '' from the select means unassigned, which the API expects as null.
      assigneeId: this.assigneeId() || null,
    });
  }
}
