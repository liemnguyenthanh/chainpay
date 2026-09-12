import { connectDatabase, merchants } from './index';
import { hashPassword } from './password';
export async function seed(url: string, password: string, receiver: string) {
  if (password.length < 16 || password.length > 256)
    throw new Error('Demo password must be 16–256 characters');
  if (!/^0x[0-9a-fA-F]{40}$/.test(receiver) || /^0x0{40}$/i.test(receiver))
    throw new Error('Valid demo receiver required');
  const { db, pool } = connectDatabase(url);
  try {
    await db
      .insert(merchants)
      .values({
        name: 'demo',
        receiverAddress: receiver.toLowerCase(),
        passwordHash: await hashPassword(password),
      })
      .onConflictDoNothing();
  } finally {
    await pool.end();
  }
}
if (require.main === module) {
  const { DATABASE_URL, DEMO_MERCHANT_PASSWORD, DEMO_RECEIVER_ADDRESS } =
    process.env;
  if (!DATABASE_URL || !DEMO_MERCHANT_PASSWORD || !DEMO_RECEIVER_ADDRESS)
    throw new Error(
      'Database, demo password and receiver configuration required',
    );
  void seed(DATABASE_URL, DEMO_MERCHANT_PASSWORD, DEMO_RECEIVER_ADDRESS).catch(
    () => {
      console.error('Demo seed failed');
      process.exitCode = 1;
    },
  );
}
