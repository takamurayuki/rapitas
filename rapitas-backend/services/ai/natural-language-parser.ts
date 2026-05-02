/**
 * Natural Language Task Parser
 * Parses natural language input (Japanese/English) into structured task fields.
 * Uses regex-based pattern matching for date/time, priority, and duration extraction.
 */

interface ParsedTask {
  title: string;
  dueDate?: string; // ISO string
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  estimatedHours?: number;
}

/** Result of extracting a field from text */
interface ExtractionResult<T> {
  value: T | undefined;
  remainingText: string;
}

/** Priority patterns for Japanese and English */
const PRIORITY_PATTERNS: { pattern: RegExp; value: ParsedTask['priority'] }[] = [
  { pattern: /(?:^|\s)(緊急|最優先|至急|urgent|asap)(?:\s|$)/i, value: 'urgent' },
  { pattern: /(?:^|\s)(重要|高優先|important|high\s*priority)(?:\s|$)/i, value: 'high' },
  { pattern: /(?:^|\s)(低優先|low\s*priority)(?:\s|$)/i, value: 'low' },
];

/** Duration patterns for Japanese and English */
const HOURS_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*(?:時間|hours?|hrs?|h)\s*(?:かかる|見込み|予定)?/i,
  /(?:約|およそ|about\s*)(\d+(?:\.\d+)?)\s*(?:時間|hours?|hrs?|h)/i,
  /(\d+(?:\.\d+)?)\s*(?:分|minutes?|mins?|min)\s*(?:かかる|見込み|予定)?/i,
];

/** Japanese weekday mapping */
const JP_WEEKDAYS: Record<string, number> = {
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6,
};

/** English weekday mapping */
const EN_WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/**
 * Extract priority keywords from text.
 * @param text - Input text to search
 * @returns Extracted priority and remaining text
 */
function extractPriority(text: string): ExtractionResult<ParsedTask['priority']> {
  for (const { pattern, value } of PRIORITY_PATTERNS) {
    if (pattern.test(text)) {
      return {
        value,
        remainingText: text.replace(pattern, ' ').trim(),
      };
    }
  }
  return { value: undefined, remainingText: text };
}

/**
 * Extract estimated hours/minutes from text.
 * @param text - Input text to search
 * @returns Extracted hours (converted from minutes if needed) and remaining text
 */
function extractEstimatedHours(text: string): ExtractionResult<number> {
  for (const pattern of HOURS_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const num = parseFloat(match[1]);
      const isMinutes = /分|minutes?|mins?|min/i.test(match[0]);
      const hours = isMinutes ? Math.round((num / 60) * 10) / 10 : num;
      return {
        value: hours,
        remainingText: text.replace(match[0], ' ').trim(),
      };
    }
  }
  return { value: undefined, remainingText: text };
}

/**
 * Get the next occurrence of a weekday.
 * @param now - Reference date
 * @param targetDay - Day of week (0=Sunday, 6=Saturday)
 * @param weeksAhead - Number of weeks to add (0=this week, 1=next week)
 */
function getNextWeekday(now: Date, targetDay: number, weeksAhead = 0): Date {
  const d = new Date(now);
  const currentDay = d.getDay();
  let daysUntil = targetDay - currentDay;
  if (daysUntil <= 0) daysUntil += 7;
  d.setDate(d.getDate() + daysUntil + weeksAhead * 7);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Time extraction result */
interface TimeExtractionResult {
  hours: number;
  minutes: number;
  remaining: string;
}

/**
 * Extract time from text in various formats.
 * Supports: "15:30", "3時半", "午後3時", "3pm", etc.
 * @param text - Input text
 * @returns Extracted time or null if not found
 */
function extractTime(text: string): TimeExtractionResult | null {
  // "15:30", "3:00"
  let m = text.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    return {
      hours: parseInt(m[1]),
      minutes: parseInt(m[2]),
      remaining: text.replace(m[0], ' ').trim(),
    };
  }

  // Japanese time formats: "午後3時30分", "午前10時", "3時半"
  m = text.match(/(午前|午後|AM|PM)?\s*(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分|半)?/i);
  if (m) {
    let h = parseInt(m[2]);
    const min = m[3] ? parseInt(m[3]) : m[0].includes('半') ? 30 : 0;
    if (m[1] === '午後' || (m[1] && /pm/i.test(m[1]))) {
      if (h < 12) h += 12;
    } else if (m[1] === '午前' || (m[1] && /am/i.test(m[1]))) {
      if (h === 12) h = 0;
    } else if (h <= 6) {
      // Ambiguous: assume PM for small numbers (e.g., "3" → 15:00)
      h += 12;
    }
    return { hours: h, minutes: min, remaining: text.replace(m[0], ' ').trim() };
  }

  // "3pm", "10am"
  m = text.match(/(\d{1,2})\s*(am|pm)/i);
  if (m) {
    let h = parseInt(m[1]);
    if (/pm/i.test(m[2]) && h < 12) h += 12;
    if (/am/i.test(m[2]) && h === 12) h = 0;
    return { hours: h, minutes: 0, remaining: text.replace(m[0], ' ').trim() };
  }

  return null;
}

