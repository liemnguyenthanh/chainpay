import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log(
    'Worker ready; verification, outbox dispatch and durable recovery active',
    'Worker',
  );
}

void bootstrap().catch(() => {
  Logger.error('Worker startup failed', 'Bootstrap');
  process.exitCode = 1;
});
