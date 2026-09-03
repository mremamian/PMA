import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import type { User } from '../core/models';

/**
 * A user's avatar: their picture when they have one, otherwise their initials
 * on their colour.
 *
 * The image is treated as best-effort — a URL someone pasted may 404, be
 * removed later, or be blocked offline — so a load error falls back to the
 * initials rather than leaving a broken-image icon in the middle of the chart.
 */
@Component({
  selector: 'pma-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showImage()) {
      <img
        class="avatar avatar--image"
        [src]="user()!.avatarUrl"
        [alt]="user()!.name"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [title]="tooltip()"
        (error)="imageFailed.set(true)"
        loading="lazy"
      />
    } @else {
      <span
        class="avatar avatar--initials"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.background]="background()"
        [style.font-size.px]="fontSize()"
        [title]="tooltip()"
        [attr.aria-label]="label()"
        role="img"
      >{{ initials() }}</span>
    }
  `,
  styles: `
    :host { display: inline-flex; flex: 0 0 auto; }

    .avatar {
      display: inline-grid;
      place-items: center;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgb(0 0 0 / 10%);
      user-select: none;
    }

    .avatar--image { object-fit: cover; background: var(--surface-active); }

    .avatar--initials {
      color: #fff;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.01em;
    }
  `,
})
export class AvatarComponent {
  /** `null` renders a neutral placeholder for unassigned work. */
  readonly user = input<User | null>(null);
  readonly size = input(24);
  /** Extra context appended to the tooltip, e.g. the module's row. */
  readonly hint = input<string>('');

  protected readonly imageFailed = signal(false);

  protected readonly showImage = computed(
    () => !!this.user()?.avatarUrl && !this.imageFailed(),
  );

  protected readonly fontSize = computed(() =>
    Math.max(9, Math.round(this.size() * 0.4)),
  );

  protected readonly background = computed(
    () => this.user()?.avatarColor ?? 'var(--border-strong)',
  );

  /**
   * First letters of the first two words. Uses the code-point-aware spread so
   * a Persian or emoji name is not sliced through the middle of a character.
   */
  protected readonly initials = computed(() => {
    const name = this.user()?.name?.trim();
    if (!name) return '?';

    const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
    return words.map((word) => [...word][0] ?? '').join('') || '?';
  });

  protected readonly label = computed(() => this.user()?.name ?? 'بدون مسئول');

  protected readonly tooltip = computed(() => {
    const user = this.user();
    const hint = this.hint();

    if (!user) return hint ? `بدون مسئول · ${hint}` : 'بدون مسئول';

    const parts = [user.name];
    if (user.title) parts.push(user.title);
    if (user.teamName) parts.push(user.teamName);
    if (hint) parts.push(hint);
    return parts.join(' · ');
  });
}
