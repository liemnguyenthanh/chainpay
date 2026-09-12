import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MerchantEventsService } from './merchant-events.service';
@Controller('merchant')
export class MerchantEventsController {
  constructor(private readonly events: MerchantEventsService) {}
  @Get('events')
  open(@Req() req: Request, @Res() res: Response) {
    return this.events.open(req, res);
  }
}
