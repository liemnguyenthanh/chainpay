import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttp } from './http';

async function bootstrap() {
  const port = Number(process.env.API_PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }

  const app = await NestFactory.create(AppModule);
  configureHttp(app);
  app.enableShutdownHooks();
  await app.listen(port, process.env.API_HOST ?? '127.0.0.1');
  Logger.log(
    `API listening on port ${port}; GET /v1/health is liveness only`,
    'Bootstrap',
  );
}

void bootstrap().catch(() => {
  Logger.error(
    'API startup failed; check configuration and port availability',
    'Bootstrap',
  );
  process.exitCode = 1;
});
