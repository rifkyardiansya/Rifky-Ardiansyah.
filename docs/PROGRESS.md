# Status Proyek — Restoran Nusantara

> Berkas ini adalah **catatan progres** proyek: apa yang sudah selesai, bagaimana
> cara menjalankan & mengujinya, bug apa saja yang sudah ditemukan, dan apa
> rencana selanjutnya.
>
> Terakhir diperbarui: **16 Oktober 2026** · Status: **Phase 7 (sederhana) selesai** ✅

---

## 1. Ringkasan

| Aspek | Keterangan |
|---|---|
| Nama | Restoran Nusantara — Sistem Informasi Restoran Terintegrasi |
| Tujuan | Prototype tugas Pemrograman Web semester 3 |
| Modul | 5 modul utama + payment gateway + notifikasi + panel admin |
| Stack | Next.js 14 (App Router) · TypeScript · Tailwind CSS · SQLite (better-sqlite3) |
| Auth | JWT HS256 + scrypt + RBAC 4 role |
| Realtime | Server-Sent Events (SSE) |
| Infrastruktur | Redis opsional (rate limiter + antrean job + dead-letter), otomatis fallback in-memory |
| Testing | 70 unit/integration test · 116 smoke test API check · 43 E2E test Playwright |
| Status build | ✅ `npm run build` sukses, 0 error TypeScript |
| Deployment | ✅ Dockerfile 3 tahap, docker-compose (app + worker + PostgreSQL + Redis + MinIO), Nginx TLS, GitHub Actions CI/CD |
| PWA | ✅ Install prompt, keranjang IndexedDB, antrean offline, push notification, halaman offline |

---

## 2. Cara Menjalankan

```bash
npm install       # pasang dependency
npm run db:seed   # buat & isi database dengan data demo
npm run dev       # jalankan → http://localhost:3000
```

> Database juga ter-seed otomatis saat aplikasi diakses pertama kali.

### Akun Demo

| Username | Password | Role | Halaman yang boleh diakses |
|---|---|---|---|
| `admin` | `admin123` | Administrator | Semua + `/admin` |
| `manager` | `manager123` | Manager | Semua modul + `/reports`, `/notifications`, `/inventory` |
| `kasir` | `kasir123` | Kasir | `/pos`, `/kitchen`, `/booking`, `/reports` (cek UID) |
| `customer` | `customer123` | Customer | `/customer`, `/kitchen`, `/booking` |

Halaman `/`, `/customer`, `/kitchen`, `/booking`, `/login`, `/pay/[token]` **publik** (tanpa login).

### Perintah Penting

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server pengembangan |
| `npm run build` / `npm start` | Build & jalankan versi produksi |
| `npm run typecheck` | Cek tipe TypeScript (strict) |
| `npm run lint` | ESLint (`next/core-web-vitals`) |
| `npm run test` | 67 unit/integration test (vitest) |
| `npm run worker` | Worker antrean job + penjadwal (butuh `REDIS_URL`) |
| `npm run redis:fake` | Redis palsu in-process — mencoba jalur Redis tanpa Docker |
| `npm run demo:dead-letter` | Job demo yang pasti gagal untuk memperagakan dead-letter queue |
| `npm run smoke` | 47 smoke test API end-to-end (butuh dev server) |
| `npm run smoke:phase2` | 42 smoke test payment/notifikasi/PDF/SSE |
| `npm run smoke:phase5` | 27 smoke test laporan terjadwal & audit log |
| `npm run test:e2e` | 41 E2E test Playwright (build + `next start` otomatis, DB terpisah) |
| `npm run db:seed` | Isi data awal |
| `npm run db:status` | Ringkasan isi database + cek keseimbangan jurnal |
| `npm run db:reset` | Kosongkan & buat ulang database |

> ⚠️ `db:reset` **harus dijalankan saat dev server berhenti** (Windows mengunci file DB).
> Bila terkunci, skrip otomatis beralih ke mode truncate + seed ulang.

---

## 3. Yang Sudah Selesai

