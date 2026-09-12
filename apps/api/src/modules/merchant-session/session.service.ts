import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  and,
  eq,
  gt,
  merchants,
  sessions,
  verifyPassword,
} from '@chainpay/database';
import type { Request } from 'express';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { digest } from '../../common/crypto/digest';
import { fail } from '../../common/http/errors';
@Injectable()
export class SessionService {
  // Bounded per-process demo login throttle; no credential values retained.
  private attempts = new Map<string, { count: number; until: number }>();
  readonly origin: string;
  readonly cookieName = 'chainpay_merchant';
  constructor(private readonly database: DatabaseService) {
    const origin = process.env.MERCHANT_ORIGIN;
    if (
      !origin ||
      new URL(origin).origin !== origin ||
      (process.env.NODE_ENV === 'production' && !origin.startsWith('https://'))
    )
      throw new Error('Valid MERCHANT_ORIGIN required (HTTPS in production)');
    this.origin = origin;
  }
  async login(body: unknown, clientIp?: string) {
    const now = Date.now();
    for (const [key, value] of this.attempts)
      if (value.until <= now) this.attempts.delete(key);
    const key = clientIp ?? 'unknown';
    const entry = this.attempts.get(key) ?? { count: 0, until: now + 60000 };
    if (entry.count >= 10 || this.attempts.size >= 10000)
      return fail(429, 'RATE_LIMITED', 'Try again later');
    entry.count++;
    this.attempts.set(key, entry);
    const value = body as Record<string, unknown> | null;
    if (
      !value ||
      typeof value.password !== 'string' ||
      value.password.length > 256
    )
      return fail(401, 'UNAUTHORIZED', 'Invalid credentials');
    const [merchant] = await this.database.db
      .select()
      .from(merchants)
      .where(eq(merchants.name, 'demo'));
    if (
      !merchant ||
      !(await verifyPassword(value.password, merchant.passwordHash))
    )
      return fail(401, 'UNAUTHORIZED', 'Invalid credentials');
    const token = randomBytes(32).toString('base64url');
    await this.database.db.insert(sessions).values({
      tokenHash: digest(token),
      merchantId: merchant.id,
      expiresAt: new Date(now + 8 * 3600000),
    });
    return { token, merchant: { id: merchant.id, name: merchant.name } };
  }
  async revoke(token: string) {
    await this.database.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, digest(token)));
  }
  checkOrigin(req: Request) {
    if (req.headers.origin !== this.origin)
      fail(403, 'INVALID_ORIGIN', 'Request origin is not allowed');
  }
  token(req: Request) {
    const matches = (req.headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(`${this.cookieName}=`));
    const token =
      matches.length === 1 ? matches[0]!.slice(this.cookieName.length + 1) : '';
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
  }
  async merchant(req: Request) {
    const token = this.token(req);
    if (!token) return fail(401, 'UNAUTHORIZED', 'Merchant session required');
    const [row] = await this.database.db
      .select({ merchant: merchants })
      .from(sessions)
      .innerJoin(merchants, eq(sessions.merchantId, merchants.id))
      .where(
        and(
          eq(sessions.tokenHash, digest(token)),
          gt(sessions.expiresAt, new Date()),
        ),
      );
    if (!row) return fail(401, 'UNAUTHORIZED', 'Merchant session required');
    return row.merchant;
  }
}
