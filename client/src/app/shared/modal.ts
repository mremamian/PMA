import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * Modal shell: backdrop, header, projected body and footer.
 *
 * Content goes in via three slots so each dialog only writes its own fields:
 *   <pma-modal title="…">
 *     <ng-container body>…</ng-container>
 *     <ng-container footer>…</ng-container>
 *   </pma-modal>
 */
@Component({
  selector: 'pma-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="onBackdrop($event)">
      <div
        class="panel"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="title()"
        [style.--panel-width.px]="width()"
        (click)="$event.stopPropagation()"
      >
        <header class="panel__head">
          <h2 class="panel__title">{{ title() }}</h2>
          <button type="button" class="panel__close" (click)="closed.emit()" aria-label="بستن">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="m4 4 8 8M12 4l-8 8"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>

        <div class="panel__body">
          <ng-content select="[body]" />
        </div>

        <footer class="panel__foot">
          <ng-content select="[footer]" />
        </footer>
      </div>
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 3vh 16px 16px;
      background: rgb(16 24 40 / 42%);
      overflow-y: auto;
    }

    .panel {
      width: 100%;
      /* Never wider than the viewport, so the dialog itself cannot become the
         thing that scrolls sideways. */
      max-width: min(var(--panel-width, 720px), calc(100vw - 32px));
      background: var(--surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      max-height: 94vh;
    }

    .panel__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 15px 18px;
      border-bottom: 1px solid var(--border);
    }

    .panel__title { font-size: 15px; }

    .panel__close {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--text-subtle);

      &:hover { background: var(--surface-hover); color: var(--text); }
    }

    .panel__body {
      padding: 18px;
      overflow-y: auto;
      /* Only ever scrolls vertically; anything too wide wraps or shrinks. */
      overflow-x: hidden;
    }

    /* Grid and flex children default to min-width:auto, which lets a long
       value or a fixed-width control push the whole dialog wider than its
       max-width — that is where the sideways scrollbar came from. */
    .panel__body :is(.field-row, .field, .field-row > *) {
      min-width: 0;
    }

    .panel__body input,
    .panel__body select,
    .panel__body textarea {
      max-width: 100%;
    }

    /* Dialogs are wide now, so give free-text fields room to match. */
    .panel__body textarea {
      min-height: 96px;
    }

    .panel__foot {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 13px 18px;
      border-top: 1px solid var(--border);
      background: var(--surface-sunken);
      border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    }
  `,
})
export class ModalComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly title = input.required<string>();
  /** Preferred width in px; always clamped to the viewport. */
  readonly width = input(720);
  /** Clicking the dimmed area closes by default. */
  readonly dismissOnBackdrop = input(true);

  readonly closed = output<void>();

  constructor() {
    // Focus the first field so the dialog is usable from the keyboard at once.
    afterNextRender(() => {
      const target = this.host.nativeElement.querySelector<HTMLElement>(
        'input, select, textarea, button:not(.panel__close)',
      );
      target?.focus();
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.closed.emit();
  }

  protected onBackdrop(event: MouseEvent): void {
    if (this.dismissOnBackdrop() && event.target === event.currentTarget) {
      this.closed.emit();
    }
  }
}