### Phase 1 — Foundation ✅
- [x] Project Next.js 14 + TypeScript strict + Tailwind CSS
- [x] **17 → 20 tabel database** (`src/server/db/schema.sql`)
- [x] Migration runner idempotent (ALTER TABLE guarded oleh PRAGMA)
- [x] Seed CLI + data demo realistis (8 menu, 10 meja, 8 bahan baku, 3 supplier)
- [x] **REST API 38 route** (37 endpoint di `/api/v1` + `/api/health`) sesuai blueprint §5 (`src/app/api/**`)
- [x] **Auth**: scrypt password hashing, JWT HS256 (jose), RBAC 4 role
- [x] **Middleware** proteksi halaman (`src/middleware.ts`)
- [x] Halaman login + panel admin
- [x] Validasi Zod di seluruh endpoint
- [x] Barcode scanner kamera (html5-qrcode / ZXing)

### Phase 3 — DevOps & Production Readiness ✅
- [x] **Security headers** — CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy
- [x] **Rate limiting** — sliding window: login 5× gagal/5 mnt, POS 30/mnt, webhook 120/mnt (counter direset setelah login berhasil)
- [x] **Health check** `/api/health` — DB, **keseimbangan jurnal**, subscriber SSE, memori, uptime
- [x] **Auto-migration + auto-seed saat koneksi pertama** — `schema.sql` (DDL idempotent) + `runMigrations()` (ALTER TABLE guarded PRAGMA) dijalankan di `createConnection()`, sehingga container baru siap menerima traffic tanpa `db:seed` manual (`src/server/db/client.ts:27`)
- [x] **Dockerfile 3 tahap** — non-root user, healthcheck, standalone output, volume data
- [x] **docker-compose** — app + PostgreSQL 16 + Redis 7 + MinIO; override produksi dengan resource limit
- [x] **Nginx** — TLS termination, gzip, cache statis, rate limit, SSE passthrough (buffering off)
- [x] **ESLint** — `next/core-web-vitals`, 0 warning/error
- [x] **GitHub Actions CI** — typecheck → lint → test → build → smoke test (Phase 1/2/5) → E2E Playwright → Docker build → Trivy scan
- [x] **GitHub Actions CD** — deploy VPS via SSH + health check + verifikasi

### Phase 4 — PWA & Offline ✅
- [x] **IndexedDB via Dexie** — keranjang tersimpan per meja, bertahan setelah browser ditutup
- [x] **Antrean pesanan offline** — pesanan saat offline diantre, dikirim otomatis saat koneksi kembali
- [x] **Install prompt** — event `beforeinstallprompt`, tombol "Pasang ke Home Screen"
- [x] **Push notification** — izin notifikasi + handler `push`/`notificationclick` di service worker
- [x] **Halaman `/offline`** — fallback saat seluruh jaringan & cache gagal
- [x] **Service worker** (v3) — network-first untuk halaman, cache-first untuk aset, stale-while-revalidate untuk gambar, API selalu network-only
- [x] **Ikon PWA 192 & 512 px** — di-generate tanpa dependency (`scripts/generate-icons.js`)
- [x] **Panel PWA** — indikator online/offline, jumlah antrean, status instalasi

### 5 Modul Utama ✅
1. **Customer Portal** (`/customer`) — scan barcode meja, katalog, keranjang, checkout, struk, tracking
2. **POS / Kasir** (`/pos`) — shift kasir, transaksi, void, Z-Report, struk 80mm + PDF
3. **Kitchen Display** (`/kitchen`) — 3 kolom status, timer, realtime via SSE
4. **Reservasi** (`/booking`) — ketersediaan slot, denah, 4 paket, deposit 25%, QR e-ticket, check-in, refund
5. **Stok & Bahan Baku** (`/inventory`) — alert menipis/kedaluwarsa, PO, GRN (moving average), stock opname, resep HPP
6. **Laporan Keuangan** (`/reports`) — P&L, Neraca, Arus Kas, penjualan, Buku Besar, PPN, ekspor CSV

