import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Mirrors FunnelStep in Frontend/src/lib/funnel.ts. */
export const FUNNEL_STEPS = [
  'view_booking', 'pick_items', 'pick_date', 'details', 'submit', 'booked',
  'package_click', 'addon_add', 'suggestion_shown', 'suggestion_taken',
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** The ordered steps whose distinct-session counts make the conversion chain. */
export const FUNNEL_CHAIN: FunnelStep[] = ['view_booking', 'pick_items', 'pick_date', 'details', 'submit', 'booked'];
/** Steps reported by label (which package, add-on or suggestion). */
export const LABELLED_STEPS: FunnelStep[] = ['package_click', 'addon_add', 'suggestion_taken'];

export class FunnelEventDto {
  @IsIn(FUNNEL_STEPS as unknown as string[])
  step: FunnelStep;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsString()
  @Matches(/^[A-Za-z0-9]{1,20}$/)
  sid: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  path?: string;
}
