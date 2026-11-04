import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatGateway } from '../chat/chat.gateway';
import { Quote } from '../entities';
import { InboxNotifierService } from '../notifications/inbox-notifier.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

/** The chosen programme heads the message, so the desk sees it in every inbox view. */
export function messageWithProgramme(programme?: string, message?: string): string {
  const p = (programme ?? '').trim();
  const m = (message ?? '').trim();
  if (!p) return m;
  return m ? `Programme: ${p}\n\n${m}` : `Programme: ${p}`;
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepo: Repository<Quote>,
    @Optional() private readonly notifier?: InboxNotifierService,
    @Optional() private readonly gateway?: ChatGateway,
  ) {}

  async create(dto: CreateQuoteDto): Promise<{ id: string }> {
    const quote = this.quoteRepo.create({
      name: dto.name,
      company: dto.company ?? '',
      email: dto.email,
      phone: dto.phone ?? '',
      groupSize: dto.groupSize ?? '',
      preferredDate: dto.preferredDate ?? '',
      message: messageWithProgramme(dto.programme, dto.message),
    });
    const saved = await this.quoteRepo.save(quote);
    // After the row is safe: tell the desk. Neither channel may fail the request.
    void Promise.all([
      this.gateway?.announceQuote({ id: saved.id, name: saved.name, company: saved.company, groupSize: saved.groupSize, preferredDate: saved.preferredDate, createdAt: saved.createdAt }),
      this.notifier?.notifyNewQuote(saved),
    ]).catch((e: unknown) => this.logger.error(`Quote ${saved.id}: could not notify the desk: ${(e as Error).message}`));
    return { id: saved.id };
  }
}
