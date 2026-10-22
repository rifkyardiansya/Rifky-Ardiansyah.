import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Test — Autentikasi & RBAC.
 *
 * Membuktikan proteksi route berjenjang: halaman kasir/stok/laporan hanya
 * bisa diakses role tertentu, dan API menolak permintaan tanpa sesi.
 *
 * Catatan: selector memakai `data-testid` agar tidak ambigu — teks yang sama
 * sering muncul lebih dari sekali (mis. nama menu pada katalog POS maupun
 * pada daftar "ketersediaan menu").
 */

const ACCOUNT = {
  kasir: { username: 'kasir', password: 'kasir123' },
  manager: { username: 'manager', password: 'manager123' },
  admin: { username: 'admin', password: 'admin123' },
} as const;

async function login(page: Page, who: keyof typeof ACCOUNT) {
  const creds = ACCOUNT[who];
  await page.goto('/login');
  await page.getByLabel('Username').fill(creds.username);
  await page.getByLabel('Password').fill(creds.password);
  await page.getByRole('button', { name: /^Masuk$/ }).click();
  await page.waitForURL(/\/pos$/, { timeout: 30_000 });
}

test.describe('Autentikasi & RBAC', () => {
  test('halaman kasir dialihkan ke login bila belum masuk', async ({ page }) => {
    await page.goto('/pos');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /Masuk ke Sistem/i })).toBeVisible();
  });

  test('login gagal menampilkan pesan yang benar', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('kasir');
    await page.getByLabel('Password').fill('passwordsalahsekali');
    await page.getByRole('button', { name: /^Masuk$/ }).click();

    await expect(page.getByText(/Username atau password salah/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('login kasir berhasil dan membuka modul POS', async ({ page }) => {
    await login(page, 'kasir');
    await expect(page).toHaveURL(/\/pos/);
    await expect(page.getByRole('heading', { name: /Aplikasi Kasir/i })).toBeVisible();
  });

  test('sidebar menampilkan menu sesuai role kasir', async ({ page }) => {
    await login(page, 'kasir');

    await expect(page.getByRole('link', { name: /Kasir \(POS\)/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Kitchen Display/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Reservasi Meja/ })).toBeVisible();
  });

  test('sidebar menyembunyikan Panel Admin untuk non-admin', async ({ page }) => {
    await login(page, 'kasir');
    await expect(page.getByRole('link', { name: /Panel Admin/ })).toHaveCount(0);
  });

  test('kasir tidak dapat membuka halaman stok langsung', async ({ page }) => {
    await login(page, 'kasir');
    await page.goto('/inventory');
    // Middleware RBAC: role kasir < manager -> kembalikan ke login
    await expect(page).toHaveURL(/\/login/);
  });

  test('API laporan menolak akses tanpa sesi', async ({ request }) => {
    const res = await request.get('/api/v1/reports?type=pnl');
    expect(res.status()).toBe(401);
  });

  test('API stok menolak permintaan tulis dari role kasir', async ({ request }) => {
    // Login kasir lebih dulu
    const login = await request.post('/api/v1/auth/login', {
      data: ACCOUNT.kasir,
    });
    expect(login.status()).toBe(200);

    const cookies = login.headers()['set-cookie'] ?? '';
    const po = await request.post('/api/v1/inventory/purchase-orders', {
      data: { supplierId: 'sup-1', items: [{ rawMaterialId: 'raw-1', quantity: 5 }] },
      headers: { cookie: cookies.split(';')[0] },
    });
    expect(po.status()).toBe(403);
  });

  test('manager dapat membuka halaman laporan keuangan', async ({ page }) => {
    await login(page, 'manager');
    await page.goto('/reports');

    await expect(page.getByRole('heading', { name: /Laporan Keuangan Standar Akuntansi/i })).toBeVisible();
    await expect(page.getByTestId('report-tab-pl')).toBeVisible();
    await expect(page.getByTestId('report-tab-neraca')).toBeVisible();
  });

  test('tab neraca menampilkan keterangan seimbang', async ({ page }) => {
    await login(page, 'manager');
    await page.goto('/reports');
    await page.getByTestId('report-tab-neraca').click();

    await expect(page.getByText(/Neraca seimbang|Total Aset = Total Kewajiban/i)).toBeVisible();
  });

  test('buku besar menyatakan jurnal seimbang', async ({ page }) => {
    await login(page, 'manager');
    await page.goto('/reports');
    await page.getByTestId('report-tab-buku-besar').click();

    await expect(page.getByText(/Jurnal seimbang: total debit = total kredit/i)).toBeVisible();
  });

  test('admin dapat membuka panel admin beserta matriks RBAC', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin');

    await expect(page.getByRole('heading', { name: /Panel Administrator/i })).toBeVisible();

    // Matriks hak akses berada pada tab "Keamanan & Peran"
    await page.getByTestId('admin-tab-keamanan').click();
    await expect(page.getByText(/Matriks Hak Akses/i)).toBeVisible();
    await expect(page.getByText(/Implementasi Keamanan/i)).toBeVisible();
  });

  test('admin dapat memantau antrean job & status Redis', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin');

    await page.getByTestId('admin-tab-antrean').click();

    // Status backend antrean (Redis atau in-memory) dan angka antrean tampil.
    await expect(page.getByText('Backend Antrean', { exact: true })).toBeVisible();
    await expect(page.getByText('Gagal Permanen', { exact: true })).toBeVisible();

    // Tidak ada job gagal pada demo → dead-letter kosong, tombol retry nonaktif.
    await expect(page.getByText(/Tidak ada job gagal/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Antrikan Ulang Job Gagal/i })).toBeDisabled();

    // Riwayat pekerjaan & jadwal otomatis tetap dirender.
    await expect(page.getByText(/Riwayat Pekerjaan Terakhir/i)).toBeVisible();
    await expect(page.getByText(/Jadwal Otomatis/i)).toBeVisible();
  });

  test('panel antrean hanya untuk admin', async ({ page }) => {
    await login(page, 'kasir');
    await page.goto('/admin');
    // Middleware mengalihkan kasir (dan halaman login sendiri akan melemparnya
    // kembali ke /pos), jadi yang diuji adalah panelnya memang tidak tampil.
    await expect(page.getByRole('heading', { name: /Panel Administrator/i })).toHaveCount(0);
  });
});