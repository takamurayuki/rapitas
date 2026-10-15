/**
 * Utility to calculate Japanese national holidays (based on the National Holidays Act)
 *
 * NOTE: holiday names are returned as `labelKey`s (not display text) — callers
 * resolve the localized name via `useTranslations('calendar.holidays')` so the
 * calendar UI stays translated. See `HolidayLabelKey` for the full key set.
 */

/** Message keys under `calendar.holidays` naming each Japanese national holiday. */
export type HolidayLabelKey =
  | 'newYearsDay'
  | 'comingOfAgeDay'
  | 'nationalFoundationDay'
  | 'emperorsBirthday'
  | 'vernalEquinoxDay'
  | 'showaDay'
  | 'greeneryDay'
  | 'constitutionDay'
  | 'childrensDay'
  | 'marineDay'
  | 'mountainDay'
  | 'respectForTheAgedDay'
  | 'autumnalEquinoxDay'
  | 'sportsDay'
  | 'healthAndSportsDay'
  | 'cultureDay'
  | 'laborThanksgivingDay'
  | 'substituteHoliday'
  | 'citizensHoliday';

export type Holiday = {
  date: string; // YYYY-MM-DD
  labelKey: HolidayLabelKey;
};

/** Return the date of the nth Monday of the specified month */
function getNthMonday(year: number, month: number, n: number): number {
  const first = new Date(year, month, 1);
  const firstDay = first.getDay();
  // First Monday
  const firstMonday = firstDay <= 1 ? 2 - firstDay : 9 - firstDay;
  return firstMonday + (n - 1) * 7;
}

