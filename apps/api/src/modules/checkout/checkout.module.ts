import { Module } from '@nestjs/common';
import { RpcBindingChainReader } from '@chainpay/blockchain';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MerchantSessionModule } from '../merchant-session/merchant-session.module';
import {
  CheckoutAuthService,
  BINDING_CHAIN_READER,
} from './checkout-auth.service';
import { CheckoutController } from './checkout.controller';
@Module({
  imports: [DatabaseModule, MerchantSessionModule],
  controllers: [CheckoutController],
  providers: [
    CheckoutAuthService,
    {
      provide: BINDING_CHAIN_READER,
      useFactory: () => new RpcBindingChainReader(),
    },
  ],
  exports: [CheckoutAuthService],
})
export class CheckoutModule {}
