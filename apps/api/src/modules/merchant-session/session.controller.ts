import { Body, Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionService } from './session.service';
@Controller('merchant/session')
export class SessionController {
  constructor(private readonly access: SessionService) {}
  @Post()
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.access.checkOrigin(req);
    const { token, merchant } = await this.access.login(body, req.ip);
    res.cookie(this.access.cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/v1',
      maxAge: 8 * 3600000,
    });
    return { id: merchant.id, name: merchant.name };
  }
  @Get()
  async current(@Req() req: Request) {
    const merchant = await this.access.merchant(req);
    return { id: merchant.id, name: merchant.name };
  }
  @Delete()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.access.checkOrigin(req);
    await this.access.revoke(this.access.token(req));
    res.clearCookie(this.access.cookieName, {
      path: '/v1',
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
    });
    return { ok: true };
  }
}
