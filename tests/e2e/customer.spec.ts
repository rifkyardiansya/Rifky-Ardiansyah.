import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Test — Alur Customer Portal (Modul 1)
 *
 * Menjalankan alur nyata di browser: scan barcode meja -> pilih menu ->
 * keranjang -> checkout -> pesanan masuk ke dapur.
 *
 * Selector memakai `data-testid` (mis. menu-item-<id>) agar tidak ambigu.
 */

async function gotoCustomer(page: Page) {
  await page.goto('/customer');
  await expect(page.getByRole('heading', { name: /Customer Portal/i })).toBeVisible();
}

async function scanTable(page: Page, code: string) {
  await page.getByTestId('barcode-input').fill(code);
  await page.getByRole('button', { name: /^Scan$/ }).click();
}

test.describe('Modul 1 — Customer Portal', () => {
  test('halaman memuat kontrol scan dan status koneksi', async ({ page }) => {
    await gotoCustomer(page);

    await expect(page.getByRole('button', { name: /Scan dengan Kamera/i })).toBeVisible();
    await expect(page.getByTestId('barcode-input')).toBeVisible();
    await expect(page.getByText('Online').first()).toBeVisible();
    await expect(page.getByTestId('cart-title')).toBeVisible();
  });

  test('scan barcode meja menampilkan katalog menu', async ({ page }) => {
    await gotoCustomer(page);
    await scanTable(page, 'NT-MEJA01');

    await expect(page.getByText(/Berhasil scan Meja 01/i)).toBeVisible();
    await expect(page.getByTestId('menu-item-menu-1')).toBeVisible();
    await expect(page.getByTestId('menu-item-menu-5')).toBeVisible();
  });

  test('kode barcode tak dikenal ditolak dengan pesan jelas', async ({ page }) => {
    await gotoCustomer(page);
    await scanTable(page, 'KODE-SALAH');

    await expect(page.getByText(/tidak dikenali/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Scan dengan Kamera/i })).toBeVisible();
  });

  test('kategori menu dapat difilter', async ({ page }) => {
    await gotoCustomer(page);
    await scanTable(page, 'NT-MEJA01');

    await page.getByRole('button', { name: 'Minuman', exact: true }).click();

    await expect(page.getByTestId('menu-item-menu-5')).toBeVisible();
    await expect(page.getByTestId('menu-item-menu-3')).toHaveCount(0);
  });

  test('tambah menu ke keranjang dan total terhitung', async ({ page }) => {
    await gotoCustomer(page);
    await scanTable(page, 'NT-MEJA01');

    await page.getByTestId('menu-item-menu-1').getByRole('button', { name: /Tambah$/ }).click();
    await page.getByTestId('menu-item-menu-5').getByRole('button', { name: /Tambah$/ }).click();

    await expect(page.getByTestId('cart-count')).toHaveText('2 item');
    // Subtotal 38.000 + 24.000 = 62.000
    await expect(page.getByTestId('cart-subtotal').first()).toContainText('62.000');
  });

  test('checkout membuat pesanan dan menampilkan struk', async ({ page }) => {
    await gotoCustomer(page);
    await scanTable(page, 'NT-MEJA03');

    await page.getByTestId('menu-item-menu-2').getByRole('button', { name: /Tambah$/ }).click();

    await page.getByRole('button', { name: /Bayar Sekarang/i }).click();
    await expect(page.getByRole('heading', { name: /Checkout & Pembayaran/i })).toBeVisible();

    await page.getByRole('button', { name: 'QRIS', exact: true }).click();
    await page.getByRole('button', { name: /Bayar & Kirim Pesanan/i }).click();

    await expect(page.getByRole('heading', { name: /Pesanan Berhasil Dibuat/i })).toBeVisible();
    await expect(page.getByText(/Nomor Pesanan ORD-/i)).toBeVisible();
    await expect(page.getByText(/diteruskan ke dapur/i)).toBeVisible();
  });

  test('pesanan yang dibuat muncul di riwayat', async ({ page }) => {
    await gotoCustomer(page);
    await scanTable(page, 'NT-MEJA05');

    await page.getByTestId('menu-item-menu-6').getByRole('button', { name: /Tambah$/ }).click();
    await page.getByRole('button', { name: /Bayar Sekarang/i }).click();
    await page.getByRole('button', { name: 'QRIS', exact: true }).click();
    await page.getByRole('button', { name: /Bayar & Kirim Pesanan/i }).click();
    await expect(page.getByRole('heading', { name: /Pesanan Berhasil Dibuat/i })).toBeVisible();

    await page.getByTestId('close-success').click();
    await page.getByRole('button', { name: /3\. Riwayat/i }).click();

    await expect(page.getByText(/Riwayat Pesanan Saya/i)).toBeVisible();
    await expect(page.getByText(/Menunggu Dapur|Sedang Dimasak|Siap Disajikan/i).first()).toBeVisible();
  });

  test('keranjang dapat dikosongkan setelah pesanan dibuat', async ({ page }) => {
    await gotoCustomer(page);
    await scanTable(page, 'NT-MEJA01');

    await page.getByTestId('menu-item-menu-7').getByRole('button', { name: /Tambah$/ }).click();
    await expect(page.getByTestId('cart-count')).toHaveText('1 item');

    await page.getByRole('button', { name: /Bayar Sekarang/i }).click();
    await page.getByRole('button', { name: 'QRIS', exact: true }).click();
    await page.getByRole('button', { name: /Bayar & Kirim Pesanan/i }).click();
    await expect(page.getByRole('heading', { name: /Pesanan Berhasil Dibuat/i })).toBeVisible();

    await page.getByTestId('close-success').click();
    await expect(page.getByTestId('cart-count')).toHaveText('0 item');
  });
});