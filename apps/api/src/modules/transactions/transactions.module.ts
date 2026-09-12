import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionService } from './transaction.service';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MerchantSessionModule } from '../merchant-session/merchant-session.module';
import { CheckoutModule } from '../checkout/checkout.module';
@Module({
  imports: [DatabaseModule, MerchantSessionModule, CheckoutModule],
  controllers: [TransactionsController],
  providers: [TransactionService],
})
export class TransactionsModule {}
