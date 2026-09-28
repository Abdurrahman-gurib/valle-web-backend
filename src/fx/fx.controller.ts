import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FxService, FxTable } from './fx.service';

@ApiTags('fx')
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get()
  @ApiOperation({ summary: 'Indicative MUR exchange rates (Bank of Mauritius) for displaying prices in other currencies' })
  @Header('Cache-Control', 'public, max-age=1800')
  rates(): Promise<FxTable> {
    return this.fx.rates();
  }
}