/** Calculate vernal equinox day (supports 1900-2099) */
function getVernalEquinoxDay(year: number): number {
  if (year <= 1947) return 0;
  if (year <= 1979)
    return Math.floor(20.8357 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
  if (year <= 2099)
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return 21;
}

/** Calculate autumnal equinox day (supports 1900-2099) */
function getAutumnalEquinoxDay(year: number): number {
  if (year <= 1947) return 0;
  if (year <= 1979)
    return Math.floor(23.2588 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
  if (year <= 2099)
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return 23;
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Return list of holidays for the specified year */
export function getHolidaysForYear(year: number): Holiday[] {
  if (year < 1948) return [];

  const holidays: Holiday[] = [];

  // January: New Year's Day (1/1)
  holidays.push({ date: formatDate(year, 0, 1), labelKey: 'newYearsDay' });

  // January: Coming of Age Day (1/15 -> 2nd Monday from 2000)
  if (year >= 2000) {
    holidays.push({
      date: formatDate(year, 0, getNthMonday(year, 0, 2)),
      labelKey: 'comingOfAgeDay',
    });
  } else {
    holidays.push({ date: formatDate(year, 0, 15), labelKey: 'comingOfAgeDay' });
  }

  // February: National Foundation Day (2/11, from 1967)
  if (year >= 1967) {
    holidays.push({ date: formatDate(year, 1, 11), labelKey: 'nationalFoundationDay' });
  }

  // February: Emperor's Birthday (2/23, from 2020)
  if (year >= 2020) {
    holidays.push({ date: formatDate(year, 1, 23), labelKey: 'emperorsBirthday' });
  }

  // March: Vernal Equinox Day
  const vernalDay = getVernalEquinoxDay(year);
  if (vernalDay > 0) {
    holidays.push({ date: formatDate(year, 2, vernalDay), labelKey: 'vernalEquinoxDay' });
  }

  // April: Showa Day (4/29)
  if (year >= 2007) {
    holidays.push({ date: formatDate(year, 3, 29), labelKey: 'showaDay' });
  } else if (year >= 1989) {
    holidays.push({ date: formatDate(year, 3, 29), labelKey: 'greeneryDay' });
  } else {
    holidays.push({ date: formatDate(year, 3, 29), labelKey: 'emperorsBirthday' });
  }

  // May: Constitution Day (5/3)
  holidays.push({ date: formatDate(year, 4, 3), labelKey: 'constitutionDay' });

  // May: Greenery Day (5/4, from 2007)
  if (year >= 2007) {
    holidays.push({ date: formatDate(year, 4, 4), labelKey: 'greeneryDay' });
  }

  // May: Children's Day (5/5)
  holidays.push({ date: formatDate(year, 4, 5), labelKey: 'childrensDay' });

  // July: Marine Day (3rd Monday from 2003 / 7/20 for 1996-2002)
  if (year >= 2003) {
    // NOTE: 2020-2021 have Tokyo Olympics special exceptions
    if (year === 2020) {
      holidays.push({ date: formatDate(year, 6, 23), labelKey: 'marineDay' });
    } else if (year === 2021) {
      holidays.push({ date: formatDate(year, 6, 22), labelKey: 'marineDay' });
    } else {
      holidays.push({
        date: formatDate(year, 6, getNthMonday(year, 6, 3)),
        labelKey: 'marineDay',
      });
    }
  } else if (year >= 1996) {
    holidays.push({ date: formatDate(year, 6, 20), labelKey: 'marineDay' });
  }

  // August: Mountain Day (8/11, from 2016)
  if (year >= 2016) {
    if (year === 2020) {
      holidays.push({ date: formatDate(year, 7, 10), labelKey: 'mountainDay' });
    } else if (year === 2021) {
      holidays.push({ date: formatDate(year, 7, 8), labelKey: 'mountainDay' });
    } else {
      holidays.push({ date: formatDate(year, 7, 11), labelKey: 'mountainDay' });
    }
  }

  // September: Respect for the Aged Day (3rd Monday from 2003 / 9/15 for 1966-2002)
  if (year >= 2003) {
    holidays.push({
      date: formatDate(year, 8, getNthMonday(year, 8, 3)),
      labelKey: 'respectForTheAgedDay',
    });
  } else if (year >= 1966) {
    holidays.push({ date: formatDate(year, 8, 15), labelKey: 'respectForTheAgedDay' });
  }

  // September: Autumnal Equinox Day
  const autumnDay = getAutumnalEquinoxDay(year);
  if (autumnDay > 0) {
    holidays.push({ date: formatDate(year, 8, autumnDay), labelKey: 'autumnalEquinoxDay' });
  }

  // October: Sports Day (2nd Monday from 2000 / 10/10 for 1966-1999)
  if (year >= 2000) {
    if (year === 2020) {
      holidays.push({ date: formatDate(year, 6, 24), labelKey: 'sportsDay' });
    } else if (year === 2021) {
      holidays.push({ date: formatDate(year, 6, 23), labelKey: 'sportsDay' });
    } else {
      holidays.push({
        date: formatDate(year, 9, getNthMonday(year, 9, 2)),
        labelKey: 'sportsDay',
      });
    }
  } else if (year >= 1966) {
    holidays.push({ date: formatDate(year, 9, 10), labelKey: 'healthAndSportsDay' });
  }

  // November: Culture Day (11/3)
  holidays.push({ date: formatDate(year, 10, 3), labelKey: 'cultureDay' });

  // November: Labor Thanksgiving Day (11/23)
  holidays.push({ date: formatDate(year, 10, 23), labelKey: 'laborThanksgivingDay' });

  // December: Emperor's Birthday (12/23, 1989-2018)
  if (year >= 1989 && year <= 2018) {
    holidays.push({ date: formatDate(year, 11, 23), labelKey: 'emperorsBirthday' });
  }

  // Substitute holiday: when a holiday falls on Sunday, the next weekday is a holiday
  const holidayDates = new Set(holidays.map((h) => h.date));
  const substituteHolidays: Holiday[] = [];

  for (const holiday of holidays) {
    const d = new Date(holiday.date + 'T00:00:00');
    if (d.getDay() === 0) {
      // If Sunday, make the next non-holiday day a substitute holiday
      const substitute = new Date(d);
      substitute.setDate(substitute.getDate() + 1);
      while (holidayDates.has(formatDateFromDate(substitute))) {
        substitute.setDate(substitute.getDate() + 1);
      }
      const subDateStr = formatDateFromDate(substitute);
      holidayDates.add(subDateStr);
      substituteHolidays.push({ date: subDateStr, labelKey: 'substituteHoliday' });
    }
  }

  holidays.push(...substituteHolidays);

  // Citizens' Holiday: a weekday sandwiched between two holidays becomes a holiday
  const sortedDates = [...holidayDates].sort();
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const d1 = new Date(sortedDates[i] + 'T00:00:00');
    const d2 = new Date(sortedDates[i + 1] + 'T00:00:00');
    const diff = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 2) {
      const between = new Date(d1);
      between.setDate(between.getDate() + 1);
      const betweenStr = formatDateFromDate(between);
      if (!holidayDates.has(betweenStr) && between.getDay() !== 0) {
        holidays.push({ date: betweenStr, labelKey: 'citizensHoliday' });
      }
    }
  }

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

function formatDateFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Return list of holidays for the specified month */
export function getHolidaysForMonth(year: number, month: number): Holiday[] {
  const yearHolidays = getHolidaysForYear(year);
  const monthStr = String(month + 1).padStart(2, '0');
  const prefix = `${year}-${monthStr}`;
  return yearHolidays.filter((h) => h.date.startsWith(prefix));
}

/** Check if a date is a holiday and return its label key */
export function getHolidayName(dateStr: string): HolidayLabelKey | null {
  const year = parseInt(dateStr.substring(0, 4));
  const holidays = getHolidaysForYear(year);
  const holiday = holidays.find((h) => h.date === dateStr);
  return holiday ? holiday.labelKey : null;
}
