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

/**
 * Parse natural language text into structured task data.
 * Examples:
 *   "金曜3時にレポート提出" → { title: "レポート提出", dueDate: "2026-03-13T15:00:00" }
 *   "明日までにプレゼン資料作成 重要" → { title: "プレゼン資料作成", dueDate: "...", priority: "high" }
 *   "来週月曜 10:00 会議の準備 2時間" → { title: "会議の準備", dueDate: "...", estimatedHours: 2 }
 */
export function parseNaturalLanguageTask(input: string): ParsedTask {
  let text = input.trim();
  let dueDate: Date | undefined;
  let priority: ParsedTask['priority'] | undefined;
  let estimatedHours: number | undefined;

  // --- Priority extraction ---
  const priorityPatterns: { pattern: RegExp; value: ParsedTask['priority'] }[] = [
    { pattern: /(?:^|\s)(緊急|最優先|至急|urgent|asap)(?:\s|$)/i, value: 'urgent' },
    { pattern: /(?:^|\s)(重要|高優先|important|high\s*priority)(?:\s|$)/i, value: 'high' },
    { pattern: /(?:^|\s)(低優先|low\s*priority)(?:\s|$)/i, value: 'low' },
  ];

  for (const { pattern, value } of priorityPatterns) {
    if (pattern.test(text)) {
      priority = value;
      text = text.replace(pattern, ' ').trim();
      break;
    }
  }

  // --- Estimated hours extraction ---
  const hoursPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:時間|hours?|hrs?|h)\s*(?:かかる|見込み|予定)?/i,
    /(?:約|およそ|about\s*)(\d+(?:\.\d+)?)\s*(?:時間|hours?|hrs?|h)/i,
    /(\d+(?:\.\d+)?)\s*(?:分|minutes?|mins?|min)\s*(?:かかる|見込み|予定)?/i,
  ];

  for (const pattern of hoursPatterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseFloat(match[1]);
      // If matched "/minutes", convert to hours
      if (/分|minutes?|mins?|min/i.test(match[0])) {
        estimatedHours = Math.round((num / 60) * 10) / 10;
      } else {
        estimatedHours = num;
      }
      text = text.replace(match[0], ' ').trim();
      break;
    }
  }

  // --- Date/time extraction ---
  const now = new Date();

  // Helper: get next weekday
  const getNextWeekday = (targetDay: number, weeksAhead = 0): Date => {
    const d = new Date(now);
    const currentDay = d.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    d.setDate(d.getDate() + daysUntil + weeksAhead * 7);
    d.setHours(9, 0, 0, 0);
    return d;
  };

  // Japanese weekday mapping
  const jpWeekdays: Record<string, number> = {
    日: 0,
    月: 1,
    火: 2,
    水: 3,
    木: 4,
    金: 5,
    土: 6,
  };
  const enWeekdays: Record<string, number> = {
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

  // Time extraction helper
  const extractTime = (s: string): { hours: number; minutes: number; remaining: string } | null => {
    // "15:30", "3:00"
    let m = s.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      return {
        hours: parseInt(m[1]),
        minutes: parseInt(m[2]),
        remaining: s.replace(m[0], ' ').trim(),
      };
    }
    // Japanese time formats: "PM 3:30", "AM 10", "3:30 (half)", "15:00"
    m = s.match(/(午前|午後|AM|PM)?\s*(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分|半)?/i);
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
      return { hours: h, minutes: min, remaining: s.replace(m[0], ' ').trim() };
    }
    // "3pm", "10am"
    m = s.match(/(\d{1,2})\s*(am|pm)/i);
    if (m) {
      let h = parseInt(m[1]);
      if (/pm/i.test(m[2]) && h < 12) h += 12;
      if (/am/i.test(m[2]) && h === 12) h = 0;
      return { hours: h, minutes: 0, remaining: s.replace(m[0], ' ').trim() };
    }
    return null;
  };

  // Pattern: "", "", ""
  let dateMatch = text.match(/(?:^|\s)(今日中|今日|本日|today)(?:\s|に|まで|$)/i);
  if (dateMatch) {
    dueDate = new Date(now);
    dueDate.setHours(23, 59, 0, 0);
    text = text.replace(dateMatch[0], ' ').trim();
  }

  // Pattern: "", "tomorrow"
  if (!dueDate) {
    dateMatch = text.match(/(?:^|\s)(明日|あした|tomorrow)(?:\s|に|まで|$)/i);
    if (dateMatch) {
      dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 1);
      dueDate.setHours(23, 59, 0, 0);
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  // Pattern: "", ""
  if (!dueDate) {
    dateMatch = text.match(/(?:^|\s)(明後日|あさって)(?:\s|に|まで|$)/i);
    if (dateMatch) {
      dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 2);
      dueDate.setHours(23, 59, 0, 0);
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  // Pattern: "X", "next Monday"
  if (!dueDate) {
    dateMatch = text.match(/(?:^|\s)来週\s*([日月火水木金土])曜?(?:日)?(?:\s|に|まで|$)/);
    if (dateMatch) {
      const day = jpWeekdays[dateMatch[1]];
      if (day !== undefined) {
        dueDate = getNextWeekday(day, 1);
      }
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  if (!dueDate) {
    dateMatch = text.match(
      /(?:^|\s)next\s+(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)(?:\s|$)/i,
    );
    if (dateMatch) {
      const day = enWeekdays[dateMatch[1].toLowerCase()];
      if (day !== undefined) {
        dueDate = getNextWeekday(day, 1);
      }
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  // Pattern: "X", "Friday" (this week or next)
  if (!dueDate) {
    dateMatch = text.match(/(?:^|\s)([日月火水木金土])曜(?:日)?/);
    if (dateMatch) {
      const day = jpWeekdays[dateMatch[1]];
      if (day !== undefined) {
        dueDate = getNextWeekday(day);
      }
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  if (!dueDate) {
    dateMatch = text.match(
      /(?:^|\s)(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)(?:\s|$)/i,
    );
    if (dateMatch) {
      const day = enWeekdays[dateMatch[1].toLowerCase()];
      if (day !== undefined) {
        dueDate = getNextWeekday(day);
      }
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  // Pattern: "N", "in N days"
  if (!dueDate) {
    dateMatch = text.match(/(?:^|\s)(\d+)\s*日後(?:\s|に|まで|$)/);
    if (dateMatch) {
      dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + parseInt(dateMatch[1]));
      dueDate.setHours(23, 59, 0, 0);
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  if (!dueDate) {
    dateMatch = text.match(/(?:^|\s)in\s+(\d+)\s+days?(?:\s|$)/i);
    if (dateMatch) {
      dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + parseInt(dateMatch[1]));
      dueDate.setHours(23, 59, 0, 0);
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  // Pattern: "MD", "M/D"
  if (!dueDate) {
    dateMatch = text.match(/(?:^|\s)(\d{1,2})月(\d{1,2})日(?:\s|に|まで|$)/);
    if (dateMatch) {
      dueDate = new Date(
        now.getFullYear(),
        parseInt(dateMatch[1]) - 1,
        parseInt(dateMatch[2]),
        23,
        59,
        0,
      );
      if (dueDate < now) {
        dueDate.setFullYear(dueDate.getFullYear() + 1);
      }
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  if (!dueDate) {
    dateMatch = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/);
    if (dateMatch) {
      dueDate = new Date(
        now.getFullYear(),
        parseInt(dateMatch[1]) - 1,
        parseInt(dateMatch[2]),
        23,
        59,
        0,
      );
      if (dueDate < now) {
        dueDate.setFullYear(dueDate.getFullYear() + 1);
      }
      text = text.replace(dateMatch[0], ' ').trim();
    }
  }

  // Extract time and apply to date
  const timeResult = extractTime(text);
  if (timeResult) {
    if (dueDate) {
      dueDate.setHours(timeResult.hours, timeResult.minutes, 0, 0);
    } else {
      // Time without date: assume today if future, tomorrow if past
      dueDate = new Date(now);
      dueDate.setHours(timeResult.hours, timeResult.minutes, 0, 0);
      if (dueDate <= now) {
        dueDate.setDate(dueDate.getDate() + 1);
      }
    }
    text = timeResult.remaining;
  }

  // --- Clean up title ---
  // Remove particles and connectors that were part of date/time expressions
  // Apply multiple passes to handle chained particles
  for (let i = 0; i < 3; i++) {
    text = text
      .replace(/\s*(までに|まで|に|から|の|を|で|は)\s*$/g, '')
      .replace(/^\s*(までに|まで|に|から|の|を|で|は)\s*/g, '')
      .replace(/\s+by\s*$/i, '')
      .replace(/^\s*by\s+/i, '')
      .trim();
  }
  text = text
    .replace(/\s+by\s+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // If title is empty after extraction, use original input
  const title = text || input.trim();

  const result: ParsedTask = { title };

  if (dueDate) {
    // Format as local ISO string for datetime-local input
    const pad = (n: number) => n.toString().padStart(2, '0');
    result.dueDate = `${dueDate.getFullYear()}-${pad(dueDate.getMonth() + 1)}-${pad(dueDate.getDate())}T${pad(dueDate.getHours())}:${pad(dueDate.getMinutes())}`;
  }
  if (priority) result.priority = priority;
  if (estimatedHours) result.estimatedHours = estimatedHours;

  return result;
}
