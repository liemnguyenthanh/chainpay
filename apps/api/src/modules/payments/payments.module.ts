import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MerchantSessionModule } from '../merchant-session/merchant-session.module';
@Module({
  imports: [DatabaseModule, MerchantSessionModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
