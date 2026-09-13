import { describe, it, expect } from 'vitest';
import { buildNameIndex, matchExternalName, isNonStudentToken } from '@/parsing/overlayMatcher';
import type { Student } from '@/types';

function s(firstName: string, lastName: string, osisNumber: string): Student {
  return {
    firstName,
    lastName,
    grade: 5,
    className: '',
    osisNumber,
    mandateRaw: '',
    mandateSessions: [],
    provider: 'Amanda Huang',
  };
}

const roster = [
  s('Ariella', 'Colon Hunter', 'a1'),
  s('Roger', 'Rush', 'a2'),
  s('Aqeela', "O'Neil", 'a3'),
  s('Crispin', 'Garland', 'a4'),
  s('Aiden', 'Lacey', 'a5'),
  s('Alexander', 'Smith', 'a6'),
];
const index = buildNameIndex(roster);
const match = (name: string) => matchExternalName(name, index);

describe('overlayMatcher — placeholders never match (Bug 2)', () => {
  it('"ELL" does not match a student whose name contains "ell" (Ariella)', () => {
    expect(match('ELL')).toEqual([]);
  });

  it('"ELA" is treated as a non-student label', () => {
    expect(match('ELA')).toEqual([]);
  });

  it('"C.G" (Community Gathering) does not match Crispin Garland by initials', () => {
    expect(match('C.G')).toEqual([]);
  });

  it('isNonStudentToken flags subject/service labels', () => {
    expect(isNonStudentToken('ELL')).toBe(true);
    expect(isNonStudentToken('C.G')).toBe(true);
    expect(isNonStudentToken('Roger')).toBe(false);
  });
});

describe('overlayMatcher — real students still match', () => {
  it('matches a full name', () => {
    expect(match("Aqeela O'Neil")).toEqual(['a3']);
  });

  it('matches a bare first name', () => {
    expect(match('Roger')).toEqual(['a2']);
  });

  it('matches a real student even with a trailing subject label', () => {
    // "Aiden" is a real student; the "ELA" suffix must not suppress the match.
    expect(match('Aiden ELA')).toEqual(['a5']);
  });

  it('matches a real student with a push-in/pull-out suffix', () => {
    expect(match('Aqeela O-PI')).toEqual(['a3']);
  });

  it('strips a parenthetical class annotation', () => {
    expect(match('Aqeela (Magnolia) push in')).toEqual(['a3']);
  });
});

describe('overlayMatcher — prefix fallback, not substring', () => {
  it('matches a nickname that is a prefix of the first name', () => {
    expect(match('Alex')).toEqual(['a6']); // Alex → Alexander
  });

  it('does NOT match a token merely contained mid-name', () => {
    expect(match('lex')).toEqual([]); // "lex" is inside "Alexander" but not a prefix
  });
});
