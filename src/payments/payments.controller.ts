import { Body, Controller, ForbiddenException, Get, Header, Headers, HttpCode, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { TicketQueryDto } from '../tickets/ticket.dto';
import { PaymentsService, PaymentStatusView } from './payments.service';
import { SandboxProvider } from './sandbox.provider';

class CheckoutDto {
  @IsString() @Matches(/^[A-Za-z]{3}-\d{3,6}-\d{2}$/) refCode: string;
  @IsString() @Length(24, 24) t: string;
}

class SandboxOutcomeDto {
  @IsString() @Matches(/^(paid|failed)$/) outcome: 'paid' | 'failed';
  @IsOptional() @IsString() @Length(0, 64) k?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('config')
  @ApiOperation({ summary: 'Whether online payment is offered, and by which provider' })
  @Header('Cache-Control', 'public, max-age=300')
  config(): { enabled: boolean; provider: string | null } {
    return { enabled: this.payments.enabled, provider: this.payments.provider?.name ?? null };
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Open a hosted checkout for what a booking still owes (needs the ticket token)' })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 10 * 60_000 } })
  checkout(@Body() dto: CheckoutDto): Promise<{ paymentId: string; checkoutUrl: string }> {
    return this.payments.startCheckoutByRef(dto.refCode.toUpperCase(), dto.t);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Outcome of a payment, polled by the ticket page after the hosted checkout' })
  @Header('Cache-Control', 'private, no-store')
  status(@Param('id') id: string, @Query() q: TicketQueryDto): Promise<PaymentStatusView> {
    return this.payments.status(id, q.t);
  }

  @Post('webhook/:provider')
  @ApiOperation({ summary: "The provider's server-to-server notice of a payment outcome" })
  @HttpCode(200)
  async webhook(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Req() req: Request & { rawBody?: Buffer },
  ): Promise<{ ok: true; applied: boolean }> {
    if (!this.payments.provider || this.payments.provider.name !== provider) throw new NotFoundException('Unknown provider');
    const { applied } = await this.payments.handleWebhook(headers, body, req.rawBody);
    return { ok: true, applied };
  }

  // ------------------------------------------------ sandbox "hosted page"

  private sandbox(): SandboxProvider {
    const p = this.payments.provider;
    if (!(p instanceof SandboxProvider)) throw new NotFoundException();
    return p;
  }

  @Get('sandbox/:id')
  @ApiOperation({ summary: 'Sandbox only: the stand-in hosted payment page' })
  async sandboxPage(@Param('id') id: string, @Query('k') k: string | undefined, @Res() res: Response): Promise<void> {
    const sbx = this.sandbox();
    if (!sbx.verifyPageKey(id, k)) throw new ForbiddenException();
    // the page key is the sandbox's own credential, so the row is read directly
    const p = await this.payments.find(id);
    if (!p) throw new NotFoundException();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox payment</title>
<style>body{font-family:system-ui,sans-serif;background:#F7F3FF;color:#340057;margin:0;display:grid;place-items:center;min-height:100vh}main{background:#fff;border-radius:18px;padding:32px;max-width:420px;box-shadow:0 20px 50px -20px rgba(52,0,87,.4)}h1{font-size:18px;margin:0 0 6px}p{margin:6px 0;color:rgba(52,0,87,.7)}.amt{font-size:34px;font-weight:800;margin:14px 0}button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:14px 22px;cursor:pointer;margin:6px 6px 0 0}.pay{background:#33FF74;color:#340057}.fail{background:#FFE2E7;color:#D91E44}.tag{font-size:11px;letter-spacing:.14em;color:#7333FF;font-weight:700}</style></head>
<body><main data-testid="sandbox-checkout"><div class="tag">SANDBOX · NO MONEY MOVES</div><h1>Pay VALLÉ Advenature Park</h1><p>Payment ${esc(id.slice(0, 8))} · ${esc(p.status)}</p><div class="amt">Rs ${p.amount.toLocaleString('en-US')}</div>
<p>This stand-in page replaces the card form of a real gateway. Choose an outcome:</p>
<form method="post" action="/api/payments/sandbox/${esc(id)}/complete"><input type="hidden" name="k" value="${esc(k ?? '')}"><button class="pay" name="outcome" value="paid" data-testid="sandbox-pay">Pay Rs ${p.amount.toLocaleString('en-US')}</button><button class="fail" name="outcome" value="failed" data-testid="sandbox-fail">Card declined</button></form></main></body></html>`);
  }

  @Post('sandbox/:id/complete')
  @ApiOperation({ summary: 'Sandbox only: the hosted page reports its outcome, like a webhook, then sends the guest back' })
  async sandboxComplete(@Param('id') id: string, @Body() dto: SandboxOutcomeDto, @Res() res: Response): Promise<void> {
    const sbx = this.sandbox();
    if (!sbx.verifyPageKey(id, dto.k)) throw new ForbiddenException();
    const p = await this.payments.find(id);
    if (!p) throw new NotFoundException();
    const body = { paymentId: id, providerRef: p.providerRef, status: dto.outcome, amount: dto.outcome === 'paid' ? p.amount : 0, reason: dto.outcome === 'failed' ? 'Card declined (sandbox)' : undefined, sig: sbx.sign(id, dto.outcome, dto.outcome === 'paid' ? p.amount : 0) };
    await this.payments.handleWebhook({}, body);
    const booking = await this.payments.bookingOf(p);
    if (!booking) throw new NotFoundException();
    res.redirect(303, this.payments.returnUrl(booking, id));
  }
}