### Phase 2 — Payment, Notifikasi, Realtime ✅
- [x] **Payment Gateway** — payment intent, redirect URL, halaman `/pay/[token]`
- [x] **Webhook terverifikasi** HMAC-SHA512 (timing-safe) + **idempotensi**
- [x] **QRIS payload EMVCo** dengan CRC16-CCITT
- [x] 5 channel: QRIS, Debit, Kredit, Virtual Account, Tunai
- [x] **Struk PDF 80mm** via pdf-lib (`/api/v1/pos/receipt/:id/pdf`)
- [x] **Notifikasi outbox** — 7 template (email/SMS/WhatsApp)
- [x] Halaman monitor `/notifications` (outbox + gateway + webhook log)
- [x] **Realtime SSE** (`/api/v1/events`) dengan heartbeat & auto-reconnect
- [x] Event bus in-process (`src/server/realtime/bus.ts`)

### Phase 5 — Laporan Terjadwal, Audit Log & E2E ✅
- [x] **Laporan penjualan harian terjadwal** (`src/server/services/schedule.service.ts`) — ringkasan omzet, transaksi, 5 menu terlaris, posisi keuangan (laba bersih, pajak terutang, nilai persediaan), data reservasi
- [x] **Endpoint cron** `/api/v1/cron/daily-report` — dilindungi shared secret (`CRON_SECRET`, timing-safe) atau sesi manager; **idempotent per tanggal** agar tidak mengirim notifikasi ganda
- [x] **Notifikasi `daily_report`** otomatis ke manager setelah laporan dibuat
- [x] **Audit log** `/api/v1/audit-logs` — LOGIN, CRON_DAILY_REPORT, dkk. + filter per aksi & statistik; hanya admin
- [x] **Panel laporan terjadwal** di `/reports` (`src/components/ScheduledReportPanel.tsx`)
- [x] **E2E test Playwright** 41 test lintas 5 modul (`tests/e2e/`) — server produksi dijalankan otomatis, DB terpisah (`data/e2e-restoran.db`)
- [x] **Health check** `/api/health` diperluas (jurnal, subscriber SSE, memori, uptime)

### Phase 6 — Redis, Antrean Job & Worker Terjadwal ✅
- [x] **Klien Redis RESP2 tanpa dependency** (`src/server/infra/redis.ts`) — lazy connect, reconnect exponential backoff, AUTH/SELECT, timeout per perintah, backpressure aman; tetap bisa dijalankan tanpa Docker
- [x] **Rate limiter terpusat** (`src/server/infra/kv.ts`) — sliding window via sorted set (ZADD/ZREMRANGEBYSCORE/ZCARD + TTL), berlaku lintas instance; fallback otomatis ke Map in-memory bila Redis mati
- [x] **Antrean job** (`src/server/queue/queue.ts`) — pola *reliable queue*: `LPUSH pending` → `BRPOPLPUSH active` → `LREM` saat selesai, sehingga job tidak hilang saat worker mati; percobaan ulang (`maxAttempts`) dan statistik
- [x] **Penjadwal job berulang** (`src/server/queue/scheduler.ts`) — laporan harian 23:00 WIB, retry outbox tiap 5 menit; state `nextRunAt` disimpan di Redis (tahan restart)
- [x] **Job outbox notifikasi** — notifikasi yang menggantung di status `queued` dikirim ulang (mis. proses mati di tengah pengiriman)
- [x] **Proses worker** (`npm run worker`, `scripts/worker.ts`) + service `worker` di docker-compose; heartbeat ber-TTL sehingga endpoint cron tahu apakah ada worker hidup
- [x] **Endpoint cron memakai antrean** — membalas `202` bila job diantrekan ke worker, `200` dengan hasil lengkap bila dieksekusi inline
- [x] **Health check** `/api/health` melaporkan status Redis & antrean (tetap `healthy` bila Redis mati, karena aplikasi degrade dengan aman)
- [x] **Test Phase 6** 33 test — klien RESP, rate limiter (in-memory ≡ Redis), antrean, worker, penjadwal, dan integrasi schedule→job→laporan harian; memakai **fake Redis in-process** (`tests/helpers/fake-redis.ts`) sehingga tidak perlu Redis di CI
- [x] **`npm run redis:fake`** (`scripts/dev-fake-redis.ts`) — menjalankan server RESP di port tetap agar jalur Redis bisa dicoba tanpa memasang Redis/Docker
- [x] **CI** menjalankan smoke test dengan `REDIS_URL` aktif agar rate limiter Redis ikut terverifikasi di jalur produksi

