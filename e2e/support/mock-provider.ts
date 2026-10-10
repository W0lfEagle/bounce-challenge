import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

type Payment = { amount: number; currency: string; card_number: string };

// Only the external provider is replaced. The application still uses its real adapter.
export async function startMockProvider({ holdPayments = false } = {}) {
  const calls: { amount: number; currency: string; lastFour: string }[] = [];
  let releasePayment!: () => void;
  const heldPayment = new Promise<void>((resolve) => {
    releasePayment = resolve;
  });
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/payments') {
      response.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payment = JSON.parse(Buffer.concat(chunks).toString()) as Payment;
    const lastFour = payment.card_number.slice(-4);
    const callNumber = calls.push({ amount: payment.amount, currency: payment.currency, lastFour });
    response.setHeader('Content-Type', 'application/json');

    if (lastFour === '0002') {
      response
        .writeHead(400)
        .end(JSON.stringify({ error_code: 'CARD_DECLINED', detail: 'Synthetic card declined.' }));
      return;
    }
    if (lastFour === '0003') {
      if (holdPayments) await heldPayment;
      else await delay(3000);
    }
    response.end(
      JSON.stringify({
        transaction_id: `txn_demo_${callNumber}`,
        status: 'completed',
        amount: payment.amount,
        currency: payment.currency,
        last_four_digits: lastFour,
        payment_method: 'credit_card',
        timestamp: new Date().toISOString(),
        merchant_reference: `REF_DEMO_${callNumber}`,
        processing_fee: 25,
      }),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Mock provider did not bind a port.');

  return {
    url: `http://127.0.0.1:${address.port}/v1/payments`,
    calls,
    release: releasePayment,
    async close() {
      releasePayment();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