/** Date patterns with their extraction logic */
interface DatePattern {
  pattern: RegExp;
  extract: (match: RegExpMatchArray, now: Date) => Date;
}

/**
 * Create date patterns for relative and absolute dates.
 * @param now - Reference date for relative calculations
 */
function createDatePatterns(now: Date): DatePattern[] {
  return [
    // Today: 今日, 本日, today
    {
      pattern: /(?:^|\s)(今日中|今日|本日|today)(?:\s|に|まで|$)/i,
      extract: () => {
        const d = new Date(now);
        d.setHours(23, 59, 0, 0);
        return d;
      },
    },
    // Tomorrow: 明日, tomorrow
    {
      pattern: /(?:^|\s)(明日|あした|tomorrow)(?:\s|に|まで|$)/i,
      extract: () => {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(23, 59, 0, 0);
        return d;
      },
    },
    // Day after tomorrow: 明後日
    {
      pattern: /(?:^|\s)(明後日|あさって)(?:\s|に|まで|$)/i,
      extract: () => {
        const d = new Date(now);
        d.setDate(d.getDate() + 2);
        d.setHours(23, 59, 0, 0);
        return d;
      },
    },
    // Next week weekday (Japanese): 来週月曜
    {
      pattern: /(?:^|\s)来週\s*([日月火水木金土])曜?(?:日)?(?:\s|に|まで|$)/,
      extract: (match) => {
        const day = JP_WEEKDAYS[match[1]];
        return day !== undefined ? getNextWeekday(now, day, 1) : new Date(now);
      },
    },
    // Next week weekday (English): next Monday
    {
      pattern:
        /(?:^|\s)next\s+(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)(?:\s|$)/i,
      extract: (match) => {
        const day = EN_WEEKDAYS[match[1].toLowerCase()];
        return day !== undefined ? getNextWeekday(now, day, 1) : new Date(now);
      },
    },
    // This week weekday (Japanese): 金曜日
    {
      pattern: /(?:^|\s)([日月火水木金土])曜(?:日)?/,
      extract: (match) => {
        const day = JP_WEEKDAYS[match[1]];
        return day !== undefined ? getNextWeekday(now, day) : new Date(now);
      },
    },
    // This week weekday (English): Friday
    {
      pattern:
        /(?:^|\s)(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)(?:\s|$)/i,
      extract: (match) => {
        const day = EN_WEEKDAYS[match[1].toLowerCase()];
        return day !== undefined ? getNextWeekday(now, day) : new Date(now);
      },
    },
    // N days later (Japanese): 3日後
    {
      pattern: /(?:^|\s)(\d+)\s*日後(?:\s|に|まで|$)/,
      extract: (match) => {
        const d = new Date(now);
        d.setDate(d.getDate() + parseInt(match[1]));
        d.setHours(23, 59, 0, 0);
        return d;
      },
    },
    // In N days (English): in 3 days
    {
      pattern: /(?:^|\s)in\s+(\d+)\s+days?(?:\s|$)/i,
      extract: (match) => {
        const d = new Date(now);
        d.setDate(d.getDate() + parseInt(match[1]));
        d.setHours(23, 59, 0, 0);
        return d;
      },
    },
    // Japanese date: 3月15日
    {
      pattern: /(?:^|\s)(\d{1,2})月(\d{1,2})日(?:\s|に|まで|$)/,
      extract: (match) => {
        const d = new Date(
          now.getFullYear(),
          parseInt(match[1]) - 1,
          parseInt(match[2]),
          23,
          59,
          0,
        );
        if (d < now) d.setFullYear(d.getFullYear() + 1);
        return d;
      },
    },
    // Numeric date: 3/15
    {
      pattern: /(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/,
      extract: (match) => {
        const d = new Date(
          now.getFullYear(),
          parseInt(match[1]) - 1,
          parseInt(match[2]),
          23,
          59,
          0,
        );
        if (d < now) d.setFullYear(d.getFullYear() + 1);
        return d;
      },
    },
  ];
}

/**
 * Extract date from text using various patterns.
 * @param text - Input text
 * @param now - Reference date
 * @returns Extracted date and remaining text
 */
function extractDate(text: string, now: Date): ExtractionResult<Date> {
  const patterns = createDatePatterns(now);

  for (const { pattern, extract } of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        value: extract(match, now),
        remainingText: text.replace(match[0], ' ').trim(),
      };
    }
  }

  return { value: undefined, remainingText: text };
}