### Phase 7 — Dead-Letter Queue & Monitoring Antrean ✅
- [x] **Backoff eksponensial** saat retry (250 ms → 500 ms → 1 s, dibatasi 5 s) — tanpa jeda, job yang gagal karena masalah sementara justru membebani sistem saat ia tidak sehat
- [x] **Dead-letter queue** (`src/server/queue/queue.ts`) — job yang habis percobaan disimpan beserta penyebab, percobaan, dan waktunya; tidak hilang diam-diam
- [x] **Tindakan atas dead-letter** — `retryDeadLetter()` (antrekan ulang setelah masalah diperbaiki) dan `purgeDeadLetter()` (buang yang tidak mungkin berhasil), tersedia di Redis & in-memory
- [x] **Riwayat pekerjaan** — 100 hasil eksekusi terakhir untuk kebutuhan monitoring
- [x] **Endpoint monitoring** `GET/POST/DELETE /api/v1/admin/queue` — statistik antrean, status Redis, status worker, dead-letter, riwayat, dan jadwal berikutnya (khusus admin)
- [x] **Panel "Antrean & Worker"** di `/admin` (`src/components/QueuePanel.tsx`) — backend antrean, status worker, angka antrean, tabel dead-letter, riwayat, dan jadwal otomatis; peringatan bila worker mati
- [x] **Kegagalan inline tidak lagi diam-diam** — `runDailyReportJob` melempar error bila job inline gagal (sebelumnya endpoint cron bisa membalas 200 dengan data kosong), dan tetap mencatat ke dead-letter
- [x] **Test** 3 test baru (dead-letter requeue/purge, riwayat, backoff) + 2 E2E test panel antrean
- [x] **`npm run demo:dead-letter`** — membuat job yang pasti gagal untuk memperagakan siklus "gagal → antrekan ulang → buang" saat presentasi
- [x] **Known issue E2E diperbaiki di akarnya** — DB E2E direset tiap run, tabel buku besar dibatasi 200 baris (TOTAL tetap dari seluruh jurnal), `db:reset` tidak lagi menghapus seluruh folder `data/`

### Cakupan RBAC
| Halaman / Endpoint | customer | kasir | manager | admin |
|---|---|---|---|---|
| `/customer`, `/booking`, `/kitchen`, `/pay/[token]` | ✅ | ✅ | ✅ | ✅ |
| `/pos`, `/reports`, `/inventory`, `/booking` (cek UID) | ❌ | ✅ | ✅ | ✅ |
| `/notifications`, `/api/v1/notifications` | ❌ | ❌ | ✅ | ✅ |
| void transaksi, PO/GRN/stock opname | ❌ | ❌ | ✅ | ✅ |
| `/admin`, `/api/v1/audit-logs` | ❌ | ❌ | ❌ | ✅ |
| `/api/v1/admin/queue` (panel antrean & dead-letter) | ❌ | ❌ | ❌ | ✅ |
| `/api/v1/cron/daily-report` | ❌ | ❌ | ✅ | ✅ |

> Outbox notifikasi memuat nama/email/telepon pelanggan, jadi dikunci `manager` ke atas
> (verified `scripts/smoke-phase2.ts`).

---

## 3b. Status Verifikasi (hasil run terakhir)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | ✅ 0 error |
| `npm run lint` | ✅ 0 warning / 0 error |
| `npm test` | ✅ 70 / 70 lulus |
| `npm run build` | ✅ sukses, semua route ter-render |
| `npm run smoke` | ✅ 47 / 47 |
| `npm run smoke:phase2` | ✅ 42 / 42 |
| `npm run smoke:phase5` | ✅ 27 / 27 |
| `npm run test:e2e` | ✅ 43 / 43 (4× berturut-turut, DB direset tiap run) |

---

## 4. Daftar Bug yang Sudah Diperbaiki

Semua ditemukan oleh test suite / smoke test, dan sekarang punya **regression test**.

