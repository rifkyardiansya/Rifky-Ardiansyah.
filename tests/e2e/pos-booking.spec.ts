import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Test — Modul 2 (POS + Kitchen Display) dan Modul 3 (Booking).
 */

async function loginAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^Masuk$/ }).click();
  await page.waitForURL(/\/pos$/, { timeout: 30_000 });
}

/** Membayar dengan tunai memakai tombol nominal cepat. */
async function payCash(page: Page) {
  await page.getByRole('button', { name: /^Tunai$/ }).click();
  // Isi nominal tunai lewat input (format Intl id-ID bisa memuat spasi non-breaking)
  const cashInput = page.locator('input[inputmode="numeric"]').first();
  await cashInput.fill('500000');
  await page.getByRole('button', { name: /Selesaikan Transaksi/i }).click();
}

test.describe('Modul 2 — POS & Kitchen Display', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'kasir', 'kasir123');
    await expect(page).toHaveURL(/\/pos/);
  });

  test('halaman POS menampilkan katalog dan keranjang', async ({ page }) => {
    await expect(page.getByText(/Keranjang Transaksi/i)).toBeVisible();
    await expect(page.getByTestId('pos-item-menu-1')).toBeVisible();
    await expect(page.getByTestId('pos-item-menu-6')).toBeVisible();
    await expect(page.getByTestId('menu-availability')).toBeVisible();
  });

  test('transaksi tunai menghasilkan kembalian dan struk', async ({ page }) => {
    await page.getByTestId('pos-item-menu-1').click();
    await page.getByTestId('pos-item-menu-2').click();

    // Kedua produk masuk ke keranjang kasir
    const cart = page.getByTestId('pos-cart-list');
    await expect(cart.getByText('Nasi Goreng Spesial Resto').first()).toBeVisible();
    await expect(cart.getByText('Ayam Bakar Madu Pedas').first()).toBeVisible();

    await page.getByRole('button', { name: /Proses Pembayaran/i }).click();
    await expect(page.getByRole('heading', { name: /Proses Pembayaran/i })).toBeVisible();

    await payCash(page);

    await expect(page.getByRole('heading', { name: /Struk Transaksi/i })).toBeVisible();
    await expect(page.getByText(/\*\*\* STRUK ELEKTRONIK/i)).toBeVisible();
    await expect(page.getByText(/TOTAL/i).first()).toBeVisible();
  });

  test('transaksi tercatat pada riwayat kasir', async ({ page }) => {
    await page.getByTestId('pos-item-menu-6').click();
    await page.getByRole('button', { name: /Proses Pembayaran/i }).click();
    await page.getByRole('button', { name: 'QRIS', exact: true }).click();
    await page.getByRole('button', { name: /Selesaikan Transaksi/i }).click();

    await expect(page.getByRole('heading', { name: /Struk Transaksi/i })).toBeVisible();
    await page.getByRole('button', { name: /^Tutup$/ }).click();

    await expect(page.getByText(/Transaksi Terbaru/i)).toBeVisible();
    await expect(page.getByText(/ORD-\d+/).first()).toBeVisible();
  });

  test('kitchen display menampilkan tiga kolom status', async ({ page }) => {
    await page.goto('/kitchen');

    await expect(page.getByRole('heading', { name: /Kitchen Display System/i })).toBeVisible();
    await expect(page.getByText(/Pesanan Masuk/i)).toBeVisible();
    await expect(page.getByText(/Sedang Dimasak/i)).toBeVisible();
    await expect(page.getByText(/Siap Disajikan/i)).toBeVisible();
  });

  test('status pesanan dapat diubah dari dapur', async ({ page }) => {
    // Buat pesanan dari POS
    await page.getByTestId('pos-item-menu-3').click();
    await page.getByRole('button', { name: /Proses Pembayaran/i }).click();
    await payCash(page);
    await expect(page.getByRole('heading', { name: /Struk Transaksi/i })).toBeVisible();

    // Buka dapur dan ubah status
    await page.goto('/kitchen');
    const start = page.getByRole('button', { name: /Mulai Masak/i }).first();
    await expect(start).toBeVisible();
    await start.click();

    await expect(page.getByRole('button', { name: /Tandai Siap/i }).first()).toBeVisible();
  });

  test('kasir tidak dapat mengubah ketersediaan menu (khusus manager)', async ({ page }) => {
    // Endpoint PATCH /inventory/products/:id mewajibkan role manager -> 403 untuk kasir
    const result = await page.evaluate(async () => {
      const res = await fetch('/api/v1/inventory/products/menu-6', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });
      return res.status;
    });
    expect(result).toBe(403);
  });
});

test.describe('Modul 3 — Reservasi', () => {
  test('customer membuat reservasi dan membayar deposit', async ({ page }) => {
    await page.goto('/booking');

    await expect(page.getByText(/Meja yang Tersedia/i)).toBeVisible();

    // Pilih meja pertama yang tersedia
    const table = page.locator('button').filter({ hasText: /^(Meja|VIP|Out) \d+/ }).first();
    await table.click();

    await page.getByLabel(/Nama Lengkap/i).fill('E2E Tamu Uji');
    await page.getByLabel(/Nomor WhatsApp/i).fill('081234567890');

    // Pilih paket agar deposit dihitung (25% dari harga paket)
    await page.getByRole('button', { name: /Paket Makan Siang/i }).click();
    await expect(page.getByText(/Uang muka \(25%\)/i)).toBeVisible();

    await page.getByRole('button', { name: /Buat Reservasi/i }).click();
    await expect(page.getByRole('heading', { name: /Reservasi Berhasil Dibuat/i })).toBeVisible();

    // Deposit pasti > 0 karena paket dipilih
    await expect(page.getByText(/Total deposit/i)).not.toHaveText(/Rp\s?0/);

    // Bayar deposit langsung di tempat
    await page.getByRole('button', { name: /Lanjut Bayar Deposit/i }).click();
    const qris = page.getByRole('button', { name: 'QRIS', exact: true });
    await qris.scrollIntoViewIfNeeded();
    await qris.click();
    await page.getByRole('button', { name: /Bayar Langsung di Tempat/i }).click();

    await expect(page.getByRole('heading', { name: /E-Ticket Reservasi/i })).toBeVisible();
  });

  test('denah ruangan menampilkan status meja', async ({ page }) => {
    await page.goto('/booking');
    await page.getByRole('button', { name: /Denah & Status Meja/i }).click();

    await expect(page.getByText(/Denah Ruangan Restoran/i)).toBeVisible();
    await expect(page.getByText(/Indoor Utama/i)).toBeVisible();
    await expect(page.getByText(/VIP Room/i)).toBeVisible();
    await expect(page.getByText(/Outdoor Garden/i)).toBeVisible();
  });

  test('daftar reservasi menampilkan kode booking', async ({ page }) => {
    await loginAs(page, 'kasir', 'kasir123');
    await page.goto('/booking');
    await page.getByRole('button', { name: /Kelola Reservasi/i }).click();

    await expect(page.getByText(/BKG-\d{4}-\d{3}/).first()).toBeVisible();
  });
});