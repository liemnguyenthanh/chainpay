import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    // Liveness only: no dependency readiness or payment capability is implied.
    return { status: 'ok', service: 'api', check: 'liveness' } as const;
  }
}
