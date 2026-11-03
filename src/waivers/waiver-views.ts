import { BadRequestException } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import { isoDay } from '../common/park-time';
import type { Booking, Waiver } from '../entities';
import type { CopySent } from './waiver-copy.service';
import type { SignWaiverDto } from './waiver.dto';
import { ageOn, flagsFor, WAIVER_TERMS_VERSION, type GateActivity, type WaiverFlag } from './waiver-rules';

/** Oldest age a date of birth may give before it is taken for a typo. */
const MAX_AGE = 110;
/** Signers under this age need a parent or guardian to sign for them. */
const ADULT_AGE = 18;
/** Most names a group leader's waiver pack can list. */
const MAX_GROUP_PARTICIPANTS = 400;

/** What the guest's waiver page needs: who still has to sign, and nothing private. */
export interface WaiverPublicView {
  refCode: string;
  guestName: string;
  visitDate: string;
  slot: 'morning' | 'afternoon';
  required: number;
  signed: { id: string; participantName: string; isMinor: boolean; signedAt: string }[];
  /** A group booking: the leader signs one pack for these participants. */
  group?: { leaderName: string; participants: string[] } | null;
  /** false once the visit date has passed or the booking is cancelled */
  open: boolean;
  termsVersion: string;
  /** After a POST: whether the guest's copy went out. */
  copy?: CopySent;
  activities: { name: string; minAge?: number; maxAge?: number; driveMinAge?: number; maxWeightKg?: number; minWeightKg?: number; minHeightCm?: number; maxHeightCm?: number }[];
}

export interface GateWaiver {
  id: string;
  participantName: string;
  age: number;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  isMinor: boolean;
  guardianName: string;
  address: string;
  email: string;
  phone: string;
  nationality: string;
  idNumber: string;
  marketingConsent: boolean;
  emergencyName: string;
  emergencyPhone: string;
  medicalNotes: string;
  photoConsent: boolean;
  signedBy: string;
  signature: string;
  lang: string;
  signedAt: string;
  flags: WaiverFlag[];
  /** How many times this participant signed; earlier versions are in `history`. */
  version: number;
}

/** A superseded signature: the participant signed again. */
export interface WaiverHistoryRow { id: string; participantName: string; version: number; signedAt: string; supersededAt: string }

export interface GateView {
  refCode: string;
  guestName: string;
  phone: string;
  visitDate: string;
  slot: 'morning' | 'afternoon';
  adults: number;
  kids: number;
  status: string;
  payMode: string;
  total: number;
  paidAmount: number;
  balance: number;
  adjustmentAmount: number;
  adjustmentNote: string;
  isToday: boolean;
  lines: { label: string; amount: number }[];
  activities: GateActivity[];
  required: number;
  signedCount: number;
  missing: number;
  stops: number;
  waivers: GateWaiver[];
  /** Superseded signatures, newest first: a participant signed again. */
  history: WaiverHistoryRow[];
  waiverUrl: string;
}

export interface GateDayRow {
  refCode: string;
  guestName: string;
  slot: 'morning' | 'afternoon';
  party: number;
  status: string;
  signed: number;
  balance: number;
}

/** Who signs a waiver, worked out from the form: the participant, or a guardian for a minor. */
export interface Signer {
  /** The participant, whitespace collapsed. */
  name: string;
  isMinor: boolean;
  /** Trimmed; '' for an adult. */
  guardian: string;
}

/** The participant's age on the visit day decides who signs; an impossible age is a typo. */
export function signerFor(dto: SignWaiverDto, visitDate: string): Signer {
  const age = ageOn(dto.birthDate, visitDate);
  if (age < 0 || age > MAX_AGE) throw new BadRequestException('Please check the date of birth');
  const isMinor = age < ADULT_AGE;
  const guardian = (dto.guardianName ?? '').trim();
  if (isMinor && !guardian) throw new BadRequestException('A parent or guardian must sign for a participant under 18');
  return { name: dto.participantName.trim().replace(/\s+/g, ' '), isMinor, guardian };
}

/** The `waivers` row of a signature, version `version` for this participant. */
export function newWaiverRecord(
  dto: SignWaiverDto,
  b: Booking,
  signer: Signer,
  version: number,
  meta: { ip: string; userAgent: string },
): DeepPartial<Waiver> {
  const { name, isMinor, guardian } = signer;
  return {
    version,
    bookingId: b.id,
    participantName: name,
    groupParticipants: b.groupKind ? (dto.groupParticipants ?? []).map((x) => x.trim()).filter(Boolean).slice(0, MAX_GROUP_PARTICIPANTS) : null,
    birthDate: dto.birthDate,
    heightCm: dto.heightCm,
    weightKg: dto.weightKg,
    isMinor,
    guardianName: isMinor ? guardian : '',
    address: (dto.address ?? '').trim(),
    email: (dto.email ?? '').trim(),
    phone: dto.phone.trim(),
    nationality: dto.nationality.trim(),
    idNumber: (dto.idNumber ?? '').trim(),
    marketingConsent: !!dto.marketingConsent,
    emergencyName: dto.emergencyName.trim(),
    emergencyPhone: dto.emergencyPhone.trim(),
    medicalNotes: (dto.medicalNotes ?? '').trim(),
    declarations: { terms: true, health: true, consent: true },
    photoConsent: !!dto.photoConsent,
    signaturePng: dto.signature,
    signedBy: isMinor ? guardian : name,
    lang: dto.lang ?? 'en',
    termsVersion: WAIVER_TERMS_VERSION,
    ip: meta.ip.slice(0, 64),
    userAgent: meta.userAgent.slice(0, 300),
    signedAt: new Date(),
  };
}

/** A current waiver as the gate reads it, with the warnings for this visit's activities. */
export function toGateWaiver(w: Waiver, visitDate: string, activities: GateActivity[]): GateWaiver {
  const birthDate = isoDay(w.birthDate);
  return {
    id: w.id,
    participantName: w.participantName,
    age: ageOn(birthDate, visitDate),
    birthDate,
    heightCm: w.heightCm,
    weightKg: w.weightKg,
    isMinor: w.isMinor,
    guardianName: w.guardianName,
    address: w.address,
    email: w.email,
    phone: w.phone,
    nationality: w.nationality,
    idNumber: w.idNumber,
    marketingConsent: w.marketingConsent,
    emergencyName: w.emergencyName,
    emergencyPhone: w.emergencyPhone,
    medicalNotes: w.medicalNotes,
    photoConsent: w.photoConsent,
    signedBy: w.signedBy,
    signature: w.signaturePng,
    lang: w.lang,
    signedAt: w.signedAt.toISOString(),
    flags: flagsFor({ birthDate, heightCm: w.heightCm, weightKg: w.weightKg }, visitDate, activities),
    version: w.version ?? 1,
  };
}

/** Superseded waivers (the caller reads only rows with superseded_at set), newest first as given. */
export function toHistory(superseded: Waiver[]): WaiverHistoryRow[] {
  return superseded.flatMap((w) => (w.supersededAt
    ? [{ id: w.id, participantName: w.participantName, version: w.version ?? 1, signedAt: w.signedAt.toISOString(), supersededAt: w.supersededAt.toISOString() }]
    : []));
}

/** How many "stop" flags the current waivers carry: each one blocks check-in without an override. */
export const stopCount = (waivers: GateWaiver[]): number =>
  waivers.reduce((n, w) => n + w.flags.filter((f) => f.level === 'stop').length, 0);
