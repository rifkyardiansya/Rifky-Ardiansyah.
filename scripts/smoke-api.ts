/**
 * Smoke test API end-to-end terhadap dev server yang sedang berjalan.
 *   npx tsx scripts/smoke-api.ts
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
let cookies = '';

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookies ? { cookie: cookies } : {}) },
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
  return { status: res.status, json };
}

let pass = 0;
let fail = 0;

function check(label: string, condition: boolean, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  OK   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

const data = (r: { json: unknown }) => (r.json as { data?: unknown })?.data;

async function main() {
  console.log(`\nSmoke test API -> ${BASE}\n`);

  // 1. Halaman publik
  for (const path of ['/', '/customer', '/login', '/kitchen', '/booking']) {
    const res = await fetch(`${BASE}${path}`);
    check(`GET ${path} -> 200`, res.status === 200, `got ${res.status}`);
  }

  // 2. Proteksi middleware
  const guarded = await fetch(`${BASE}/pos`, { redirect: 'manual' });
  check('GET /pos tanpa login -> redirect /login', guarded.status === 307 || guarded.status === 302, `got ${guarded.status}`);

  const reports = await fetch(`${BASE}/api/v1/reports?type=pnl`, { headers: cookies ? { cookie: cookies } : {} });
  check('GET /api/v1/reports tanpa login -> 401', reports.status === 401, `got ${reports.status}`);

  // 3. Scan barcode publik
  const scan = await call('POST', '/api/v1/customer/scan-barcode', { code: 'NT-MEJA01' });
  check('scan barcode meja -> table', (data(scan) as { kind?: string })?.kind === 'table');

  const scanBad = await call('POST', '/api/v1/customer/scan-barcode', { code: 'XXXX' });
  check('scan barcode tak dikenal -> kind invalid', (data(scanBad) as { kind?: string })?.kind === 'invalid');

  // 4. Login
  const badLogin = await call('POST', '/api/v1/auth/login', { username: 'kasir', password: 'passwordsalah' });
  check('login password salah -> 401', badLogin.status === 401, `got ${badLogin.status}`);

  const login = await call('POST', '/api/v1/auth/login', { username: 'kasir', password: 'kasir123' });
  check('login kasir -> session', Boolean(data(login)), JSON.stringify(login.json).slice(0, 120));
  check('login kasir -> role cashier', (data(login) as { role?: string })?.role === 'cashier');

  const me = await call('GET', '/api/v1/auth/me');
  check('GET /auth/me -> user', Boolean((data(me) as { user?: unknown })?.user));

  // 5. Snapshot
  const snap = await call('GET', '/api/v1/snapshot');
  const snapshot = data(snap) as { menuItems?: unknown[]; tables?: unknown[]; orders?: unknown[] };
  check('snapshot berisi 8 menu', snapshot?.menuItems?.length === 8, `got ${snapshot?.menuItems?.length}`);
  check('snapshot berisi 10 meja', snapshot?.tables?.length === 10, `got ${snapshot?.tables?.length}`);

  // 6. POS transaksi
  const beforeOrders = (snapshot?.orders?.length ?? 0);
  const trx = await call('POST', '/api/v1/pos/transactions', {
    tableNumber: 'Meja 03',
    customerName: 'Smoke Test',
    source: 'pos_cashier',
    paymentMethod: 'cash',
    cashReceived: 200000,
    items: [
      { menuItemId: 'menu-2', quantity: 2, notes: 'Pedas' },
      { menuItemId: 'menu-6', quantity: 2 },
    ],
  });
  check('POST /pos/transactions -> 201', trx.status === 201, JSON.stringify(trx.json).slice(0, 160));
  const trxData = data(trx) as { total?: number; cogs?: number; orderNo?: string };
  check('total transaksi > 0', (trxData?.total ?? 0) > 0);
  check('HPP terhitung dari resep', (trxData?.cogs ?? 0) > 0);

  const receipt = await call('GET', `/api/v1/pos/receipt/${trxData?.orderNo}`);
  const rc = data(receipt) as { order?: { items?: unknown[]; total?: number }; store?: { name?: string } };
  check('struk berisi 2 item', rc?.order?.items?.length === 2, `got ${rc?.order?.items?.length}`);
  check('struk memuat nama usaha', rc?.store?.name === 'Restoran Nusantara');

  // 7. Z-Report / session
  const session = await call('GET', '/api/v1/pos/session');
  check('sesi kasir terbuka', Boolean((data(session) as { session?: unknown })?.session));

  // 8. Role kasir tidak boleh manage stok
  const poAsCashier = await call('POST', '/api/v1/inventory/purchase-orders', {
    supplierId: 'sup-1',
    items: [{ rawMaterialId: 'raw-1', quantity: 5 }],
  });
  check('RBAC: kasir tidak boleh buat PO -> 403', poAsCashier.status === 403, `got ${poAsCashier.status}`);

  // 9. Login manager & test inventory
  cookies = '';
  const mgrLogin = await call('POST', '/api/v1/auth/login', { username: 'manager', password: 'manager123' });
  check('login manager -> role manager', (data(mgrLogin) as { role?: string })?.role === 'manager');

  const po = await call('POST', '/api/v1/inventory/purchase-orders', {
    supplierId: 'sup-1',
    items: [{ rawMaterialId: 'raw-2', quantity: 20 }],
    notes: 'Smoke test',
  });
  check('manager buat PO -> 201', po.status === 201, JSON.stringify(po.json).slice(0, 140));
  const poData = data(po) as { id?: string; poNumber?: string; totalCost?: number };

  const inv = await call('GET', '/api/v1/inventory');
  const beforeQty = ((data(inv) as { materials?: { id: string; currentStock: number }[] })?.materials ?? []).find(
    (m) => m.id === 'raw-2'
  )?.currentStock;

  const grn = await call('POST', `/api/v1/inventory/purchase-orders/${poData?.id}/receive`);
  check('terima barang (GRN) -> 200', grn.status === 200, JSON.stringify(grn.json).slice(0, 140));

  const inv2 = await call('GET', '/api/v1/inventory');
  const afterQty = ((data(inv2) as { materials?: { id: string; currentStock: number }[] })?.materials ?? []).find(
    (m) => m.id === 'raw-2'
  )?.currentStock;
  check('stok naik 20 setelah GRN', Math.abs((afterQty ?? 0) - (beforeQty ?? 0) - 20) < 0.001, `${beforeQty} -> ${afterQty}`);

  const grnAgain = await call('POST', `/api/v1/inventory/purchase-orders/${poData?.id}/receive`);
  check('GRN ganda ditolak -> 409', grnAgain.status === 409, `got ${grnAgain.status}`);

  // Penyesuaian stok harus repeatable: delta dikembalikan setelah dicek agar
  // jumlah stok akhir tidak berubah setiap kali smoke test dijalankan.
  const inv3 = await call('GET', '/api/v1/inventory');
  const coffeeQty = ((data(inv3) as { materials?: { id: string; currentStock: number }[] })?.materials ?? []).find(
    (m) => m.id === 'raw-6'
  )?.currentStock ?? 0;
  const adjustDelta = coffeeQty >= 1 ? -1 : 1;

  const adjust = await call('POST', '/api/v1/inventory/stock-adjustments', {
    rawMaterialId: 'raw-6',
    delta: adjustDelta,
    reason: 'Rusak (smoke test)',
  });
  check('penyesuaian stok -> 200', adjust.status === 200, JSON.stringify(adjust.json).slice(0, 140));

  const revert = await call('POST', '/api/v1/inventory/stock-adjustments', {
    rawMaterialId: 'raw-6',
    delta: -adjustDelta,
    reason: 'Koreksi smoke test',
  });
  check('pengembalian stok -> 200', revert.status === 200, JSON.stringify(revert.json).slice(0, 140));

  const adjustBad = await call('POST', '/api/v1/inventory/stock-adjustments', {
    rawMaterialId: 'raw-6',
    delta: -99999,
    reason: 'Salah input test',
  });
  check('kurangi melebihi stok -> 422', adjustBad.status === 422, `got ${adjustBad.status}`);

  // 10. Booking
  const avail = await call('GET', '/api/v1/booking/availability?date=2027-01-15&partySize=4');
  const av = data(avail) as { slots?: { timeSlot: string; availableTables: number }[]; tables?: unknown[] };
  check('availability mengembalikan slot', (av?.slots?.length ?? 0) === 5, `got ${av?.slots?.length}`);

  const tableId = ((av?.tables ?? []) as { id: string; available: boolean }[]).find((t) => t.available)?.id;
  const booking = await call('POST', '/api/v1/booking', {
    guestName: 'Smoke Tamu',
    guestPhone: '08123456789',
    guestEmail: 'smoke@test.id',
    partySize: 4,
    date: '2027-01-15',
    timeSlot: '19:00 - 21:00',
    tableId,
    packagePrice: 300000,
  });
  check('buat reservasi -> 201', booking.status === 201, JSON.stringify(booking.json).slice(0, 160));
  const bkData = data(booking) as { bookingCode?: string; depositAmount?: number; qrToken?: string };
  check('deposit = 25% paket (75.000)', bkData?.depositAmount === 75000, `got ${bkData?.depositAmount}`);
  check('QR token terbentuk', Boolean(bkData?.qrToken));

  const clash = await call('POST', '/api/v1/booking', {
    guestName: 'Smoke Bentrok',
    guestPhone: '08123456788',
    partySize: 4,
    date: '2027-01-15',
    timeSlot: '19:00 - 21:00',
    tableId,
    packagePrice: 0,
  });
  check('booking bentrok -> 409', clash.status === 409, `got ${clash.status}`);

  const payDep = await call('POST', `/api/v1/booking/${bkData?.bookingCode}/payment`, { method: 'qris' });
  check('terima deposit -> 200', payDep.status === 200, JSON.stringify(payDep.json).slice(0, 140));

  const checkin = await call('PATCH', `/api/v1/booking/${bkData?.bookingCode}`, { status: 'checked_in' });
  check('check-in -> 200', checkin.status === 200, JSON.stringify(checkin.json).slice(0, 140));

  const cancel = await call('PATCH', `/api/v1/booking/${bkData?.bookingCode}`, { status: 'cancelled' });
  check('pembatalan -> 200', cancel.status === 200, JSON.stringify(cancel.json).slice(0, 140));

  // 11. Laporan keuangan
  const pnl = await call('GET', '/api/v1/reports?type=pnl');
  const pnlData = data(pnl) as { revenue?: number; netIncome?: number };
  check('P&L revenue > 0', (pnlData?.revenue ?? 0) > 0);

  const bs = await call('GET', '/api/v1/reports?type=balance-sheet');
  const bsData = data(bs) as { balanced?: boolean };
  check('Neraca seimbang', bsData?.balanced === true);

  const ledger = await call('GET', '/api/v1/reports?type=ledger');
  const ledgerData = data(ledger) as { balanced?: boolean; totals?: { debit: number; credit: number } };
  check('Buku besar seimbang (debit = kredit)', ledgerData?.balanced === true,
    ledgerData?.totals ? `${ledgerData.totals.debit} vs ${ledgerData.totals.credit}` : '');

  const tax = await call('GET', '/api/v1/reports?type=tax');
  check('laporan PPN ada', Array.isArray((data(tax) as { rows?: unknown[] })?.rows));

  const valuation = await call('GET', '/api/v1/reports?type=valuation');
  check('valuasi persediaan ada', ((data(valuation) as { rows?: unknown[] })?.rows?.length ?? 0) > 0);

  const trial = await call('GET', '/api/v1/reports?type=trial-balance');
  const trialData = data(trial) as { totalDebit?: number; totalCredit?: number };
  check('trial balance seimbang', trialData?.totalDebit === trialData?.totalCredit,
    `${trialData?.totalDebit} vs ${trialData?.totalCredit}`);

  const exportRep = await call('POST', '/api/v1/reports/export', {
    reportType: 'pnl',
    period: '2026-10',
    format: 'pdf',
  });
  check('ekspor laporan -> 201', exportRep.status === 201, JSON.stringify(exportRep.json).slice(0, 140));

  // 12. Validasi input (Zod)
  const invalid = await call('POST', '/api/v1/pos/transactions', {
    tableNumber: 'Meja 03',
    customerName: '',
    source: 'pos_cashier',
    items: [],
  });
  check('validasi Zod menolak payload buruk -> 422', invalid.status === 422, `got ${invalid.status}`);

  // 13. Status order (KDS)
  const snap2 = data(await call('GET', '/api/v1/snapshot')) as { orders?: { id: string; status: string }[] };
  const pending = snap2?.orders?.find((o) => o.status === 'pending');
  if (pending) {
    const st = await call('PATCH', `/api/v1/orders/${pending.id}`, { status: 'cooking' });
    check('KDS ubah status pesanan -> 200', st.status === 200, JSON.stringify(st.json).slice(0, 120));
  } else {
    check('KDS ubah status pesanan -> ada order pending', false, 'tidak ada order pending');
  }

  console.log(`\nRingkasan: ${pass} lulus, ${fail} gagal\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Smoke test gagal dijalankan:', error);
  process.exit(1);
});

export {};
