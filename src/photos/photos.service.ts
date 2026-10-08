import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../entities/booking.entity';
import { BookingLine } from '../entities/booking-line.entity';
import { BookingPhoto } from '../entities/booking-photo.entity';
import { TicketService } from '../tickets/ticket.service';

/** 8 MB a photo, 120 photos a booking: a full Platinum shoot at phone resolution. */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTOS_PER_BOOKING = 120;
const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export interface UploadedPhotoFile { originalname: string; mimetype: string; size: number; buffer: Buffer }

export interface PhotoView { id: string; name: string; mime: string; size: number; caption: string; createdAt: string; url: string }
export interface PhotoSet {
  refCode: string;
  /** The guest booked a photo package (a `photo:` product line) */
  packageLabel: string | null;
  photosReadyAt: string | null;
  count: number;
  photos: PhotoView[];
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'photo';

@Injectable()
export class PhotosService {
  constructor(
    private readonly tickets: TicketService,
    @InjectRepository(BookingPhoto) private readonly photoRepo: Repository<BookingPhoto>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingLine) private readonly lineRepo: Repository<BookingLine>,
  ) {}

  /** The set as the guest sees it (token checked) or as staff sees it (no token). */
  async set(refCode: string, token?: string): Promise<PhotoSet> {
    const b = await this.booking(refCode, token);
    const [rows, lines] = await Promise.all([
      this.photoRepo.find({ where: { bookingId: b.id }, order: { createdAt: 'ASC' } }),
      this.lineRepo.find({ where: { bookingId: b.id } }),
    ]);
    const pkg = lines.find((l) => l.productKey?.startsWith('photo:'));
    return {
      refCode: b.refCode,
      packageLabel: pkg ? pkg.label : null,
      photosReadyAt: b.photosReadyAt?.toISOString() ?? null,
      count: rows.length,
      photos: rows.map((p) => ({
        id: p.id, name: p.name, mime: p.mime, size: p.size, caption: p.caption, createdAt: p.createdAt.toISOString(),
        url: token !== undefined ? this.guestUrl(b.refCode, p.id) : `/api/staff/bookings/${encodeURIComponent(b.refCode)}/photos/${p.id}`,
      })),
    };
  }

  guestUrl(refCode: string, id: string): string {
    return `${this.tickets.siteUrl}/api/tickets/${encodeURIComponent(refCode)}/photos/${id}?t=${this.tickets.token(refCode)}`;
  }

  /** One photo with its bytes, for the download routes. */
  async file(refCode: string, id: string, token?: string): Promise<BookingPhoto> {
    const b = await this.booking(refCode, token);
    const p = await this.photoRepo.createQueryBuilder('p').addSelect('p.data').where('p.id = :id AND p.booking_id = :bid', { id, bid: b.id }).getOne();
    if (!p) throw new NotFoundException('No such photo');
    return p;
  }

  async add(refCode: string, file: UploadedPhotoFile | undefined, caption: string, by: string): Promise<PhotoSet> {
    if (!file) throw new BadRequestException('Attach a photo (field "file")');
    if (!PHOTO_MIMES.has(file.mimetype)) throw new BadRequestException('Photos must be JPEG, PNG, WebP or HEIC');
    if (file.size > PHOTO_MAX_BYTES) throw new BadRequestException(`A photo must be ${PHOTO_MAX_BYTES / 1024 / 1024} MB or less`);
    const b = await this.booking(refCode);
    if (b.status === 'cancelled') throw new ConflictException('This booking was cancelled');
    const n = await this.photoRepo.count({ where: { bookingId: b.id } });
    if (n >= PHOTOS_PER_BOOKING) throw new ConflictException(`A booking holds at most ${PHOTOS_PER_BOOKING} photos`);
    await this.photoRepo.save(this.photoRepo.create({ bookingId: b.id, name: safeName(file.originalname), mime: file.mimetype, size: file.size, data: file.buffer, caption: caption.trim().slice(0, 160), uploadedBy: by }));
    return this.set(refCode);
  }

  async remove(refCode: string, id: string): Promise<PhotoSet> {
    const b = await this.booking(refCode);
    await this.photoRepo.delete({ id, bookingId: b.id });
    return this.set(refCode);
  }

  /** Marks the set ready; the caller sends the "your photos are ready" message. */
  async markReady(refCode: string): Promise<Booking> {
    const b = await this.booking(refCode);
    const n = await this.photoRepo.count({ where: { bookingId: b.id } });
    if (n === 0) throw new ConflictException('Upload the photos first');
    b.photosReadyAt = new Date();
    await this.bookingRepo.update({ id: b.id }, { photosReadyAt: b.photosReadyAt });
    return b;
  }

  private async booking(refCode: string, token?: string): Promise<Booking> {
    if (token !== undefined) return this.tickets.requireBooking(refCode, token);
    const b = await this.bookingRepo.findOne({ where: { refCode: refCode.toUpperCase() } });
    if (!b) throw new NotFoundException(`No booking ${refCode}`);
    return b;
  }
}
