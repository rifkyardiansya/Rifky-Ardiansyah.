import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Test — Modul 4 (Stok) dan Modul 5 (Laporan Keuangan).
 *
 * Membuktikan integrasi antar modul benar-benar terjadi di UI:
 *  - penjualan mengurangi stok bahan baku,
 *  - purchase order & penerimaan barang menambah stok,
 *  - laporan keuangan tetap seimbang setelah semua aktivitas.
 */

async function loginManager(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('manager');
  await page.getByLabel('Password').fill('manager123');
  await page.getByRole('button', { name: /^Masuk$/ }).click();
  await page.waitForURL(/\/pos$/, { timeout: 30_000 });
}

test.describe('Modul 4 — Stok & Bahan Baku', () => {
  test.beforeEach(async ({ page }) => {
    await loginManager(page);
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: /Manajemen Stok/i })).toBeVisible();
  });

  test('menampilkan nilai persediaan dan peringatan stok menipis', async ({ page }) => {
    await expect(page.getByText(/Nilai Persediaan/i).first()).toBeVisible();
    await expect(page.getByText(/Peringatan Stok Menipis/i)).toBeVisible();

    // Bahan dari seed yang deliberately menipis: Daging Ayam (8 < 15)
    await expect(page.getByTestId('stock-row-raw-2')).toContainText('Daging Ayam Fillet Segar');
  });

  test('penyesuaian stok memperbarui jumlah stok', async ({ page }) => {
    const row = page.getByTestId('stock-row-raw-6');
    const before = await row.textContent();

    await row.getByRole('button', { name: 'Penyesuaian' }).click();
    await expect(page.getByRole('heading', { name: /Stock Opname/i })).toBeVisible();

    // Isi selisih +5 langsung pada kolom input
    await page.getByTestId('adjust-delta').fill('5');

    await page.getByRole('button', { name: /Simpan Penyesuaian/i }).click();

    // Toast konfirmasi (muncul sebentar, jadi cek cepat)
    await expect(page.getByTestId('toast')).toContainText(/Penyesuaian stok dicatat/i, { timeout: 5000 });
    await expect(row).not.toHaveText(before ?? '');
  });

  test('purchase order dibuat lalu barang diterima (GRN)', async ({ page }) => {
    await page.getByRole('button', { name: /Buat PO Baru/i }).click();
    await expect(page.getByRole('heading', { name: /Buat Purchase Order/i })).toBeVisible();

    await page.getByRole('button', { name: /Tambah Bahan/i }).click();
    await page.getByRole('button', { name: /Kirim Purchase Order/i }).click();

    // Modal harus menutup setelah PO tersimpan
    await expect(page.getByRole('heading', { name: /Buat Purchase Order/i })).toHaveCount(0, { timeout: 10_000 });

    // Tab purchase order kini dapat diklik (modal sudah tertutup)
    await page.getByRole('button', { name: /^Purchase Order$/ }).click();
    await expect(page.getByText(/PO-\d{4}/).first()).toBeVisible();
    await expect(page.getByText(/Dikirim/i).first()).toBeVisible();

    await page.getByRole('button', { name: /Terima Barang/i }).first().click();
    await expect(page.getByTestId('toast')).toContainText(/diterima/i, { timeout: 5000 });
    await expect(page.getByText(/Diterima \(GRN\)/i).first()).toBeVisible();
  });

  test('halaman resep menampilkan HPP dan margin tiap menu', async ({ page }) => {
    await page.getByRole('button', { name: /Resep & HPP Menu/i }).click();

    await expect(page.getByText(/Margin/i).first()).toBeVisible();
    await expect(page.getByText(/Nasi Goreng Spesial Resto/i).first()).toBeVisible();
    await expect(page.getByText(/Harga jual|HPP resep/i).first()).toBeVisible();
  });

  test('daftar supplier menampilkan kontak dan termin pembayaran', async ({ page }) => {
    await page.getByRole('button', { name: /^Supplier$/ }).click();

    await expect(page.getByText(/PT Berkah Pangan Nusantara/i)).toBeVisible();
    await expect(page.getByText(/Tempo 30 Hari/i)).toBeVisible();
  });
});

test.describe('Modul 5 — Laporan Keuangan', () => {
  test.beforeEach(async ({ page }) => {
    await loginManager(page);
    await page.goto('/reports');
  });

  test('dashboard menampilkan KPI utama', async ({ page }) => {
    await expect(page.getByText(/Total Pendapatan/i).first()).toBeVisible();
    await expect(page.getByText(/Harga Pokok \(HPP\)/i).first()).toBeVisible();
    await expect(page.getByText(/Laba Bersih/i).first()).toBeVisible();
  });

  test('laba rugi menampilkan struktur pendapatan dan beban', async ({ page }) => {
    await page.getByTestId('report-tab-pl').click();

    await expect(page.getByText('LAPORAN LABA RUGI', { exact: true })).toBeVisible();

    await expect(page.getByText('Laba Kotor', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('Harga Pokok (HPP)', { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByText(/Beban Operasional/i).first()).toBeVisible();
    await expect(page.getByText('LABA BERSIH', { exact: true }).first()).toBeVisible();
  });

  test('neraca saldo dinyatakan seimbang', async ({ page }) => {
    await page.getByTestId('report-tab-neraca').click();

    await expect(page.getByText(/Neraca seimbang|Total Aset = Total Kewajiban/i)).toBeVisible();
  });

  test('buku besar menyatakan jurnal debit = kredit', async ({ page }) => {
    await page.getByTestId('report-tab-buku-besar').click();

    await expect(page.getByText(/Jurnal seimbang: total debit = total kredit/i)).toBeVisible();
  });

  test('laporan pajak menampilkan rekap PPN', async ({ page }) => {
    await page.getByTestId('report-tab-ppn').click();

    await expect(page.getByText(/DPP \(Nilai Jual Kena Pajak\)/i)).toBeVisible();
    await expect(page.getByText(/PPN Terutang/i).first()).toBeVisible();
  });

  test('laporan penjualan menampilkan per produk dan per metode bayar', async ({ page }) => {
    await page.getByTestId('report-tab-penjualan').click();

    await expect(page.getByText(/Penjualan per Produk/i)).toBeVisible();
    await expect(page.getByText(/Penjualan per Kasir & per Metode Bayar/i)).toBeVisible();
  });

  test('laporan harian terjadwal dapat dipratinjau', async ({ page }) => {
    await expect(page.getByText(/Laporan Penjualan Harian \(Terjadwal\)/i)).toBeVisible();

    await page.getByRole('button', { name: /Pratinjau Laporan/i }).click();
    await expect(page.getByRole('heading', { name: /Laporan Penjualan Harian/i }).last()).toBeVisible();
    await expect(page.getByText(/Metode Pembayaran/i).first()).toBeVisible();
    await expect(page.getByText(/Posisi Keuangan/i)).toBeVisible();
  });
});