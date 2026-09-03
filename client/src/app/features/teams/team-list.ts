import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService, type ApiFailure } from '../../core/api.service';
import { SettingsStore } from '../../core/settings.store';
import type { Team, TeamInput, User } from '../../core/models';
import { AvatarComponent } from '../../shared/avatar';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog';
import { DigitsPipe } from '../../shared/digits.pipe';
import { TeamEditorComponent } from '../gantt/team-editor';

/**
 * The team roster.
 *
 * Teams are workspace-wide, so they need somewhere to live outside any one
 * project — a team can exist with no work planned anywhere yet, and its
 * ordering here is the row order every chart uses.
 */
@Component({
  selector: 'pma-team-list',
  imports: [
    RouterLink,
    AvatarComponent,
    TeamEditorComponent,
    ConfirmDialogComponent,
    DigitsPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './team-list.html',
  styleUrl: './team-list.scss',
})
export class TeamListComponent {
  private readonly api = inject(ApiService);
  protected readonly settings = inject(SettingsStore);

  protected readonly teams = signal<Team[]>([]);
  protected readonly users = signal<User[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** `null` = closed, `'new'` = create, otherwise the team being edited. */
  protected readonly editing = signal<Team | 'new' | null>(null);
  protected readonly deleting = signal<Team | null>(null);

  protected readonly editingTeam = computed(() => {
    const value = this.editing();
    return value === 'new' || value === null ? null : value;
  });

  /** Members of each team, so the card can show who is in it. */
  protected readonly membersByTeam = computed(() => {
    const map = new Map<string, User[]>();
    for (const user of this.users()) {
      if (!user.teamId) continue;
      const list = map.get(user.teamId);
      if (list) list.push(user);
      else map.set(user.teamId, [user]);
    }
    return map;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.listTeams().subscribe({
      next: (teams) => {
        this.teams.set(teams);
        this.loading.set(false);
      },
      error: (failure: ApiFailure) => {
        this.error.set(failure.message);
        this.loading.set(false);
      },
    });

    // Only used to show faces on each card; a failure here should not block.
    this.api.listUsers().subscribe({
      next: (users) => this.users.set(users),
      error: () => this.users.set([]),
    });
  }

  protected membersOf(teamId: string): User[] {
    return this.membersByTeam().get(teamId) ?? [];
  }

  protected save(input: TeamInput): void {
    const target = this.editing();

    if (target === 'new') {
      this.api.createTeam(input).subscribe({
        next: (team) => {
          this.teams.update((list) => [...list, team]);
          this.editing.set(null);
        },
        error: (failure: ApiFailure) => this.error.set(failure.message),
      });
      return;
    }

    if (target) {
      this.api.updateTeam(target.id, input).subscribe({
        next: (team) => {
          this.teams.update((list) => list.map((t) => (t.id === team.id ? team : t)));
          this.editing.set(null);
        },
        error: (failure: ApiFailure) => this.error.set(failure.message),
      });
    }
  }

  /** Moves a team one place in the order every chart shares. */
  protected move(teamId: string, direction: -1 | 1): void {
    const ordered = this.teams().map((t) => t.id);
    const index = ordered.indexOf(teamId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ordered.length) return;

    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];

    const snapshot = this.teams();
    const position = new Map(ordered.map((id, i) => [id, i]));
    this.teams.update((list) =>
      [...list].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0)),
    );

    this.api.reorderTeams(ordered).subscribe({
      next: (teams) => this.teams.set(teams),
      error: (failure: ApiFailure) => {
        this.teams.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  protected confirmDelete(): void {
    const team = this.deleting();
    if (!team) return;

    const snapshot = this.teams();
    this.teams.update((list) => list.filter((t) => t.id !== team.id));
    this.deleting.set(null);

    this.api.deleteTeam(team.id, true).subscribe({
      next: () => this.load(),
      error: (failure: ApiFailure) => {
        this.teams.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  protected deleteDetail(team: Team): string | null {
    const modules = team.moduleCount ?? 0;
    const projects = team.projectCount ?? 0;
    const members = team.memberCount ?? 0;

    if (!modules && !members) return null;

    const parts: string[] = [];
    if (modules) {
      parts.push(
        `این تیم ${modules} ماژول در ${projects} پروژه دارد و همهٔ آن‌ها به همراه وابستگی‌هایشان حذف می‌شوند.`,
      );
    }
    if (members) {
      parts.push(`${members} نفر عضو این تیم هستند و بدون تیم می‌شوند (حذف نمی‌شوند).`);
    }

    return parts.join(' ');
  }
}