/**
 * Apply time to date, or create date from time if no date provided.
 * @param date - Optional date to apply time to
 * @param time - Extracted time
 * @param now - Reference date
 * @returns Date with time applied
 */
function applyTimeToDate(date: Date | undefined, time: TimeExtractionResult, now: Date): Date {
  if (date) {
    date.setHours(time.hours, time.minutes, 0, 0);
    return date;
  }
  // Time without date: assume today if future, tomorrow if past
  const d = new Date(now);
  d.setHours(time.hours, time.minutes, 0, 0);
  if (d <= now) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Clean up extracted title by removing leftover particles.
 * @param text - Text after extraction
 * @param originalInput - Original input (fallback if text is empty)
 * @returns Cleaned title
 */
function cleanupTitle(text: string, originalInput: string): string {
  let cleaned = text;

  // Multiple passes to handle chained particles
  for (let i = 0; i < 3; i++) {
    cleaned = cleaned
      .replace(/\s*(までに|まで|に|から|の|を|で|は)\s*$/g, '')
      .replace(/^\s*(までに|まで|に|から|の|を|で|は)\s*/g, '')
      .replace(/\s+by\s*$/i, '')
      .replace(/^\s*by\s+/i, '')
      .trim();
  }

  cleaned = cleaned
    .replace(/\s+by\s+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // If title is empty after extraction, use original input
  return cleaned || originalInput.trim();
}

/**
 * Format date to local ISO string for datetime-local input.
 * @param date - Date to format
 * @returns ISO-like string in local timezone
 */
function formatDateToLocalIso(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Parse natural language text into structured task data.
 * @example
 * parseNaturalLanguageTask("金曜3時にレポート提出")
 * // → { title: "レポート提出", dueDate: "2026-03-13T15:00:00" }
 * @example
 * parseNaturalLanguageTask("明日までにプレゼン資料作成 重要")
 * // → { title: "プレゼン資料作成", dueDate: "...", priority: "high" }
 * @example
 * parseNaturalLanguageTask("来週月曜 10:00 会議の準備 2時間")
 * // → { title: "会議の準備", dueDate: "...", estimatedHours: 2 }
 */
export function parseNaturalLanguageTask(input: string): ParsedTask {
  const now = new Date();
  let text = input.trim();

  // Extract priority
  const priorityResult = extractPriority(text);
  const priority = priorityResult.value;
  text = priorityResult.remainingText;

  // Extract estimated hours
  const hoursResult = extractEstimatedHours(text);
  const estimatedHours = hoursResult.value;
  text = hoursResult.remainingText;

  // Extract date
  const dateResult = extractDate(text, now);
  let dueDate = dateResult.value;
  text = dateResult.remainingText;

  // Extract and apply time
  const timeResult = extractTime(text);
  if (timeResult) {
    dueDate = applyTimeToDate(dueDate, timeResult, now);
    text = timeResult.remaining;
  }

  // Clean up title
  const title = cleanupTitle(text, input);

  // Build result
  const result: ParsedTask = { title };
  if (dueDate) result.dueDate = formatDateToLocalIso(dueDate);
  if (priority) result.priority = priority;
  if (estimatedHours) result.estimatedHours = estimatedHours;

  return result;
}
