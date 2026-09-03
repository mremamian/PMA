import { Pipe, PipeTransform } from '@angular/core';

import { toPersianDigits } from '../core/jalali';

/**
 * Renders a number in Persian numerals: `{{ count | digits: settings.persianDigits() }}`
 *
 * The flag is passed in rather than read from the settings store so the pipe
 * stays pure — a pure pipe re-runs when its arguments change, which is exactly
 * what toggling the numeral script does, and avoids an impure pipe running on
 * every change-detection pass.
 */
@Pipe({ name: 'digits' })
export class DigitsPipe implements PipeTransform {
  transform(value: number | string | null | undefined, persian = true): string {
    if (value === null || value === undefined) return '';
    return persian ? toPersianDigits(String(value)) : String(value);
  }
}
