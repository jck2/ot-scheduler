import { describe, it, expect } from 'vitest';
import { parseRosterCSV, filterByProvider, getProviderNames } from '@/parsing/rosterParser';

const SAMPLE_CSV = `First Name,Last Name,Grade,Class,OSIS #,Occupational Therapy Mandate,Provider,CAP Updates,RSA Status
Aqeela,O'Neil,4,Magnolia,253-976-237,2x30:1,Amanda Huang,,
Arahli,Aviles,4,Elm,250-605-177,"1x30:1, 1x30:2",Amanda Huang,,
Anna,Glick,3,Juneberry,252-950-530,"1x30:1, 1x30:2",Elsa Chen ,,
,,,,,,,,`;

describe('parseRosterCSV', () => {
  it('parses students correctly', () => {
    const students = parseRosterCSV(SAMPLE_CSV);
    expect(students).toHaveLength(3); // skips empty rows
  });

  it('trims provider whitespace', () => {
    const students = parseRosterCSV(SAMPLE_CSV);
    const elsa = students.find((s) => s.firstName === 'Anna');
    expect(elsa?.provider).toBe('Elsa Chen');
  });

  it('normalizes OSIS numbers', () => {
    const students = parseRosterCSV(SAMPLE_CSV);
    expect(students[0].osisNumber).toBe('253-976-237');
  });

  it('parses mandates inline', () => {
    const students = parseRosterCSV(SAMPLE_CSV);
    const arahli = students.find((s) => s.firstName === 'Arahli');
    expect(arahli?.mandateSessions).toHaveLength(2);
    expect(arahli?.mandateSessions[0].groupSize).toBe(1);
    expect(arahli?.mandateSessions[1].groupSize).toBe(2);
  });

  it('handles apostrophes in names', () => {
    const students = parseRosterCSV(SAMPLE_CSV);
    expect(students[0].lastName).toBe("O'Neil");
  });
});

describe('filterByProvider', () => {
  it('filters to Amanda only', () => {
    const students = parseRosterCSV(SAMPLE_CSV);
    const amanda = filterByProvider(students, 'Amanda Huang');
    expect(amanda).toHaveLength(2);
  });

  it('handles trailing spaces in provider name', () => {
    const students = parseRosterCSV(SAMPLE_CSV);
    const elsa = filterByProvider(students, 'Elsa Chen');
    expect(elsa).toHaveLength(1);
  });
});

describe('getProviderNames', () => {
  it('returns unique provider names', () => {
    const students = parseRosterCSV(SAMPLE_CSV);
    const providers = getProviderNames(students);
    expect(providers).toContain('Amanda Huang');
    expect(providers).toContain('Elsa Chen');
    expect(providers).toHaveLength(2);
  });
});

describe('OSIS normalization edge cases', () => {
  it('normalizes space-separated OSIS', () => {
    const csv = `First Name,Last Name,Grade,Class,OSIS #,Occupational Therapy Mandate,Provider,CAP Updates,RSA Status
Noah,Norzi,2,Chestnut,258 452 614,"1x30:1, 1x30:group",Elsa Chen ,,`;
    const students = parseRosterCSV(csv);
    expect(students[0].osisNumber).toBe('258-452-614');
  });

  it('normalizes OSIS with trailing space', () => {
    const csv = `First Name,Last Name,Grade,Class,OSIS #,Occupational Therapy Mandate,Provider,CAP Updates,RSA Status
Aaliyah,Martinez,5,Pine,231-386-830 ,2x30:1,Amanda Huang,,`;
    const students = parseRosterCSV(csv);
    expect(students[0].osisNumber).toBe('231-386-830');
  });

  it('handles OSIS with extra spaces', () => {
    const csv = `First Name,Last Name,Grade,Class,OSIS #,Occupational Therapy Mandate,Provider,CAP Updates,RSA Status
Aiden,Lacey,3,Sophora,256 -020 -975,"1x30:1, 1x30:3",Elsa Chen ,,`;
    const students = parseRosterCSV(csv);
    expect(students[0].osisNumber).toBe('256-020-975');
  });
});
