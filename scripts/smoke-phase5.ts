/**
 * Smoke test Phase 5 — scheduled report (cron), audit log.
 *   npx tsx scripts/smoke-phase5.ts
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET ?? 'dev-cron-secret';
let cookies = '';

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookies ? { cookie: cookies } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookies = sc.split(';')[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const d = (r: any) => r.json?.data;
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
  console.log(`\nSmoke test Phase 5 -> ${BASE}\n`);

  /* ---------- 1. Pratinjau laporan harian ---------- */
  const preview = await call('GET', '/api/v1/cron/daily-report?preview=1');
  check('pratinjau laporan harian -> 200', preview.status === 200, `got ${preview.status}`);
  const rep = d(preview);
  check('laporan memiliki tanggal', typeof rep?.date === 'string');
  check('laporan omzet terhitung', typeof rep?.omzet === 'number', `got ${rep?.omzet}`);
  check('laporan memiliki highlights', Array.isArray(rep?.highlights) && rep.highlights.length > 0);
  check('laporan 5 menu terlaris', Array.isArray(rep?.produkTerlaris));
  check('laporan posisi keuangan', typeof rep?.snapshot?.netIncome === 'number');
  check('laporan data reservasi', typeof rep?.reservasi?.total === 'number');

  /* ---------- 2. Proteksi cron ---------- */
  const noSecret = await call('POST', '/api/v1/cron/daily-report', {});
  check('cron tanpa secret & tanpa sesi -> 401', noSecret.status === 401, `got ${noSecret.status}`);

  const wrongSecret = await call('POST', '/api/v1/cron/daily-report', {}, { Authorization: 'Bearer salah-total' });
  check('cron dengan secret salah -> 401', wrongSecret.status === 401, `got ${wrongSecret.status}`);

  /* ---------- 3. Jalankan laporan (cron) ---------- */
  // Endpoint cron idempotent per tanggal, jadi picked date harus benar-benar
  // belum punya laporan — jika tidak, smoke test akan gagal bila dijalankan
  // berulang pada database yang sama.
  const auth = { Authorization: `Bearer ${CRON_SECRET}` };
  const history = await call('GET', '/api/v1/cron/daily-report', undefined, auth);
  const used = new Set<string>(
    ((d(history)?.dailySummaries ?? []) as { period: string }[]).map((x) => x.period)
  );

  const date = (() => {
    let day = new Date(Date.UTC(2026, 0, 15));
    for (let i = 0; i < 400; i += 1) {
      const iso = day.toISOString().slice(0, 10);
      if (!used.has(iso)) return iso;
      day = new Date(day.getTime() - 86_400_000);
    }
    return '2026-01-15';
  })();

  const run1 = await call('POST', '/api/v1/cron/daily-report', { date }, auth);
  check('cron dengan secret benar -> 200', run1.status === 200, `got ${run1.status}`);
  check('laporan dibuat', d(run1)?.created === true, JSON.stringify(run1.json).slice(0, 120));
  check('laporan punya id', typeof d(run1)?.id === 'string');

  /* ---------- 4. Idempotensi ---------- */
  const runDate = await call('POST', '/api/v1/cron/daily-report', { date }, auth);
  check('cron dengan tanggal eksplisit tetap idempotent', d(runDate)?.created === false, JSON.stringify(runDate.json).slice(0, 120));

  const run2 = await call('POST', '/api/v1/cron/daily-report', {}, auth);
  const createdToday = d(run2)?.created === true;
  const runToday = await call('POST', '/api/v1/cron/daily-report', {}, auth);
  check(
    'cron kedua tidak membuat duplikat',
    createdToday ? d(runToday)?.created === false : d(run2)?.created === false,
    JSON.stringify(run2.json).slice(0, 120)
  );

  /* ---------- 5. Notifikasi terkirim ---------- */
  await call('POST', '/api/v1/auth/login', { username: 'manager', password: 'manager123' });
  const notif = await call('GET', '/api/v1/notifications');
  const notes = d(notif)?.notifications ?? [];
  check('notifikasi daily_report terkirim', notes.some((n: any) => n.template === 'daily_report'));
  check('isi notifikasi tanpa placeholder', notes.filter((n: any) => n.template === 'daily_report').every((n: any) => !n.body.includes('{{')));

  /* ---------- 6. Riwayat laporan ---------- */
  const exported = await call('GET', '/api/v1/reports/export');
  check('riwayat laporan tersedia', Array.isArray(d(exported)?.history));
  check('daily summary tercatat', (d(exported)?.dailySummaries?.length ?? 0) >= 1, `got ${d(exported)?.dailySummaries?.length}`);
  check(
    'daily summary punya omzet',
    (d(exported)?.dailySummaries?.[0]?.omzet ?? 0) >= 0
  );

  /* ---------- 7. Audit log ---------- */
  const asManager = await call('GET', '/api/v1/audit-logs');
  check('audit log butuh role admin -> manager 403', asManager.status === 403, `got ${asManager.status}`);

  await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'admin123' });
  const audit = await call('GET', '/api/v1/audit-logs');
  check('audit log untuk admin -> 200', audit.status === 200, `got ${audit.status}`);
  const logs = d(audit)?.logs ?? [];
  check('ada log LOGIN', logs.some((l: any) => l.action === 'LOGIN'));
  check('ada log CRON_DAILY_REPORT', logs.some((l: any) => l.action === 'CRON_DAILY_REPORT'));
  check('statistik audit tersedia', Array.isArray(d(audit)?.stats) && d(audit).stats.length > 0);

  const filtered = await call('GET', '/api/v1/audit-logs?action=CRON_DAILY_REPORT');
  const filteredLogs = d(filtered)?.logs ?? [];
  check('filter audit berdasarkan aksi', filteredLogs.every((l: any) => l.action === 'CRON_DAILY_REPORT'));

  /* ---------- 8. Halaman UI ---------- */
  for (const p of ['/reports', '/admin']) {
    const res = await fetch(`${BASE}${p}`, { headers: { cookie: cookies }, redirect: 'manual' });
    check(`halaman ${p} (login admin) -> 200`, res.status === 200, `got ${res.status}`);
  }

  console.log(`\nRingkasan: ${pass} lulus, ${fail} gagal\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Smoke test gagal:', error);
  process.exit(1);
});

export {};