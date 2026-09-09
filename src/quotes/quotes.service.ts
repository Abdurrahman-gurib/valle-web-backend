import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quote } from '../entities';
import { CreateQuoteDto } from './dto/create-quote.dto';

@Injectable()
export class QuotesService {
  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepo: Repository<Quote>,
  ) {}

  async create(dto: CreateQuoteDto): Promise<{ id: string }> {
    const quote = this.quoteRepo.create({
      name: dto.name,
      company: dto.company ?? '',
      email: dto.email,
      phone: dto.phone ?? '',
      groupSize: dto.groupSize ?? '',
      preferredDate: dto.preferredDate ?? '',
      message: dto.message ?? '',
    });
    const saved = await this.quoteRepo.save(quote);
    return { id: saved.id };
  }
}
