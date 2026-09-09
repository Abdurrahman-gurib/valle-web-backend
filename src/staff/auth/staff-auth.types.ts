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
}

/** Express request once StaffAuthGuard has run. */
export interface RequestWithStaff {
  cookies?: Record<string, string>;
  staff?: StaffPrincipal;
}
