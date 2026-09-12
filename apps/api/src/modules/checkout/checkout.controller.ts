import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CheckoutAuthService } from './checkout-auth.service';
@Controller()
export class CheckoutController {
  constructor(private readonly auth: CheckoutAuthService) {}
  @Post('payments/:id/checkout-token')
  issue(@Param('id') id: string, @Req() req: Request) {
    return this.auth.issue(id, req);
  }
  @Get('checkout/:token')
  snapshot(@Param('token') token: string) {
    return this.auth.snapshot(token);
  }
  @Post('checkout/:token/challenge')
  challenge(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.auth.challenge(token, body, req);
  }
  @Post('checkout/:token/verify')
  verify(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.verify(token, body, req, res);
  }
}
