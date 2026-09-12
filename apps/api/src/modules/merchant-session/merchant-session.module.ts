import { Module } from '@nestjs/common';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { DatabaseModule } from '../../infrastructure/database/database.module';
@Module({
  imports: [DatabaseModule],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class MerchantSessionModule {}
