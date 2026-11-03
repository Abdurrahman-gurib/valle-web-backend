/** The park's time zone: every "today" and visit date is a Mauritius calendar day. */
export const PARK_TZ = 'Indian/Mauritius';

/** Today at the park, as YYYY-MM-DD. */
export const parkToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: PARK_TZ });
