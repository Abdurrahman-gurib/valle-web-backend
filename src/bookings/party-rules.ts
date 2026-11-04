import { BadRequestException } from '@nestjs/common';
import { parseAgeLabel } from '../waivers/waiver-rules';

/**
 * What every booking path (new booking, hold, the guest's own change) checks
 * about the people on each line, before anything is priced or held.
 */

export interface PartyCounts { adults: number; kids: number; infants?: number }
export interface PartyItem { id: string; adults?: number; kids?: number }
/** What the rules need to know about an experience or product: its name and age label. */
export interface LineInfo { name: string; ageLabel?: string | null }

/**
 * A line never counts more people than the party: adults within the adults,
 * children within the children 6–11 plus the under-6s (a Kids Park ride can
 * take a four-year-old), and never more people than the party in all.
 */
export function assertLinesFitParty(items: PartyItem[], party: PartyCounts, info: (id: string) => LineInfo | undefined): void {
  const infants = party.infants ?? 0;
  for (const item of items) {
    const a = item.adults ?? 0;
    const k = item.kids ?? 0;
    if (a > party.adults || k > party.kids + infants || a + k > party.adults + party.kids + infants) {
      throw new BadRequestException(`${info(item.id)?.name ?? item.id} cannot count more people than the party`);
    }
  }
}

/**
 * Hard minimum ages: an experience for 12 and over takes no children (6–11 are
 * all below it). Softer minimums (8+, 10+) are left to the instructor, who
 * checks the age at the platform; nothing is refused for a maximum age.
 */
export function assertAgeMinimums(items: PartyItem[], info: (id: string) => LineInfo | undefined): void {
  for (const item of items) {
    if ((item.kids ?? 0) <= 0) continue;
    const i = info(item.id);
    const min = parseAgeLabel(i?.ageLabel).minAge;
    if (min !== undefined && min >= 12) throw new BadRequestException(`${i?.name ?? item.id} is for ages ${min}+ only`);
  }
}
