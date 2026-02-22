import type { MandateSession } from '@/types';

/**
 * Parse mandate strings like:
 *   "2x30:1"          → [{frequency:2, duration:30, groupSize:1, groupFlexible:false}]
 *   "1x30:1, 1x30:2"  → two sessions
 *   "2x30:group"       → [{frequency:2, duration:30, groupSize:3, groupFlexible:true}]
 *   "1x30, 1x30:2"    → missing :y defaults to individual
 */
export function parseMandate(raw: string): MandateSession[] {
  const sessions: MandateSession[] = [];
  if (!raw || !raw.trim()) return sessions;

  const pattern = /(\d+)x(\d+)(?::(\d+|group))?/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const frequency = parseInt(match[1], 10);
    const duration = parseInt(match[2], 10);
    const groupSpec = match[3]?.toLowerCase();

    let groupSize: number;
    let groupFlexible = false;

    if (!groupSpec) {
      // Default to individual when group size is missing
      groupSize = 1;
    } else if (groupSpec === 'group') {
      groupSize = Infinity; // no max — groupFlexible signals uncapped
      groupFlexible = true;
    } else {
      groupSize = parseInt(groupSpec, 10);
    }

    sessions.push({ frequency, duration, groupSize, groupFlexible });
  }

  return sessions;
}

/**
 * Decompose mandates into individual session requests.
 * e.g., {frequency:2, duration:30, groupSize:1} → 2 separate session requests
 */
export function decomposeMandates(
  studentId: string,
  mandateSessions: MandateSession[]
): SessionRequest[] {
  const requests: SessionRequest[] = [];
  for (let mi = 0; mi < mandateSessions.length; mi++) {
    const ms = mandateSessions[mi];
    for (let i = 0; i < ms.frequency; i++) {
      requests.push({
        studentId,
        mandateIndex: mi,
        instanceIndex: i,
        duration: ms.duration,
        groupSize: ms.groupSize,
        groupFlexible: ms.groupFlexible,
        type: ms.groupSize === 1 ? 'individual' : ms.groupSize === 2 ? 'pair' : 'group',
      });
    }
  }
  return requests;
}

export interface SessionRequest {
  studentId: string;
  mandateIndex: number;
  instanceIndex: number;
  duration: number;
  groupSize: number;
  groupFlexible: boolean;
  type: 'individual' | 'pair' | 'group';
}
