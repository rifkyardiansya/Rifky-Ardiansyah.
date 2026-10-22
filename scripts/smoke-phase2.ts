/**
 * Smoke test Phase 2: payment gateway, webhook, notifikasi, PDF, SSE.
 *   npx tsx scripts/smoke-phase2.ts
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
let cookies = '';

async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookies ? { cookie: cookies } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookies = setCookie.split(';')[0];
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, json: json as { success?: boolean; data?: unknown; error?: string } };
}

const data = (r: { json: { data?: unknown } }) => r.json.data as Record<string, unknown>;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = '') {
  if (ok) {
    pass += 1;
    console.log(`  OK   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

async function main() {
  console.log(`\nSmoke test Phase 2 -> ${BASE}\n`);

  /* ---------- 1. Halaman ---------- */
  for (const p of ['/pay/tidak-ada', '/login', '/customer', '/kitchen', '/booking']) {
    const res = await fetch(`${BASE}${p}`);
    check(`GET ${p} -> 200`, res.status === 200, `got ${res.status}`);
  }
  for (const p of ['/notifications', '/admin']) {
    const res = await fetch(`${BASE}${p}`, { redirect: 'manual' });
    check(`GET ${p} tanpa login -> redirect`, res.status === 307 || res.status === 302, `got ${res.status}`);
  }

  /* ---------- 2. SSE ---------- */
  const sse = await fetch(`${BASE}/api/v1/events`, { headers: { accept: 'text/event-stream' } });
  check('SSE /events -> text/event-stream', sse.headers.get('content-type')?.includes('text/event-stream') === true, sse.headers.get('content-type') ?? '');
  const sseReader = sse.body?.getReader();
  const sseChunk = await Promise.race([
    sseReader?.read(),
    new Promise<null>((r) => setTimeout(() => r(null), 4000)),
  ]);
  const sseText = sseChunk && 'value' in sseChunk ? new TextDecoder().decode(sseChunk.value) : '';
  check('SSE mengirim event awal "connected"', sseText.includes('connected'), sseText.slice(0, 80));

  /* ---------- 3. Login kasir ---------- */
  await call('POST', '/api/v1/auth/login', { username: 'kasir', password: 'kasir123' });
  const me = await call('GET', '/api/v1/auth/me');
  check('login kasir berhasil', (data(me) as { user?: { role?: string } })?.user?.role === 'cashier');

  /* ---------- 4. Buat order belum lunas ---------- */
  const trx = await call('POST', '/api/v1/pos/transactions', {
    tableNumber: 'Meja 06',
    customerName: 'Smoke Payment',
    source: 'pos_cashier',
    items: [
      { menuItemId: 'menu-3', quantity: 1 },
      { menuItemId: 'menu-5', quantity: 2 },
    ],
  });
  check('order tanpa pembayaran -> 201 & unpaid', trx.status === 201, `got ${trx.status}`);
  const order = data(trx) as { id: string; orderNo: string; total: number };
  check('order tercatat unpaid', (order as unknown as Record<string, unknown>).paymentStatus === 'unpaid');

  /* ---------- 5. Payment intent ---------- */
  const intentRes = await call('POST', '/api/v1/payment', { refType: 'order', refId: order.orderNo, method: 'debit' });
  check('POST /payment -> 201', intentRes.status === 201, JSON.stringify(intentRes.json).slice(0, 140));
  const intent = data(intentRes) as { token: string; externalId: string; total: number; fee: number; redirectUrl: string };
  check('payment intent punya token & redirectUrl', Boolean(intent.token) && intent.redirectUrl.startsWith('/pay/'));
  check('biaya admin debit = 2.500', intent.fee === 2500, `got ${intent.fee}`);

  const intentSame = await call('POST', '/api/v1/payment', { refType: 'order', refId: order.orderNo, method: 'qris' });
  const qrisIntent = data(intentSame) as { qrPayload: string | null; total: number };
  check('QRIS menghasilkan payload EMVCo', Boolean(qrisIntent.qrPayload?.startsWith('000201')), qrisIntent.qrPayload ?? 'null');

  const getIntent = await call('GET', `/api/v1/payment/${intent.token}`);
  check('GET /payment/:token -> intent ditemukan', getIntent.status === 200, `got ${getIntent.status}`);

  const badToken = await call('GET', '/api/v1/payment/token-hantu');
  check('GET /payment/:token tidak valid -> 404', badToken.status === 404, `got ${badToken.status}`);

  /* ---------- 6. Webhook signature ---------- */
  const webhookPayload = {
    provider: 'midtrans',
    externalId: intent.externalId,
    eventType: 'payment',
    transactionStatus: 'capture',
    amount: intent.total,
  };

  const forged = await call('POST', '/api/v1/webhooks/payment-gateway', webhookPayload, { 'x-webhook-signature': 'signature-palsu' });
  check('webhook signature salah -> 401 ditolak', forged.status === 401, `got ${forged.status}`);
  check('status webhook forged = rejected', (data(forged) as { status?: string })?.status === 'rejected');

  const signRes = await call('POST', '/api/v1/webhooks/payment-gateway/sign', webhookPayload);
  const signature = (data(signRes) as { signature: string })?.signature;
  check('endpoint sign membuat signature valid', typeof signature === 'string' && signature.length === 128, `len ${signature?.length}`);

  const paid = await call('POST', '/api/v1/webhooks/payment-gateway', webhookPayload, { 'x-webhook-signature': signature });
  check('webhook valid -> 200', paid.status === 200, JSON.stringify(paid.json).slice(0, 140));
  check('status webhook = paid', (data(paid) as { status?: string })?.status === 'paid');

  const dup = await call('POST', '/api/v1/webhooks/payment-gateway', webhookPayload, { 'x-webhook-signature': signature });
  check('webhook duplikat terdeteksi', (data(dup) as { duplicate?: boolean })?.duplicate === true);
  check('duplikat tidak menandai paid ulang', (data(dup) as { status?: string })?.status === 'already_processed');

  const snap = await call('GET', '/api/v1/snapshot');
  const orders = (data(snap) as { orders: { orderNo: string; paymentStatus: string; total: number }[] }).orders;
  const updated = orders.find((o) => o.orderNo === order.orderNo);
  check('order menjadi lunas setelah webhook', updated?.paymentStatus === 'paid', updated?.paymentStatus ?? 'tidak ditemukan');

  /* ---------- 7. Jurnal tetap seimbang ---------- */
  await call('POST', '/api/v1/auth/login', { username: 'manager', password: 'manager123' });
  const ledger = await call('GET', '/api/v1/reports?type=ledger');
  const ledgerData = data(ledger) as { balanced: boolean; totals: { debit: number; credit: number } };
  check('buku besar tetap seimbang', ledgerData.balanced, `${ledgerData.totals.debit} vs ${ledgerData.totals.credit}`);

  const bs = await call('GET', '/api/v1/reports?type=balance-sheet');
  check('neraca tetap seimbang', (data(bs) as { balanced: boolean })?.balanced === true);

  /* ---------- 8. Receipt PDF ---------- */
  const pdfRes = await fetch(`${BASE}/api/v1/pos/receipt/${order.orderNo}/pdf`, { headers: { cookie: cookies } });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  check('struk PDF -> 200 & application/pdf', pdfRes.status === 200 && pdfRes.headers.get('content-type') === 'application/pdf', `got ${pdfRes.status}`);
  check('PDF valid (header %PDF-)', pdfBuf.slice(0, 5).toString('latin1') === '%PDF-', pdfBuf.slice(0, 8).toString('latin1'));
  check('PDF berukuran wajar (>1KB)', pdfBuf.length > 1000, `${pdfBuf.length} bytes`);
  check('header unduhan PDF benar', (pdfRes.headers.get('content-disposition') ?? '').includes('attachment'));

  const pdfMissing = await fetch(`${BASE}/api/v1/pos/receipt/ORD-TIDAK-ADA/pdf`, { headers: { cookie: cookies } });
  check('struk PDF tidak ditemukan -> 404', pdfMissing.status === 404, `got ${pdfMissing.status}`);

  /* ---------- 9. Notifikasi ---------- */
  const notifications = await call('GET', '/api/v1/notifications');
  check('GET /notifications -> 200', notifications.status === 200, `got ${notifications.status}`);
  const nData = data(notifications) as {
    notifications: { template: string; status: string; body: string }[];
    stats: { sent: number; failed: number };
  };
  check('outbox terisi', nData.notifications.length > 0, `${nData.notifications.length} pesan`);
  check('ada pesan payment_received', nData.notifications.some((n) => n.template === 'payment_received'));
  check('ada pesan order_received', nData.notifications.some((n) => n.template === 'order_received'));
  check('semua pesan tidak leftover template', nData.notifications.every((n) => !n.body.includes('{{')));
  check('statistik > 0', nData.stats.sent > 0, `sent=${nData.stats.sent}`);

  /* ---------- 10. RBAC ---------- */
  // Outbox berisi data kontak pelanggan -> dikunci untuk manager ke atas.
  await call('POST', '/api/v1/auth/login', { username: 'kasir', password: 'kasir123' });
  const notifAsCashier = await call('GET', '/api/v1/notifications');
  check('RBAC: kasir tidak boleh baca outbox -> 403', notifAsCashier.status === 403, `got ${notifAsCashier.status}`);

  await call('POST', '/api/v1/auth/login', { username: 'customer', password: 'customer123' });
  const notifAsCustomer = await call('GET', '/api/v1/notifications');
  check('RBAC: customer tidak boleh baca notifikasi -> 403', notifAsCustomer.status === 403, `got ${notifAsCustomer.status}`);

  /* ---------- 11. Halaman notifikasi ---------- */
  await call('POST', '/api/v1/auth/login', { username: 'manager', password: 'manager123' });
  const page = await fetch(`${BASE}/notifications`, { headers: { cookie: cookies }, redirect: 'manual' });
  check('halaman /notifications (login manager) -> 200', page.status === 200, `got ${page.status}`);

  sseReader?.cancel();

  console.log(`\nRingkasan: ${pass} lulus, ${fail} gagal\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Smoke test gagal:', error);
  process.exit(1);
});

export {};
