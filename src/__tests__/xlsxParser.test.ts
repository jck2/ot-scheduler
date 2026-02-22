import { describe, it, expect } from 'vitest';
import { extractInCellTime } from '@/parsing/xlsxParser';

describe('extractInCellTime', () => {
  it('extracts "5th Group 2 8:15-9" → start=495, end=540, cleaned="5th Group 2"', () => {
    const result = extractInCellTime('5th Group 2 8:15-9');
    expect(result).not.toBeNull();
    expect(result!.start).toBe(495);
    expect(result!.end).toBe(540);
    expect(result!.cleanedText).toBe('5th Group 2');
  });

  it('PM inference: "Reading 2:15-3" → start=855, end=900', () => {
    const result = extractInCellTime('Reading 2:15-3');
    expect(result).not.toBeNull();
    expect(result!.start).toBe(855);
    expect(result!.end).toBe(900);
    expect(result!.cleanedText).toBe('Reading');
  });

  it('parenthesized: "Tom (9:00-9:30)" → start=540, end=570', () => {
    const result = extractInCellTime('Tom (9:00-9:30)');
    expect(result).not.toBeNull();
    expect(result!.start).toBe(540);
    expect(result!.end).toBe(570);
    expect(result!.cleanedText).toBe('Tom');
  });

  it('no time: "Tom Smith" → null', () => {
    expect(extractInCellTime('Tom Smith')).toBeNull();
  });

  it('noon crossing: "Group 11:30-12" → start=690, end=720', () => {
    const result = extractInCellTime('Group 11:30-12');
    expect(result).not.toBeNull();
    expect(result!.start).toBe(690);
    expect(result!.end).toBe(720);
  });

  it('handles en-dash: "8:15–9:00"', () => {
    const result = extractInCellTime('8:15–9:00');
    expect(result).not.toBeNull();
    expect(result!.start).toBe(495);
    expect(result!.end).toBe(540);
  });

  it('handles explicit am/pm: "8:15am-9am"', () => {
    const result = extractInCellTime('Session 8:15am-9am');
    expect(result).not.toBeNull();
    expect(result!.start).toBe(495);
    expect(result!.end).toBe(540);
  });

  it('strips all time patterns from cleaned text', () => {
    const result = extractInCellTime('Math 8:15-9 Group');
    expect(result).not.toBeNull();
    expect(result!.cleanedText).toBe('Math Group');
  });
});
