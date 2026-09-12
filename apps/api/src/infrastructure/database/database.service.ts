import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { connectDatabase } from '@chainpay/database';
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly connection = connectDatabase(
    process.env.DATABASE_URL ??
      (() => {
        throw new Error('DATABASE_URL required');
      })(),
  );
  readonly pool = this.connection.pool;
  readonly db = this.connection.db;
  async onModuleDestroy() {
    await this.connection.pool.end();
  }
}
