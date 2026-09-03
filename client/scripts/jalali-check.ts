/**
 * Self-check for the Jalali calendar layer. Run with `npm run check:jalali`.
 *
 * Node executes this .ts directly via type stripping — no build step, so the
 * check runs against exactly the source the app imports.
 */
import {
  toJalali,
  toIso,
  isLeapJalaliYear,
  jalaliMonthLength,
  formatLong,
  formatShort,
  formatMonthYear,
  parseJalaliInput,
  addDays,
  diffDays,
  durationDays,
  isWeekend,
  nextWorkingDay,
  workingDaysBetween,
  addWorkingDays,
  jalaliWeekday,
  startOfJalaliWeek,
  startOfJalaliMonth,
  startOfJalaliYear,
  toPersianDigits,
} from '../src/app/core/jalali.ts';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label} -> ${a}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}: got ${a}, expected ${e}`);
  }
}

console.log('Gregorian -> Jalali');
check('1979-02-11 (revolution)', toJalali('1979-02-11'), { jy: 1357, jm: 11, jd: 22 });
check('2026-09-02', toJalali('2026-09-02'), { jy: 1405, jm: 6, jd: 11 });
check('2000-01-01', toJalali('2000-01-01'), { jy: 1378, jm: 10, jd: 11 });
check('2021-03-21 (Nowruz 1400)', toJalali('2021-03-21'), { jy: 1400, jm: 1, jd: 1 });
check('2025-03-20 (last day of 1403)', toJalali('2025-03-20'), { jy: 1403, jm: 12, jd: 30 });
check('2024-03-20 (Nowruz 1403)', toJalali('2024-03-20'), { jy: 1403, jm: 1, jd: 1 });

console.log('\nJalali -> Gregorian');
check('1357/11/22', toIso(1357, 11, 22), '1979-02-11');
check('1405/06/11', toIso(1405, 6, 11), '2026-09-02');
check('1400/01/01', toIso(1400, 1, 1), '2021-03-21');
check('1403/12/30', toIso(1403, 12, 30), '2025-03-20');

console.log('\nLeap years and month lengths');
check('1403 is leap', isLeapJalaliYear(1403), true);
check('1404 is leap', isLeapJalaliYear(1404), false);
check('Esfand 1403 (leap)', jalaliMonthLength(1403, 12), 30);
check('Esfand 1405 (common)', jalaliMonthLength(1405, 12), 29);
check('Farvardin', jalaliMonthLength(1405, 1), 31);
check('Mehr', jalaliMonthLength(1405, 7), 30);

console.log('\nFormatting');
// Compared against runtime-built strings so this file stays pure ASCII and
// cannot be broken by an editor or shell re-encoding it.
const faLong = `${toPersianDigits(11)} ${'شهریور'} ${toPersianDigits(1405)}`;
check('formatLong fa', formatLong('2026-09-02'), faLong);
check('formatLong en', formatLong('2026-09-02', { locale: 'en' }), '11 Shahrivar 1405');
check('formatShort fa', formatShort('2026-09-02'), toPersianDigits('1405/06/11'));
check('formatShort en', formatShort('2026-09-02', { locale: 'en' }), '1405/06/11');
check(
  'formatMonthYear fa',
  formatMonthYear('2026-09-02'),
  `${'شهریور'} ${toPersianDigits(1405)}`,
);

console.log('\nParsing');
check('1405/06/11', parseJalaliInput('1405/06/11'), '2026-09-02');
check('1405-6-11 (loose)', parseJalaliInput('1405-6-11'), '2026-09-02');
check('Persian digits', parseJalaliInput(toPersianDigits('1405/06/11')), '2026-09-02');
check('reject 1405/12/30 (not leap)', parseJalaliInput('1405/12/30'), null);
check('accept 1403/12/30 (leap)', parseJalaliInput('1403/12/30'), '2025-03-20');
check('reject garbage', parseJalaliInput('hello'), null);
check('reject month 13', parseJalaliInput('1405/13/01'), null);

console.log('\nWorking week: Saturday-Wednesday, Thursday and Friday off');
// 2026-09-02 is a Wednesday, so this window covers a full Persian week.
check('Wed 2026-09-02 is a working day', isWeekend('2026-09-02'), false);
check('Thu 2026-09-03 is weekend', isWeekend('2026-09-03'), true);
check('Fri 2026-09-04 is weekend', isWeekend('2026-09-04'), true);
check('Sat 2026-09-05 is a working day', isWeekend('2026-09-05'), false);
check('nextWorkingDay(Thu) -> Sat', nextWorkingDay('2026-09-03'), '2026-09-05');
check('nextWorkingDay(Fri) -> Sat', nextWorkingDay('2026-09-04'), '2026-09-05');
check('nextWorkingDay(Sat) is itself', nextWorkingDay('2026-09-05'), '2026-09-05');
check('one full week has 5 working days', workingDaysBetween('2026-09-05', '2026-09-11'), 5);
check('Sat..Wed inclusive', workingDaysBetween('2026-09-05', '2026-09-09'), 5);
check('Sat..Fri spans one weekend', workingDaysBetween('2026-09-05', '2026-09-11'), 5);
check('two full weeks', workingDaysBetween('2026-09-05', '2026-09-18'), 10);
check('Thu..Fri alone is zero', workingDaysBetween('2026-09-03', '2026-09-04'), 0);
check('single working day', workingDaysBetween('2026-09-05', '2026-09-05'), 1);
check('end before start is zero', workingDaysBetween('2026-09-10', '2026-09-05'), 0);
check('durationDays excludes weekend', durationDays('2026-09-02', '2026-09-05'), 2);
check('addWorkingDays skips the weekend', addWorkingDays('2026-09-02', 1), '2026-09-05');
check('addWorkingDays 5 from Sat', addWorkingDays('2026-09-05', 5), '2026-09-12');

console.log('\nDay arithmetic and week boundaries');
check('addDays +30', addDays('2026-09-02', 30), '2026-10-02');
check('addDays -1 across Nowruz', addDays('2025-03-21', -1), '2025-03-20');
check('diffDays', diffDays('2026-09-02', '2026-10-02'), 30);
check('durationDays same day is 1', durationDays('2026-09-02', '2026-09-02'), 1);
check('weekday of 2026-09-02 (Wed)', jalaliWeekday('2026-09-02'), 4);
check('startOfWeek -> Saturday', startOfJalaliWeek('2026-09-02'), '2026-08-29');
check('startOfWeek(Sat) is itself', startOfJalaliWeek('2026-08-29'), '2026-08-29');
check('startOfJalaliMonth', startOfJalaliMonth('2026-09-02'), '2026-08-23');
check('startOfJalaliYear', startOfJalaliYear('2026-09-02'), '2026-03-21');

console.log('\nRound-trip over 20000 consecutive days from 1990');
let iso = '1990-01-01';
let roundTripFailures = 0;
let firstBad: string | null = null;
for (let i = 0; i < 20000; i += 1) {
  const j = toJalali(iso);
  const back = toIso(j.jy, j.jm, j.jd);
  if (back !== iso) {
    roundTripFailures += 1;
    firstBad ??= `${iso} -> ${JSON.stringify(j)} -> ${back}`;
  }
  iso = addDays(iso, 1);
}
check(`round-trip (through ${iso})`, roundTripFailures, 0);
if (firstBad) console.log(`       first mismatch: ${firstBad}`);

console.log('\nMonotonicity: each day advances the Jalali date by exactly one');
let previous = toJalali('2000-01-01');
let cursor = '2000-01-02';
let monotonic = true;
for (let i = 0; i < 15000; i += 1) {
  const current = toJalali(cursor);
  const sameMonth =
    current.jy === previous.jy && current.jm === previous.jm && current.jd === previous.jd + 1;
  const nextMonth =
    current.jy === previous.jy &&
    current.jm === previous.jm + 1 &&
    current.jd === 1 &&
    previous.jd === jalaliMonthLength(previous.jy, previous.jm);
  const nextYear =
    current.jy === previous.jy + 1 &&
    current.jm === 1 &&
    current.jd === 1 &&
    previous.jm === 12 &&
    previous.jd === jalaliMonthLength(previous.jy, 12);

  if (!sameMonth && !nextMonth && !nextYear) {
    monotonic = false;
    console.log(
      `       break at ${cursor}: ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`,
    );
    break;
  }
  previous = current;
  cursor = addDays(cursor, 1);
}
check('monotonic over 15000 days', monotonic, true);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
