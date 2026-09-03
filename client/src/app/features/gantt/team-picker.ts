import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { ModalComponent } from '../../shared/modal';
import { DigitsPipe } from '../../shared/digits.pipe';
import { SettingsStore } from '../../core/settings.store';
import type { Team } from '../../core/models';

/**
 * Chooses which teams a project involves.
 *
 * Deliberately a picker over the existing registry rather than a create form:
 * making a team from inside a project is how you end up with three separate
 * "Mechanics" records. Creating a genuinely new team is a workspace-level act
 * and lives on the Teams page, linked from here.
 */
@Component({
  selector: 'pma-team-picker',
  imports: [ModalComponent, RouterLink, DigitsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pma-modal title="تیم‌های این پروژه" [width]="800" (closed)="cancelled.emit()">
      <div body>
        <p class="intro">
          تیم‌ها یک‌بار در فهرست تیم‌ها ساخته می‌شوند و هر پروژه از میان آن‌ها انتخاب می‌کند.
          هر تیم انتخاب‌شده یک ردیف در نمودار این پروژه دارد.
        </p>

        @if (allTeams().length === 0) {
          <p class="empty">
            هنوز تیمی ساخته نشده. ابتدا در <a routerLink="/teams">فهرست تیم‌ها</a> تیم بسازید.
          </p>
        } @else {
          <ul class="teams">
            @for (team of allTeams(); track team.id) {
              @let count = moduleCount(team.id);
              @let removing = !selected().has(team.id) && count > 0;
              <li class="team" [class.team--warn]="removing">
                <label class="team__label">
                  <input
                    type="checkbox"
                    [checked]="selected().has(team.id)"
                    (change)="toggle(team.id)"
                  />
                  <span class="team__swatch" [style.background]="team.color"></span>
                  <span class="team__text">
                    <span class="team__name truncate">{{ team.name }}</span>
                    <span class="team__meta">
                      @if (team.kind === 'external') {
                        <span class="badge">بیرونی</span>
                      }
                      {{ (team.memberCount ?? 0) | digits: settings.persianDigits() }} عضو
                      @if (count > 0) {
                        · {{ count | digits: settings.persianDigits() }} ماژول در این پروژه
                      }
                    </span>
                  </span>
                </label>

                @if (removing) {
                  <span class="team__warn">
                    با برداشتن تیک، {{ count | digits: settings.persianDigits() }} ماژول این تیم
                    در این پروژه حذف می‌شود.
                  </span>
                }
              </li>
            }
          </ul>
        }

        @if (destructiveCount() > 0) {
          <p class="danger">
            در مجموع {{ destructiveCount() | digits: settings.persianDigits() }} ماژول حذف
            خواهد شد. تیم و کارهایش در پروژه‌های دیگر دست‌نخورده می‌مانند.
          </p>
        }
      </div>

      <div footer>
        <a class="btn btn--sm btn--ghost" routerLink="/teams">ساخت تیم جدید…</a>
        <span class="spacer"></span>
        <button type="button" class="btn" (click)="cancelled.emit()">انصراف</button>
        <button
          type="button"
          class="btn"
          [class.btn--primary]="destructiveCount() === 0"
          [class.btn--danger]="destructiveCount() > 0"
          (click)="saved.emit([...selected()])"
        >
          {{ destructiveCount() > 0 ? 'ذخیره و حذف ماژول‌ها' : 'ذخیره' }}
        </button>
      </div>
    </pma-modal>
  `,
  styles: `
    .intro {
      margin: 0 0 14px;
      font-size: 12.5px;
      color: var(--text-muted);
    }

    .empty { margin: 0; font-size: 13px; a { color: var(--accent); } }

    .teams {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-height: 46vh;
      overflow-y: auto;
    }

    .team {
      border: 1px solid transparent;
      border-radius: var(--radius-sm);

      &:hover { background: var(--surface-hover); }
      &--warn { background: var(--warning-soft); border-color: #fde5b0; }
    }

    .team__label {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 0;
      padding: 8px 10px;
      font-weight: 400;
      cursor: pointer;

      input {
        width: auto;
        margin: 0;
        padding: 0;
        accent-color: var(--accent);
        cursor: pointer;
        flex: 0 0 auto;
      }
    }

    .team__swatch {
      width: 4px;
      align-self: stretch;
      min-height: 26px;
      border-radius: 2px;
      flex: 0 0 auto;
    }

    .team__text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .team__name { font-size: 13px; font-weight: 500; color: var(--text); }
    .team__meta { font-size: 11px; color: var(--text-subtle); }

    .badge {
      padding: 0 5px;
      border-radius: 999px;
      background: #fef3c7;
      color: #92400e;
      font-size: 9px;
      font-weight: 600;
      margin-inline-end: 4px;
    }

    .team__warn {
      display: block;
      padding: 0 10px 8px 33px;
      font-size: 11px;
      color: #92400e;
    }

    .danger {
      margin: 12px 0 0;
      padding: 9px 11px;
      border-radius: var(--radius-sm);
      background: var(--danger-soft);
      border: 1px solid #f6cccc;
      color: #991b1b;
      font-size: 12.5px;
    }

    .spacer { flex: 1 1 auto; }
  `,
})
export class TeamPickerComponent {
  protected readonly settings = inject(SettingsStore);

  /** The whole registry to choose from. */
  readonly allTeams = input.required<Team[]>();
  /** Teams currently connected to this project. */
  readonly linkedIds = input.required<readonly string[]>();
  /** Modules per team *in this project* — what unchecking would destroy. */
  readonly moduleCounts = input.required<ReadonlyMap<string, number>>();

  readonly saved = output<string[]>();
  readonly cancelled = output<void>();

  protected readonly selected = linkedSignal<ReadonlySet<string>>(
    () => new Set(this.linkedIds()),
  );

  protected moduleCount(teamId: string): number {
    return this.moduleCounts().get(teamId) ?? 0;
  }

  protected toggle(teamId: string): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(teamId)) next.add(teamId);
      return next;
    });
  }

  /** Modules that would be deleted by the pending deselections. */
  protected readonly destructiveCount = computed(() => {
    let total = 0;
    for (const teamId of this.linkedIds()) {
      if (!this.selected().has(teamId)) total += this.moduleCount(teamId);
    }
    return total;
  });
}