| # | Bug | Dampak | Perbaikan |
|---|---|---|---|
| 1 | `getDb()` membuat koneksi DB baru di setiap panggilan | **"database is locked"** — transaksi gagal | Koneksi di-cache pada `globalThis`, plus `busy_timeout` |
| 2 | Void transaksi: Dr saja tanpa Cr | Jurnal tidak seimbang | Dr Beban Operasional / Cr Kas |
| 3 | Stock opname: Dr saja saat stok berkurang | Jurnal tidak seimbang | Dr Beban / Cr Persediaan (atau sebaliknya) |
| 4 | Refund deposit: debit/kredit terbalik | **Liabilitas bertambah** saat pembatalan | Dr Liabilitas / Cr Kas / Cr Pendapatan penalti |
| 5 | Nilai stok seed ≠ jurnal pembuka | **Neraca tidak seimbang** | Jurnal pembuka dihitung dari nilai fisiknya (`sum(quantity × unit_cost)`) |
| 6 | Stok dipotong untuk order **belum dibayar** | Persediaan fisik ≠ buku | Stok dipotong hanya saat lunas, bersamaan dengan pencatatan HPP |
| 7 | **Webhook palsu memblokir pembayaran sah** | Denial of Service pada pembayaran | Idempotensi hanya berlaku untuk signature valid + sudah diproses |
| 8 | Baris jurnal bernilai 0 (menu tanpa resep) | `CHECK constraint failed` — order gagal total | Baris HPP/Persediaan dilewati bila nilainya nol |
| 9 | Audit log `audit_logs` jumlah parameter kurang | 500 saat ekspor laporan | Parameter `user_id` dilengkapi |
| 10 | PPN tidak konsisten (label 11% vs implementasi 10%) | Salah pada tampilan | Diseragamkan ke **PPN 10%** (jasa boga) di seluruh UI |
| 11 | Route API tidak sesuai blueprint (`/customer` vs `/customer/scan-barcode`) | Endpoint tidak ditemukan | Struktur route dirapikan mengikuti blueprint §5 |
| 12 | Route handler tanpa `force-dynamic` gagal saat prerender | Build/500 saat runtime | `export const dynamic = 'force-dynamic'` di 28 route |
| 13 | Smoke test Phase 5 tidak idempoten terhadap pengulangan | Gagal 2 check bila dijalankan ulang pada DB yang sama | Skrip memilih tanggal yang belum punya laporan + menguji ulang idempotensi |
| 14 | Smoke test Phase 1 menguras stok bahan habis | `penyesuaian stok -> 200` gagal setelah ~4× run (stok kopi habis) | Delta adaptif + pengembalian stok, jumlah stok akhir tidak berubah |
| 15 | Parser RESP tidak menggeser byte yang sudah dipasangkan | **Semua balasan Redis salah urut** — `GET` mengembalikan balasan perintah sebelumnya, `ZCARD` jadi `NaN` | `drain()` melacak offset dan memotong buffer setelah tiap balasan dipasangkan |
| 16 | Timeout perintah (2 dtk) sama dengan jendela blokir `BRPOPLPUSH` | Worker terputus tepat sebelum balasan tiba (hanya muncul saat Redis sungguhan) | Perintah blocking memakai timeout sendiri = jendela blokir + 1 dtk |
| 17 | Jadwal pertama (`nextRunAt`) tidak disimpan | Job terjadwal tidak pernah jatuh tempo | Nilai awal langsung ditulis ke store saat dihitung |
| 18 | `GET` pada key hasil `INCR` dibaca sebagai integer | Statistik antrean selalu 0 | Balasan `GET` diparse sebagai bulk string (sesuai Redis) |
| 19 | E2E laporan gagal sesaat setelah cold start build | 2 test `…jurnal seimbang` gagal palsu (`expect` timeout 10 dtk) | Timeoutexpect Playwright dinaikkan ke 20 dtk — penyebab sebenarnya reveals di bug #23 |
| 20 | Job inline yang gagal tetap membalas `200` dengan data kosong | Endpoint cron melaporkan sukses padahal laporan tidak pernah dibuat | `runDailyReportJob` melempar error bila job inline gagal, dan mencatatnya ke dead-letter |
| 21 | Job gagal permanen hilang tanpa jejak | Tidak ada cara mengetahui/memperbaiki pekerjaan yang gagal | Dead-letter queue + riwayat 100 eksekusi terakhir + tindakan requeue/purge dari panel admin |
| 22 | Database E2E tidak pernah direset antar run |-State menumpuk: slot reservasi penuh & assertion laporan gagal setelah ~10× run (terlihat sebagai test "flaky") | `playwright.config.ts` me-reset DB E2E sebelum server start → 4× run berturut-turut 43/43 |
| 23 | Tabel buku besar merender seluruh jurnal | Halaman `/reports` melambat seiring pemakaian; tabel membengkak tanpa batas | Baris dibatasi 200 terbaru, sementara TOTAL tetap dihitung dari seluruh jurnal (+ memoized) |
| 24 | `db:reset` menghapus seluruh folder `data/` | Database test/E2E ikut terhapus — berisiko menghapus data yang bukan miliknya | Reset kini hanya menghapus file yang ditunjuk `DATABASE_FILE` (+ `-wal`/`-shm`) |

