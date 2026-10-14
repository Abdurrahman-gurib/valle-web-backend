/**
 * `staff_users.role`. `agent` runs reservations, `hr` runs the careers back
 * office, `manager` covers both.
 */
export const STAFF_ROLES = ['agent', 'hr', 'manager'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** What the staff app is allowed to see about the signed-in operator. */
export interface StaffPrincipal {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
}

/** JWT payload: `{ sub, email, role }` per the contract. */
export interface StaffJwtPayload {
  sub: string;
  email: string;
  role: StaffRole;
  /** staff_users.token_version at signing; absent on pre-022 tokens (= 0). */
  tv?: number;
  /** Set only on the short-lived "password ok, code needed" token. */
  purpose?: '2fa';
}

/** Express request once StaffAuthGuard has run. */
export interface RequestWithStaff {
  cookies?: Record<string, string>;
  staff?: StaffPrincipal;
}
