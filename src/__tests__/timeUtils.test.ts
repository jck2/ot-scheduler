import { describe, it, expect } from 'vitest';
import {
  minutesToTime,
  timeToMinutes,
  parseTimeRange,
  parseExcelTime,
  slotsOverlap,
} from '@/utils/timeUtils';

describe('minutesToTime', () => {
  it('converts 510 to 8:30AM', () => {
    expect(minutesToTime(510)).toBe('8:30AM');
  });

  it('converts 780 to 1:00PM', () => {
    expect(minutesToTime(780)).toBe('1:00PM');
  });

  it('converts 930 to 3:30PM', () => {
    expect(minutesToTime(930)).toBe('3:30PM');
  });

  it('converts noon correctly', () => {
    expect(minutesToTime(720)).toBe('12:00PM');
  });
});

describe('timeToMinutes', () => {
  it('parses 8:30AM', () => {
    expect(timeToMinutes('8:30AM')).toBe(510);
  });

  it('parses 1:00PM', () => {
    expect(timeToMinutes('1:00PM')).toBe(780);
  });

  it('parses 9:00 (no AM/PM)', () => {
    expect(timeToMinutes('9:00')).toBe(540);
  });

  it('parses 8:30 with space before AM', () => {
    expect(timeToMinutes('8:30 AM')).toBe(510);
  });
});

describe('parseTimeRange', () => {
  it('parses "8:30-9:00"', () => {
    expect(parseTimeRange('8:30-9:00')).toEqual({ start: 510, end: 540 });
  });

  it('parses "8:30AM-9AM"', () => {
    expect(parseTimeRange('8:30AM-9AM')).toEqual({ start: 510, end: 540 });
  });

  it('returns null for invalid input', () => {
    expect(parseTimeRange('LUNCH')).toBeNull();
  });
});

describe('parseExcelTime', () => {
  it('converts 0.354166... to ~510 (8:30 AM)', () => {
    const result = parseExcelTime(0.354166667);
    expect(result).toBeCloseTo(510, 0);
  });
});

describe('slotsOverlap', () => {
  it('detects overlap', () => {
    expect(slotsOverlap(510, 540, 520, 550)).toBe(true);
  });

  it('detects non-overlap', () => {
    expect(slotsOverlap(510, 540, 540, 570)).toBe(false);
  });

  it('handles contained slot', () => {
    expect(slotsOverlap(500, 600, 520, 550)).toBe(true);
  });
});
