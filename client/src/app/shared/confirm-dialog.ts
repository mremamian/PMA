import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { ModalComponent } from './modal';

/** Yes/no confirmation for destructive actions. */
@Component({
  selector: 'pma-confirm-dialog',
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pma-modal [title]="title()" [width]="560" (closed)="cancelled.emit()">
      <div body>
        <p class="message">{{ message() }}</p>
        @if (detail()) {
          <p class="detail">{{ detail() }}</p>
        }
      </div>

      <div footer>
        <button type="button" class="btn" (click)="cancelled.emit()">انصراف</button>
        <button type="button" class="btn btn--danger" (click)="confirmed.emit()">
          {{ confirmLabel() }}
        </button>
      </div>
    </pma-modal>
  `,
  styles: `
    .message { margin: 0; }

    .detail {
      margin: 10px 0 0;
      padding: 9px 11px;
      border-radius: var(--radius-sm);
      background: var(--warning-soft);
      border: 1px solid #fde5b0;
      color: #92400e;
      font-size: 13px;
    }
  `,
})
export class ConfirmDialogComponent {
  readonly title = input('مطمئن هستید؟');
  readonly message = input.required<string>();
  /** Extra warning shown in a highlighted block, e.g. cascading deletes. */
  readonly detail = input<string | null>(null);
  readonly confirmLabel = input('حذف');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
