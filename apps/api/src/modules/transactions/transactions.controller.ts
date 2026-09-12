import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CheckoutAuthService } from '../checkout/checkout-auth.service';
import { SessionService } from '../merchant-session/session.service';
import { TransactionService } from './transaction.service';
import { fail } from '../../common/http/errors';
import { uuidPattern } from '../../common/validation/uuid';
@Controller()
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionService,
    private readonly checkout: CheckoutAuthService,
    private readonly merchant: SessionService,
  ) {}
  @Post('checkout/:token/transactions')
  @HttpCode(202)
  async submit(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    this.checkout.checkOrigin(req);
    await this.checkout.throttle(req, 'transactions');
    const session = await this.checkout.authorize(req, token);
    return this.transactions.submit(
      session.paymentId,
      body && typeof body === 'object'
        ? (body as Record<string, unknown>).txHash
        : undefined,
    );
  }
  @Post('payments/:id/attempts/:attemptId/retry')
  @HttpCode(202)
  async retry(
    @Param('id') id: string,
    @Param('attemptId') attemptId: string,
    @Req() req: Request,
  ) {
    this.merchant.checkOrigin(req);
    const merchant = await this.merchant.merchant(req);
    if (!uuidPattern.test(id) || !uuidPattern.test(attemptId))
      return fail(400, 'INVALID_ID', 'Invalid ID');
    return this.transactions.retry(id, attemptId, merchant.id);
  }
}
