import { describe, it, expect } from 'vitest';
import { parseMandate, decomposeMandates } from '@/parsing/mandateParser';

describe('parseMandate', () => {
  it('parses simple individual mandate: 2x30:1', () => {
    const result = parseMandate('2x30:1');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      frequency: 2,
      duration: 30,
      groupSize: 1,
      groupFlexible: false,
    });
  });

  it('parses comma-separated mandates: 1x30:1, 1x30:2', () => {
    const result = parseMandate('1x30:1, 1x30:2');
    expect(result).toHaveLength(2);
    expect(result[0].groupSize).toBe(1);
    expect(result[1].groupSize).toBe(2);
  });

  it('parses group-flexible mandate: 2x30:group', () => {
    const result = parseMandate('2x30:group');
    expect(result).toHaveLength(1);
    expect(result[0].groupSize).toBe(Infinity);
    expect(result[0].groupFlexible).toBe(true);
  });

  it('defaults missing group size to individual: 1x30', () => {
    const result = parseMandate('1x30, 1x30:2');
    expect(result).toHaveLength(2);
    expect(result[0].groupSize).toBe(1);
    expect(result[1].groupSize).toBe(2);
  });

  it('parses mixed mandates: 1x30:1, 1x30:group', () => {
    const result = parseMandate('1x30:1,1x30:group');
    expect(result).toHaveLength(2);
    expect(result[0].groupSize).toBe(1);
    expect(result[0].groupFlexible).toBe(false);
    expect(result[1].groupSize).toBe(Infinity);
    expect(result[1].groupFlexible).toBe(true);
  });

  it('parses trio mandate: 2x30:3', () => {
    const result = parseMandate('2x30:3');
    expect(result).toHaveLength(1);
    expect(result[0].groupSize).toBe(3);
    expect(result[0].groupFlexible).toBe(false);
  });

  it('handles empty/null input', () => {
    expect(parseMandate('')).toHaveLength(0);
    expect(parseMandate('  ')).toHaveLength(0);
  });

  it('handles real roster mandates', () => {
    // Aqeela: 2x30:1
    expect(parseMandate('2x30:1')).toEqual([
      { frequency: 2, duration: 30, groupSize: 1, groupFlexible: false },
    ]);
    // Arahli: "1x30:1, 1x30:2"
    expect(parseMandate('1x30:1, 1x30:2')).toEqual([
      { frequency: 1, duration: 30, groupSize: 1, groupFlexible: false },
      { frequency: 1, duration: 30, groupSize: 2, groupFlexible: false },
    ]);
    // Luna: "2x30:1, 1x30:2"
    expect(parseMandate('2x30:1, 1x30:2')).toEqual([
      { frequency: 2, duration: 30, groupSize: 1, groupFlexible: false },
      { frequency: 1, duration: 30, groupSize: 2, groupFlexible: false },
    ]);
    // Stella: "1x30:1,1x30:group"
    expect(parseMandate('1x30:1,1x30:group')).toEqual([
      { frequency: 1, duration: 30, groupSize: 1, groupFlexible: false },
      { frequency: 1, duration: 30, groupSize: Infinity, groupFlexible: true },
    ]);
    // Fisher (edge case): 3x30:2
    expect(parseMandate('3x30:2')).toEqual([
      { frequency: 3, duration: 30, groupSize: 2, groupFlexible: false },
    ]);
  });
});

describe('decomposeMandates', () => {
  it('decomposes frequency into separate requests', () => {
    const mandates = parseMandate('2x30:1');
    const requests = decomposeMandates('stu-1', mandates);
    expect(requests).toHaveLength(2);
    expect(requests[0].type).toBe('individual');
    expect(requests[1].type).toBe('individual');
  });

  it('decomposes mixed mandates', () => {
    const mandates = parseMandate('1x30:1, 1x30:2');
    const requests = decomposeMandates('stu-1', mandates);
    expect(requests).toHaveLength(2);
    expect(requests[0].type).toBe('individual');
    expect(requests[1].type).toBe('pair');
  });
});
