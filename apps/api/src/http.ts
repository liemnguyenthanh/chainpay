import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  type INestApplication,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const detail = error instanceof HttpException ? error.getResponse() : null;
    const safe =
      detail &&
      typeof detail === 'object' &&
      'code' in detail &&
      'message' in detail
        ? detail
        : {
            code: status === 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`,
            message:
              status === 500 ? 'Internal server error' : 'Request rejected',
          };
    response
      .status(status)
      .json({ ...safe, requestId: response.getHeader('X-Request-Id') });
  }
}
export function configureHttp(app: INestApplication) {
  app.setGlobalPrefix('v1');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Request-Id', randomUUID());
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalFilters(new SafeErrors());
}
