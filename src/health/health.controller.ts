import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Readiness. Must fail closed: orchestrators decide on the status code and
   * never read the body, so answering 200 while the database is unreachable
   * would keep a replica in the load balancer serving 500s to guests.
   */
  @Get()
  @ApiOperation({ summary: 'Readiness: can this instance serve traffic?' })
  @ApiResponse({ status: 200, description: 'Ready' })
  @ApiResponse({ status: 503, description: 'Database unreachable' })
  async check(): Promise<{ status: string; db: boolean }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', db: false });
    }
    return { status: 'ok', db: true };
  }

  /**
   * Liveness. Deliberately does not touch the database: the connection pool
   * recovers on its own after a failover, so restarting the process on a
   * transient database blip would turn a brief outage into a restart loop.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness: is the process up?' })
  live(): { status: string } {
    return { status: 'ok' };
  }
}
