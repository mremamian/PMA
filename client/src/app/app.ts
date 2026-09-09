import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { SettingsStore } from './core/settings.store';
import { formatLong, todayIso } from './core/jalali';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly settings = inject(SettingsStore);

  /**
   * Side navigation. The icons carry the meaning when the rail is collapsed,
   * so each one has to be distinguishable at a glance rather than decorative.
   */
  protected readonly navItems = [
    { path: '/projects', label: 'پروژه‌ها', icon: '▦' },
    { path: '/teams', label: 'تیم‌ها', icon: '◈' },
    { path: '/people', label: 'افراد', icon: '☺' },
    { path: '/reports', label: 'گزارش‌ها', icon: '▤' },
  ];

  /** Today's date in Shamsi, shown at the foot of the rail. */
  protected today(): string {
    return formatLong(todayIso(), this.settings.dateFormat());
  }
}
