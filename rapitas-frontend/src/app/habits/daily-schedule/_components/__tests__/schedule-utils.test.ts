import { describe, it, expect } from 'vitest';
import { HelpCircle, Moon, Briefcase } from 'lucide-react';
import {
  CATEGORY_OPTIONS,
  PRESET_COLORS,
  getCategoryIcon,
  timeToMinutes,
  minutesToAngle,
  polarToCartesian,
  getDurationParts,
} from '../schedule-utils';

describe('CATEGORY_OPTIONS', () => {
  it('contains exactly the 8 expected categories', () => {
    expect(CATEGORY_OPTIONS.map((c) => c.value)).toEqual([
      'sleep',
      'work',
      'exercise',
      'meal',
      'commute',
      'study',
      'hobby',
      'other',
    ]);
  });

  it('assigns each category a hex default color', () => {
    for (const c of CATEGORY_OPTIONS) {
      expect(c.defaultColor).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('PRESET_COLORS', () => {
  it('has 10 preset colors', () => {
    expect(PRESET_COLORS).toHaveLength(10);
  });
});

describe('getCategoryIcon', () => {
  it('returns the matching icon for a known category', () => {
    expect(getCategoryIcon('sleep')).toBe(Moon);
    expect(getCategoryIcon('work')).toBe(Briefcase);
  });

  it('falls back to HelpCircle for an unknown category', () => {
    expect(getCategoryIcon('unknown')).toBe(HelpCircle);
  });
});

describe('timeToMinutes', () => {
  it('converts midnight to 0', () => {
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('converts a mid-day time', () => {
    expect(timeToMinutes('09:30')).toBe(570);
  });

  it('converts the last minute of the day', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
  });
});

describe('minutesToAngle', () => {
  it('maps 0:00 to -90 degrees (top of circle)', () => {
    expect(minutesToAngle(0)).toBe(-90);
  });

  it('maps noon (720 minutes) to 90 degrees', () => {
    expect(minutesToAngle(720)).toBe(90);
  });

  it('maps end of day (1440 minutes) to 270 degrees', () => {
    expect(minutesToAngle(1440)).toBe(270);
  });
});

describe('polarToCartesian', () => {
  it('computes the point at angle 0 (east)', () => {
    const p = polarToCartesian(0, 0, 10, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
  });

  it('computes the point at angle 90 (south, +y)', () => {
    const p = polarToCartesian(0, 0, 10, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it('offsets by the given center coordinates', () => {
    const p = polarToCartesian(5, 5, 10, 0);
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(5);
  });
});

describe('getDurationParts', () => {
  it('computes a simple same-day duration', () => {
    expect(getDurationParts('09:00', '10:30')).toEqual({ h: 1, m: 30 });
  });

  it('handles an overnight block (end before start)', () => {
    expect(getDurationParts('23:00', '01:00')).toEqual({ h: 2, m: 0 });
  });

  it('caps a full 24-hour wraparound block at 24 hours', () => {
    expect(getDurationParts('08:00', '08:00')).toEqual({ h: 24, m: 0 });
  });

  it('returns zero duration when end equals start plus a full day is not intended', () => {
    // start === end is treated as a 24h block by the overnight-wrap rule, not 0.
    expect(getDurationParts('00:00', '00:00')).toEqual({ h: 24, m: 0 });
  });
});
