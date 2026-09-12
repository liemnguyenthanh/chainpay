import { Module } from '@nestjs/common';
import { MerchantEventsController } from './merchant-events.controller';
import { MerchantEventsService } from './merchant-events.service';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MerchantSessionModule } from '../merchant-session/merchant-session.module';
@Module({
  imports: [DatabaseModule, MerchantSessionModule],
  controllers: [MerchantEventsController],
  providers: [MerchantEventsService],
})
export class MerchantEventsModule {}
