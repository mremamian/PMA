import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService, type ApiFailure } from '../../core/api.service';
import { SettingsStore } from '../../core/settings.store';
import type { Team, User, UserInput } from '../../core/models';
import { AvatarComponent } from '../../shared/avatar';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog';
import { DigitsPipe } from '../../shared/digits.pipe';
import { UserEditorComponent } from './user-editor';

@Component({
  selector: 'pma-user-list',
  imports: [
    RouterLink,
    AvatarComponent,
    UserEditorComponent,
    ConfirmDialogComponent,
    DigitsPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-list.html',
  styleUrl: './user-list.scss',
})
export class UserListComponent {
  private readonly api = inject(ApiService);
  protected readonly settings = inject(SettingsStore);

  protected readonly users = signal<User[]>([]);
  protected readonly teams = signal<Team[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');

  /** `null` = closed, `'new'` = create, otherwise the person being edited. */
  protected readonly editing = signal<User | 'new' | null>(null);
  protected readonly deleting = signal<User | null>(null);

  protected readonly visibleUsers = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.users();

    return this.users().filter(
      (user) =>
        user.name.toLowerCase().includes(term) ||
        user.title.toLowerCase().includes(term) ||
        (user.teamName ?? '').toLowerCase().includes(term) ||
        (user.email ?? '').toLowerCase().includes(term),
    );
  });

  /** People grouped by team, in the teams' own order, unplaced ones last. */
  protected readonly groups = computed(() => {
    const byTeam = new Map<string, { label: string; users: User[] }>();

    for (const user of this.visibleUsers()) {
      const key = user.teamId ?? '__none__';
      const existing = byTeam.get(key);
      if (existing) existing.users.push(user);
      else byTeam.set(key, { label: user.teamName ?? 'بدون تیم', users: [user] });
    }

    const order = new Map(this.teams().map((team, index) => [team.id, index]));

    return [...byTeam]
      .sort(([a], [b]) => {
        if (a === '__none__') return 1;
        if (b === '__none__') return -1;
        return (order.get(a) ?? 0) - (order.get(b) ?? 0);
      })
      .map(([key, group]) => ({ key, ...group }));
  });

  protected readonly editingUser = computed(() => {
    const value = this.editing();
    return value === 'new' || value === null ? null : value;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.listUsers().subscribe({
      next: (users) => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: (failure: ApiFailure) => {
        this.error.set(failure.message);
        this.loading.set(false);
      },
    });

    // Needed for the team picker; a failure here should not block the list.
    this.api.listTeams().subscribe({
      next: (teams) => this.teams.set(teams),
      error: () => this.teams.set([]),
    });
  }

  protected save(input: UserInput): void {
    const target = this.editing();

    if (target === 'new') {
      this.api.createUser(input).subscribe({
        next: (user) => {
          this.users.update((list) => [...list, user].sort((a, b) => a.name.localeCompare(b.name)));
          this.editing.set(null);
        },
        error: (failure: ApiFailure) => this.error.set(failure.message),
      });
      return;
    }

    if (target) {
      this.api.updateUser(target.id, input).subscribe({
        next: (user) => {
          this.users.update((list) =>
            list.map((u) => (u.id === user.id ? user : u)).sort((a, b) => a.name.localeCompare(b.name)),
          );
          this.editing.set(null);
        },
        error: (failure: ApiFailure) => this.error.set(failure.message),
      });
    }
  }

  protected requestDelete(): void {
    const user = this.editingUser();
    if (!user) return;
    this.editing.set(null);
    this.deleting.set(user);
  }

  protected confirmDelete(): void {
    const user = this.deleting();
    if (!user) return;

    const snapshot = this.users();
    this.users.update((list) => list.filter((u) => u.id !== user.id));
    this.deleting.set(null);

    this.api.deleteUser(user.id).subscribe({
      error: (failure: ApiFailure) => {
        this.users.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  protected deleteDetail(user: User): string | null {
    const count = user.assignedModuleCount ?? 0;
    if (!count) return null;

    return `${count} ماژول که مسئولشان ${user.name} است بدون مسئول می‌شود. خود ماژول‌ها حذف نمی‌شوند.`;
  }
}
