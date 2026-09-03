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

  /** Today's date in Shamsi, shown in the header. */
  protected today(): string {
    return formatLong(todayIso(), this.settings.dateFormat());
  }
}