---

## 5. Catatan Teknis Penting (untuk presentasi)

### Kenapa SQLite, bukan PostgreSQL?
Blueprint menargetkan PostgreSQL + Redis + MinIO dalam monorepo. Untuk demo tugas,
SQLite (file lokal) dipilih agar **tidak perlu Docker**. Seluruh SQL yang dipakai
portabel — migrasi cukup mengganti driver + DDL.

### Kenapa PPN 10%?
Jasa boga/restoran dikenai **PPN 10%** (bukan 11% yang berlaku untuk barang luxury).
Implementasi konsisten di `src/lib/utils.ts` (`TAX_RATE = 0.1`), struk, dan seluruh laporan.

### Kenapa Redis bersifat opsional?
Rate limiter dan antrean job membutuhkan state yang dipakai bersama beberapa
proses, idealnya Redis. Namun prototipe harus **tetap jalan di laptop tanpa Docker**,
jadi `REDIS_URL` dibiarkan kosong:

| Tanpa `REDIS_URL` | Dengan `REDIS_URL` |
|---|---|
| Rate limiter per proses (`Map`) | Sliding window terpusat (sorted set + TTL) |
| Job dieksekusi inline saat dipanggil | Job masuk antrean, worker memproses |
| Tidak ada job terjadwal otomatis | Laporan harian otomatis 23:00 WIB |
| 1 proses | Bisa banyak instance |

Antarmuka keduanya identik (`SlidingWindowStore` dan `Queue`), sehingga
service tidak pernah tahu backend mana yang aktif — persis target blueprint.

### Kenapa laporan harian tidak lagi butuh cron eksternal?
`npm run worker` menjalankan penjadwal sendiri: setiap 30 detik ia memeriksa
`nextRunAt` tiap schedule (disimpan di Redis, jadi tahan restart) dan mengantrekan
job yang jatuh tempo. Endpoint `/api/v1/cron/daily-report` tetap ada untuk
menjalankan manual dari UI atau memindahkan sistem lama. Laporan tetap
idempotent per tanggal, jadi jalannya cron lama dan worker tidak menghasilkan ganda.

### Service Charge bukan pajak
Service charge 5% diperlakukan sebagai **pendapatan** (akun 4-100).
PPN dicatat sebagai **kewajiban** (akun 2-100). Keduanya bukan beban, sehingga
tidak mengurangi laba bersih — ini detail yang sering ditanyakan dosen.

### Neraca dijamin seimbang
Nilai persediaan di jurnal **selalu** berasal dari nilai fisiknya
(`sum(quantity × unit_cost)`), dan setiap transaksi menghasilkan pasangan
debit–kredit. Diverifikasi otomatis oleh:
- assertion `balanced` pada laporan `/reports`
- test `tests/domain.test.ts` & `tests/phase2.test.ts`
- `npm run db:status` yang mencetak status SEIMBANG / TIDAK SEIMBANG

### PPN 10% + service 5% dihitung berjenjang
`total = subtotal + (subtotal × 5%) + ((subtotal + service) × 10%)`
Implementasi: `calcTotals()` di `src/lib/utils.ts`.

---

## 6. Struktur Direktori

