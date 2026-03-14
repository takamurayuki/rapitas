/**
 * Utility to calculate Japanese national holidays (based on the National Holidays Act)
 */

export type Holiday = {
  date: string; // YYYY-MM-DD
  name: string;
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
    return Math.floor(
      20.8357 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4),
    );
  if (year <= 2099)
    return Math.floor(
      20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4),
    );
  return 21;
}

/** Calculate autumnal equinox day (supports 1900-2099) */
function getAutumnalEquinoxDay(year: number): number {
  if (year <= 1947) return 0;
  if (year <= 1979)
    return Math.floor(
      23.2588 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4),
    );
  if (year <= 2099)
    return Math.floor(
      23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4),
    );
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
  holidays.push({ date: formatDate(year, 0, 1), name: '元日' });

  // January: Coming of Age Day (1/15 -> 2nd Monday from 2000)
  if (year >= 2000) {
    holidays.push({
      date: formatDate(year, 0, getNthMonday(year, 0, 2)),
      name: '成人の日',
    });
  } else {
    holidays.push({ date: formatDate(year, 0, 15), name: '成人の日' });
  }

  // February: National Foundation Day (2/11, from 1967)
  if (year >= 1967) {
    holidays.push({ date: formatDate(year, 1, 11), name: '建国記念の日' });
  }

  // February: Emperor's Birthday (2/23, from 2020)
  if (year >= 2020) {
    holidays.push({ date: formatDate(year, 1, 23), name: '天皇誕生日' });
  }

  // March: Vernal Equinox Day
  const vernalDay = getVernalEquinoxDay(year);
  if (vernalDay > 0) {
    holidays.push({ date: formatDate(year, 2, vernalDay), name: '春分の日' });
  }

  // April: Showa Day (4/29)
  if (year >= 2007) {
    holidays.push({ date: formatDate(year, 3, 29), name: '昭和の日' });
  } else if (year >= 1989) {
    holidays.push({ date: formatDate(year, 3, 29), name: 'みどりの日' });
  } else {
    holidays.push({ date: formatDate(year, 3, 29), name: '天皇誕生日' });
  }

  // May: Constitution Day (5/3)
  holidays.push({ date: formatDate(year, 4, 3), name: '憲法記念日' });

  // May: Greenery Day (5/4, from 2007)
  if (year >= 2007) {
    holidays.push({ date: formatDate(year, 4, 4), name: 'みどりの日' });
  }

  // May: Children's Day (5/5)
  holidays.push({ date: formatDate(year, 4, 5), name: 'こどもの日' });

  // July: Marine Day (3rd Monday from 2003 / 7/20 for 1996-2002)
  if (year >= 2003) {
    // NOTE: 2020-2021 have Tokyo Olympics special exceptions
    if (year === 2020) {
      holidays.push({ date: formatDate(year, 6, 23), name: '海の日' });
    } else if (year === 2021) {
      holidays.push({ date: formatDate(year, 6, 22), name: '海の日' });
    } else {
      holidays.push({
        date: formatDate(year, 6, getNthMonday(year, 6, 3)),
        name: '海の日',
      });
    }
  } else if (year >= 1996) {
    holidays.push({ date: formatDate(year, 6, 20), name: '海の日' });
  }

  // August: Mountain Day (8/11, from 2016)
  if (year >= 2016) {
    if (year === 2020) {
      holidays.push({ date: formatDate(year, 7, 10), name: '山の日' });
    } else if (year === 2021) {
      holidays.push({ date: formatDate(year, 7, 8), name: '山の日' });
    } else {
      holidays.push({ date: formatDate(year, 7, 11), name: '山の日' });
    }
  }

  // September: Respect for the Aged Day (3rd Monday from 2003 / 9/15 for 1966-2002)
  if (year >= 2003) {
    holidays.push({
      date: formatDate(year, 8, getNthMonday(year, 8, 3)),
      name: '敬老の日',
    });
  } else if (year >= 1966) {
    holidays.push({ date: formatDate(year, 8, 15), name: '敬老の日' });
  }

  // September: Autumnal Equinox Day
  const autumnDay = getAutumnalEquinoxDay(year);
  if (autumnDay > 0) {
    holidays.push({ date: formatDate(year, 8, autumnDay), name: '秋分の日' });
  }

  // October: Sports Day (2nd Monday from 2000 / 10/10 for 1966-1999)
  if (year >= 2000) {
    if (year === 2020) {
      holidays.push({ date: formatDate(year, 6, 24), name: 'スポーツの日' });
    } else if (year === 2021) {
      holidays.push({ date: formatDate(year, 6, 23), name: 'スポーツの日' });
    } else {
      holidays.push({
        date: formatDate(year, 9, getNthMonday(year, 9, 2)),
        name: 'スポーツの日',
      });
    }
  } else if (year >= 1966) {
    holidays.push({ date: formatDate(year, 9, 10), name: '体育の日' });
  }

  // November: Culture Day (11/3)
  holidays.push({ date: formatDate(year, 10, 3), name: '文化の日' });

  // November: Labor Thanksgiving Day (11/23)
  holidays.push({ date: formatDate(year, 10, 23), name: '勤労感謝の日' });

  // December: Emperor's Birthday (12/23, 1989-2018)
  if (year >= 1989 && year <= 2018) {
    holidays.push({ date: formatDate(year, 11, 23), name: '天皇誕生日' });
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
      substituteHolidays.push({ date: subDateStr, name: '振替休日' });
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
        holidays.push({ date: betweenStr, name: '国民の休日' });
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

/** Check if a date is a holiday and return its name */
export function getHolidayName(dateStr: string): string | null {
  const year = parseInt(dateStr.substring(0, 4));
  const holidays = getHolidaysForYear(year);
  const holiday = holidays.find((h) => h.date === dateStr);
  return holiday ? holiday.name : null;
}
