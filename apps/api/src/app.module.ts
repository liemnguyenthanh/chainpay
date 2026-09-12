import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { MerchantSessionModule } from './modules/merchant-session/merchant-session.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { MerchantEventsModule } from './modules/merchant-events/merchant-events.module';

@Module({
  imports: [
    HealthModule,
    MerchantSessionModule,
    PaymentsModule,
    CheckoutModule,
    TransactionsModule,
    MerchantEventsModule,
  ],
})
export class AppModule {}