```
Prototype/
├── docs/
│   └── PROGRESS.md              ← berkas ini
├── public/
│   ├── manifest.json            ← PWA manifest
│   └── sw.js                    ← service worker (offline shell)
├── scripts/
│   ├── db.ts                    ← CLI database (seed/status/reset)
│   ├── smoke-api.ts             ← smoke test Phase 1
│   ├── smoke-phase2.ts          ← smoke test Phase 2
│   ├── smoke-phase5.ts          ← smoke test laporan terjadwal & audit log
│   ├── worker.ts                ← CLI worker (antrean + penjadwal)
│   ├── dev-fake-redis.ts        ← Redis palsu untuk demo tanpa Docker
│   ├── demo-dead-letter.ts      ← job demo yang gagal → masuk dead-letter
│   ├── backup.js / verify-backup.js
│   └── generate-icons.js        ← ikon PWA tanpa dependency
├── src/
│   ├── app/                     ← halaman + REST API Route Handlers
│   │   ├── api/v1/              ← 37 endpoint + api/health
│   │   ├── customer|pos|kitchen|booking|inventory|reports|notifications|admin|login|pay|offline/
│   │   └── globals.css, layout.tsx, page.tsx
│   ├── components/              ← AppShell, UI kit, Receipt, FloorMap, BarcodeScanner, ScheduledReportPanel, QueuePanel
│   ├── lib/                     ← store (state), api client, analytics, useRealtime, offlineCart, utils
│   ├── server/                  ← BACKEND (tidak masuk bundle browser)
│   │   ├── auth/                ← scrypt + JWT
│   │   ├── db/                  ← schema.sql, client (migrasi+seed), seed
│   │   ├── http/                ← ApiError, handler, requireUser, rate-limit
│   │   ├── infra/               ← klien Redis (RESP2) + store sliding window
│   │   ├── queue/               ← antrean job (Redis/in-memory + DLQ), penjadwal, worker, katalog job
│   │   ├── realtime/            ← event bus
│   │   └── services/            ← order, booking, inventory, payment, notification, pdf, report, schedule
│   ├── types/                   ← TypeScript types
│   └── middleware.ts            ← proteksi halaman (satu-satunya; root-level Next.js)
├── tests/
│   ├── domain.test.ts           ← 17 test (Phase 1)
│   ├── phase2.test.ts           ← 17 test (Phase 2)
│   ├── phase6.test.ts           ← 36 test (Redis + antrean job + dead-letter)
│   ├── helpers/fake-redis.ts    ← server RESP in-process untuk uji Phase 6
│   └── e2e/                     ← 41 test Playwright (auth, customer, POS, booking, stok, laporan)
├── data/restoran.db             ← database (di-gitignore, dibuat otomatis saat boot)
├── Dockerfile, docker-compose.yml, docker-compose.prod.yml, docker/nginx.conf
├── playwright.config.ts, vitest.config.ts, .eslintrc.json
├── package.json, next.config.mjs, tailwind.config.js, tsconfig.json
└── README.md                    ← dokumentasi lengkap
```

---

## 7. Rencana Selanjutnya

### Phase 7 — Penyempurnaan lanjutan (opsional)
- [ ] Migrasi SQLite → PostgreSQL ( Prisma/TypeORM )
- [ ] Integrasi Midtrans/Xendit **sungguhan** (ganti `requestToGateway()`)
- [ ] Email/SMS provider sungguhan (ganti fungsi `dispatch()`)
- [ ] Socket.io untuk alur dua arah (ganti `bus.ts` + SSE)
- [ ] Prioritas antrean (mis. laporan harian didahulukan atas retry notifikasi)
- [ ] Migrasi gambar menu ke MinIO/S3
- [ ] Load test k6 + audit keamanan berkala

---

## 8. Catatan Backup

Karena **git belum terpasang** di komputer ini, backup dilakukan dengan cara:
1. Arsip ZIP seluruh source (tanpa `node_modules`, `.next`, `data`) → folder `backup/`
2. Database dapat dipulihkan dengan `npm run db:seed` (data demo)
3. `.gitignore` sudah disiapkan agar siap di-`git init` nanti

### Cara memakai git nanti (jika sudah terpasang)

```bash
git init
git add .
git commit -m "feat: 5 modul restoran + payment gateway + notifikasi (Phase 1-2)"
git remote add origin <url-repository>
git push -u origin main
```

---

*Catatan progres coursework semester 3 — Pemrograman Web*