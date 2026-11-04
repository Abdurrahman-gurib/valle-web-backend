import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateQuoteDto, mauritiusToday } from './dto/create-quote.dto';
import { messageWithProgramme } from './quotes.service';

/** Property names (and messages) that fail, as the global pipe would report them. */
function failures(payload: Record<string, unknown>) {
  const errors = validateSync(plainToInstance(CreateQuoteDto, payload) as object, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => ({ property: e.property, messages: Object.values(e.constraints ?? {}) }));
}
const base = { name: 'A. Peirce', email: 'sales@example.com' };
const dayOffset = (days: number) => new Date(new Date(mauritiusToday() + 'T00:00:00Z').getTime() + days * 86_400_000).toISOString().slice(0, 10);

describe('quote request: preferred date', () => {
  it('accepts today, a later day, or no date at all', () => {
    expect(failures({ ...base, preferredDate: dayOffset(0) })).toEqual([]);
    expect(failures({ ...base, preferredDate: dayOffset(45) })).toEqual([]);
    expect(failures({ ...base })).toEqual([]);
  });

  it('refuses a day that is not on the calendar', () => {
    const f = failures({ ...base, preferredDate: '2027-02-30' });
    expect(f.map((x) => x.property)).toEqual(['preferredDate']);
    expect(f[0].messages.join(' ')).toMatch(/real date/);
  });

  it('refuses free text and a past day, with a clear message', () => {
    expect(failures({ ...base, preferredDate: 'mid September' }).map((x) => x.property)).toEqual(['preferredDate']);
    const past = failures({ ...base, preferredDate: dayOffset(-10) });
    expect(past.map((x) => x.property)).toEqual(['preferredDate']);
    expect(past[0].messages).toContain('preferredDate must be today or a later date');
  });

  it('allows one day of grace for a visitor still on yesterday in their own zone', () => {
    expect(failures({ ...base, preferredDate: dayOffset(-1) })).toEqual([]);
  });
});

describe('quote request: programme', () => {
  it('accepts the chosen programme and puts it at the head of the message', () => {
    expect(failures({ ...base, programme: 'Corporate package · Programme 2' })).toEqual([]);
    expect(messageWithProgramme('Programme 2', 'Forty people')).toBe('Programme: Programme 2\n\nForty people');
    expect(messageWithProgramme('Programme 2', '')).toBe('Programme: Programme 2');
    expect(messageWithProgramme(undefined, ' Hello ')).toBe('Hello');
    expect(messageWithProgramme('  ', undefined)).toBe('');
  });

  it('caps the programme length', () => {
    expect(failures({ ...base, programme: 'x'.repeat(161) }).map((x) => x.property)).toEqual(['programme']);
  });
});
