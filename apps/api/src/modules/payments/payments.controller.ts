import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionService } from '../merchant-session/session.service';
import { fail } from '../../common/http/errors';
import { uuidPattern } from '../../common/validation/uuid';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly access: SessionService,
  ) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.access.checkOrigin(req);
    const merchant = await this.access.merchant(req);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key))
      return fail(
        400,
        'INVALID_IDEMPOTENCY_KEY',
        'A 1–128 character visible ASCII Idempotency-Key is required',
      );
    const result = await this.payments.create(merchant, key, body);
    res.status(result.created ? 201 : 200);
    return result.payment;
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const merchant = await this.access.merchant(req);
    if (!uuidPattern.test(id))
      return fail(400, 'INVALID_ID', 'Invalid payment ID');
    return this.payments.detail(merchant.id, id);
  }

  @Get()
  async list(@Query() query: Record<string, unknown>, @Req() req: Request) {
    const merchant = await this.access.merchant(req);
    return this.payments.list(merchant.id, query);
  }
}
