import { getDb, nowISO, todayISO } from './client';
import { hashPassword } from '../auth/password';
import { hashSeedLedger } from './seedAccounts';
import { seedTemplates } from '../services/notification.service';

export const SEED_VERSION = 'seed-v1';

/** Seluruh tabel domain (urutan tidak penting karena FK dimatikan saat truncate). */
export const DB_TABLES = [
  'audit_logs',
  'notifications',
  'notification_templates',
  'payment_webhooks',
  'tax_reports',
  'financial_reports',
  'ledger_entries',
  'accounts',
  'stock_movements',
  'stock_adjustments',
  'grn',
  'purchase_order_items',
  'purchase_orders',
  'payment_configs',
  'booking_payments',
  'bookings',
  'payments',
  'order_items',
  'orders',
  'customers',
  'menu_recipes',
  'menu_items',
  'categories',
  'stock_items',
  'raw_materials',
  'suppliers',
  'restaurant_tables',
  'pos_sessions',
  'users',
];

/** Menghapus seluruh isi tabel lalu mengisi ulang data awal (dipakai oleh test). */
export function resetDatabase() {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const table of DB_TABLES) {
      try {
        db.prepare(`DELETE FROM ${table}`).run();
      } catch {
        /* tabel belum ada */
      }
    }
  })();
  db.pragma('foreign_keys = ON');
  return runSeed();
}

export function runSeed() {
  const db = getDb();
  const now = nowISO();

  const already = db
    .prepare('SELECT COUNT(*) AS c FROM users')
    .get() as { c: number };
  if (already.c > 0) return { skipped: true };

  const seed = db.transaction(() => {
    /* ---------- 1. USERS (RBAC) ---------- */
    const users: [string, string, string, string, string, string][] = [
      ['u-admin', 'admin', 'Administrator Restoran', 'admin@resto.test', 'admin123', 'admin'],
      ['u-manager', 'manager', 'Budi Santoso (Manager)', 'manager@resto.test', 'manager123', 'manager'],
      ['u-kasir1', 'kasir', 'Rifky (Kasir Utama)', 'kasir@resto.test', 'kasir123', 'cashier'],
      ['u-kasir2', 'kasir2', 'Siti Rahma (Kasir)', 'kasir2@resto.test', 'kasir123', 'cashier'],
      ['u-customer', 'customer', 'Ahmad Fauzi', 'customer@resto.test', 'customer123', 'customer'],
    ];
    const insUser = db.prepare(
      `INSERT INTO users (id, username, full_name, email, phone, password_hash, role, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    );
    for (const [id, username, fullName, email, pass, role] of users) {
      insUser.run(id, username, fullName, email, '0812-0000-0000', hashPassword(pass), role, now);
    }

    /* ---------- 2. CHART OF ACCOUNTS ---------- */
    const accounts: [string, string, string, string][] = [
      ['1-100', 'Kas & Bank', 'asset', 'debit'],
      ['1-200', 'Persediaan Bahan Baku', 'asset', 'debit'],
      ['2-100', 'Utang PPN', 'liability', 'credit'],
      ['2-200', 'Liabilitas Deposit Pelanggan', 'liability', 'credit'],
      ['3-100', 'Modal / Ekuitas', 'equity', 'credit'],
      ['4-100', 'Pendapatan Penjualan', 'revenue', 'credit'],
      ['5-100', 'Harga Pokok Penjualan (HPP)', 'expense', 'debit'],
      ['6-100', 'Beban Operasional', 'expense', 'debit'],
    ];
    const insAcc = db.prepare(
      'INSERT INTO accounts (id, code, name, type, normal_balance) VALUES (?, ?, ?, ?, ?)'
    );
    accounts.forEach(([code, name, type, bal], i) => insAcc.run(`acc-${i + 1}`, code, name, type, bal));

    /* ---------- 3. SUPPLIERS ---------- */
    const suppliers = [
      {
        id: 'sup-1',
        name: 'PT Berkah Pangan Nusantara',
        contact: 'Bapak Gunawan',
        phone: '0812-3456-7890',
        email: 'order@berkahpangan.co.id',
        address: 'Kawasan Industri Pangan No. 12, Jakarta Timur',
        terms: 'Tempo 30 Hari',
      },
      {
        id: 'sup-2',
        name: 'CV Segar Jaya Organik',
        contact: 'Ibu Ratna',
        phone: '0857-9876-5432',
        email: 'sales@segarjaya.id',
        address: 'Pasar Induk Kramat Jati Blok C/14',
        terms: 'COD / Tunai',
      },
      {
        id: 'sup-3',
        name: 'Distributor Kopi & Beverage Makmur',
        contact: 'Hendra Saputra',
        phone: '0821-1122-3344',
        email: 'hendra@makmurbev.com',
        address: 'Jl. Radio Dalam No. 45, Jakarta Selatan',
        terms: 'Tempo 14 Hari',
      },
    ];
    const insSup = db.prepare(
      `INSERT INTO suppliers (id, name, contact_person, phone, email, address, payment_terms, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    );
    suppliers.forEach((s) => insSup.run(s.id, s.name, s.contact, s.phone, s.email, s.address, s.terms, now));

    /* ---------- 4. RAW MATERIALS ---------- */
    const materials: [string, string, string, string, number, number, number, string, string | null][] = [
      ['raw-1', 'RAW-BRS-01', 'Beras Pandan Wangi Premium', 'Sembako', 45, 20, 15000, 'sup-1', '2027-03-15'],
      ['raw-2', 'RAW-AYM-01', 'Daging Ayam Fillet Segar', 'Daging & Unggas', 8, 15, 42000, 'sup-2', '2026-10-10'],
      ['raw-3', 'RAW-SPI-01', 'Daging Sapi Gandik (Tender)', 'Daging & Unggas', 18, 10, 125000, 'sup-1', '2026-10-20'],
      ['raw-4', 'RAW-TLR-01', 'Telur Ayam Negeri', 'Sembako', 32, 15, 28000, 'sup-2', '2026-10-18'],
      ['raw-5', 'RAW-MYK-01', 'Minyak Goreng Kelapa Sawit', 'Sembako', 50, 25, 17000, 'sup-1', '2027-06-30'],
      ['raw-6', 'RAW-KOP-01', 'Biji Kopi Arabika House Blend', 'Minuman', 12, 5, 160000, 'sup-3', '2027-01-10'],
      ['raw-7', 'RAW-SSU-01', 'Susu UHT Full Cream', 'Minuman', 5, 12, 210000, 'sup-3', '2026-12-05'],
      ['raw-8', 'RAW-BMB-01', 'Bumbu Dapur Segar (Bawang & Cabai)', 'Bumbu', 22, 10, 35000, 'sup-2', '2026-10-14'],
    ];
    const insMat = db.prepare(
      `INSERT INTO raw_materials (id, sku, name, category, unit, min_stock, unit_cost, supplier_id, expiry_date, location, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Gudang Utama', ?)`
    );
    const insStock = db.prepare(
      'INSERT INTO stock_items (id, raw_material_id, quantity, last_updated) VALUES (?, ?, ?, ?)'
    );
    materials.forEach(([id, sku, name, cat, qty, min, cost, sup, exp], i) => {
      insMat.run(id, sku, name, cat, cat === 'Minuman' ? 'karton' : cat === 'Sembako' && id === 'raw-5' ? 'liter' : 'kg', min, cost, sup, exp, now);
      insStock.run(`stk-${i + 1}`, id, qty, now);
    });

    // Nilai persediaan awal = nilai fisik stok sebelum penjualan contoh dipotong.
    // Angka inilah yang dipakai jurnal "pembelian bahan baku awal" agar neraca seimbang.
    const openingInventory = (
      db
        .prepare('SELECT ROUND(SUM(s.quantity * m.unit_cost)) AS v FROM stock_items s JOIN raw_materials m ON m.id = s.raw_material_id')
        .get() as { v: number }
    ).v;

    /* ---------- 5. MENU + RESEP ---------- */
    const menu: {
      id: string; name: string; cat: string; price: number; cost: number;
      barcode: string; img: string; desc: string; recipe: [string, number][];
    }[] = [
      {
        id: 'menu-1', name: 'Nasi Goreng Spesial Resto', cat: 'Makanan Utama', price: 38000, cost: 16000,
        barcode: '8991001001',
        img: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=600&q=80',
        desc: 'Nasi goreng harum rempah istimewa dengan suwiran ayam, telur ceplok, sate ayam, dan kerupuk udang.',
        recipe: [['raw-1', 0.2], ['raw-4', 0.1], ['raw-2', 0.1], ['raw-5', 0.05]],
      },
      {
        id: 'menu-2', name: 'Ayam Bakar Madu Pedas', cat: 'Makanan Utama', price: 42000, cost: 19000,
        barcode: '8991001002',
        img: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=600&q=80',
        desc: 'Ayam pejantan panggang arang bumbu marinasi madu dan rempah pedas gurih, disajikan dengan lalapan segar.',
        recipe: [['raw-2', 0.35], ['raw-8', 0.05]],
      },
      {
        id: 'menu-3', name: 'Rendang Sapi Warisan Minang', cat: 'Makanan Utama', price: 55000, cost: 26000,
        barcode: '8991001003',
        img: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=600&q=80',
        desc: 'Daging sapi pilihan dimasak lambat 6 jam dengan santan kental dan kelapa sangrai kaya rempah aromatik.',
        recipe: [['raw-3', 0.25], ['raw-8', 0.08]],
      },
      {
        id: 'menu-4', name: 'Sate Ayam Madura (10 Tusuk)', cat: 'Makanan Utama', price: 35000, cost: 15000,
        barcode: '8991001004',
        img: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=600&q=80',
        desc: 'Daging ayam lembut dibakar arang disiram bumbu kacang kental khas Madura, bawang goreng, dan lontong.',
        recipe: [['raw-2', 0.25]],
      },
      {
        id: 'menu-5', name: 'Es Kopi Susu Gula Aren', cat: 'Minuman', price: 24000, cost: 8500,
        barcode: '8991002001',
        img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=600&q=80',
        desc: 'Espresso double shot house blend arabika dipadu susu segar dingin dan sirup gula aren murni.',
        recipe: [['raw-6', 0.02], ['raw-7', 0.05]],
      },
      {
        id: 'menu-6', name: 'Es Teh Melati Spesial', cat: 'Minuman', price: 12000, cost: 3000,
        barcode: '8991002002',
        img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=600&q=80',
        desc: 'Seduhan daun teh melati asli pegunungan disajikan segar dingin dengan rasa manis pas menyegarkan.',
        recipe: [],
      },
      {
        id: 'menu-7', name: 'Pisang Goreng Karamel Crispy', cat: 'Camilan', price: 22000, cost: 7500,
        barcode: '8991003001',
        img: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=600&q=80',
        desc: 'Pisang kepok manis berbalut tepung renyah keemasan dengan siraman saus karamel dan parutan keju.',
        recipe: [],
      },
      {
        id: 'menu-8', name: 'Tahu Cabe Garam', cat: 'Camilan', price: 20000, cost: 6000,
        barcode: '8991003002',
        img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
        desc: 'Tahu sutra crispy ditumis dengan potongan cabai rawit pedas, daun bawang, dan bawang putih cincang renyah.',
        recipe: [],
      },
    ];

    const insCat = db.prepare('INSERT OR IGNORE INTO categories (id, name, sort_order) VALUES (?, ?, ?)');
    Array.from(new Set(menu.map((m) => m.cat))).forEach((c, i) => insCat.run(`cat-${i + 1}`, c, i + 1));

    const insMenu = db.prepare(
      `INSERT INTO menu_items (id, name, category_id, category, barcode, image, description, price, cost_price, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    const insRecipe = db.prepare(
      'INSERT INTO menu_recipes (id, menu_item_id, raw_material_id, amount_needed, unit) VALUES (?, ?, ?, ?, ?)'
    );
    menu.forEach((m) => {
      insMenu.run(m.id, m.name, null, m.cat, m.barcode, m.img, m.desc, m.price, m.cost, now, now);
      m.recipe.forEach(([matId, amount], j) => {
        insRecipe.run(`rcp-${m.id}-${j + 1}`, m.id, matId, amount, matId === 'raw-5' ? 'liter' : matId === 'raw-7' ? 'karton' : 'kg');
      });
    });

    /* ---------- 6. MEJA ---------- */
    const tables: [string, string, number, string, string, number, number][] = [
      ['tbl-1', 'Meja 01', 2, 'Indoor Utama', 'available', 10, 15],
      ['tbl-2', 'Meja 02', 4, 'Indoor Utama', 'occupied', 35, 15],
      ['tbl-3', 'Meja 03', 4, 'Indoor Utama', 'available', 60, 15],
      ['tbl-4', 'Meja 04', 6, 'Indoor Utama', 'available', 85, 15],
      ['tbl-5', 'Meja 05', 2, 'Indoor Utama', 'available', 10, 45],
      ['tbl-6', 'Meja 06', 4, 'Indoor Utama', 'reserved', 35, 45],
      ['tbl-7', 'VIP 01', 10, 'VIP Room', 'available', 75, 45],
      ['tbl-8', 'VIP 02', 12, 'VIP Room', 'available', 75, 75],
      ['tbl-9', 'Out 01', 4, 'Outdoor Garden', 'available', 15, 80],
      ['tbl-10', 'Out 02', 4, 'Outdoor Garden', 'available', 45, 80],
    ];
    const insTable = db.prepare(
      `INSERT INTO restaurant_tables (id, table_no, barcode, capacity, section, status, pos_x, pos_y)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    tables.forEach(([id, no, cap, sec, status, x, y]) => {
      insTable.run(id, no, `NT-${no.replace(/\s+/g, '').toUpperCase()}`, cap, sec, status, x, y);
    });

    /* ---------- 7. PESANAN CONTOH ---------- */
    const insOrder = db.prepare(
      `INSERT INTO orders (id, order_no, customer_name, customer_phone, table_number, source,
        subtotal, discount, service_charge, tax, total, status, payment_status, payment_method,
        cash_received, change_amount, created_at, paid_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insOrderItem = db.prepare(
      'INSERT INTO order_items (id, order_id, menu_item_id, name, price, quantity, notes, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const sampleOrders = [
      {
        id: 'ord-1001', no: 'ORD-1001', name: 'Ahmad Fauzi', phone: '081299887766', table: 'Meja 04',
        source: 'customer_qr', items: [
          ['menu-1', 'Nasi Goreng Spesial Resto', 38000, 2, 'Pedas sedang'],
          ['menu-5', 'Es Kopi Susu Gula Aren', 24000, 2, 'Less sugar'],
        ] as [string, string, number, number, string | null][],
        status: 'completed', payStatus: 'paid', method: 'qris', cash: null,
        created: new Date(Date.now() - 3600000 * 3).toISOString(),
        paid: new Date(Date.now() - 3600000 * 2.5).toISOString(),
      },
      {
        id: 'ord-1002', no: 'ORD-1002', name: 'Siti Rahma', phone: '087811223344', table: 'Meja 02',
        source: 'pos_cashier', items: [
          ['menu-2', 'Ayam Bakar Madu Pedas', 42000, 2, null],
          ['menu-6', 'Es Teh Melati Spesial', 12000, 2, null],
          ['menu-7', 'Pisang Goreng Karamel Crispy', 22000, 1, null],
        ] as [string, string, number, number, string | null][],
        status: 'cooking', payStatus: 'paid', method: 'cash', cash: 150000,
        created: new Date(Date.now() - 1800000).toISOString(),
        paid: new Date(Date.now() - 1700000).toISOString(),
      },
      {
        id: 'ord-1003', no: 'ORD-1003', name: 'Budi Santoso', phone: '085678901234', table: 'Meja 05',
        source: 'customer_qr', items: [
          ['menu-3', 'Rendang Sapi Warisan Minang', 55000, 1, null],
          ['menu-8', 'Tahu Cabe Garam', 20000, 1, null],
          ['menu-6', 'Es Teh Melati Spesial', 12000, 1, null],
        ] as [string, string, number, number, string | null][],
        status: 'pending', payStatus: 'unpaid', method: null, cash: null,
        created: new Date(Date.now() - 600000).toISOString(),
        paid: null,
      },
    ];

    const seededSales: { orderNo: string; subtotal: number; serviceCharge: number; tax: number; total: number; cogs: number }[] = [];

    const recipeStmt = db.prepare(
      `SELECT r.raw_material_id, r.amount_needed, m.unit_cost
       FROM menu_recipes r JOIN raw_materials m ON m.id = r.raw_material_id
       WHERE r.menu_item_id = ?`
    );
    const deductStmt = db.prepare(
      'UPDATE stock_items SET quantity = ROUND(quantity - ?, 3), last_updated = ? WHERE raw_material_id = ?'
    );

    sampleOrders.forEach((o) => {
      const subtotal = o.items.reduce((s, i) => s + i[2] * i[3], 0);
      const serviceCharge = Math.round(subtotal * 0.05);
      const tax = Math.round((subtotal + serviceCharge) * 0.1);
      const total = subtotal + serviceCharge + tax;
      const change = o.cash ? o.cash - total : null;

      insOrder.run(o.id, o.no, o.name, o.phone, o.table, o.source, subtotal, 0, serviceCharge, tax, total,
        o.status, o.payStatus, o.method, o.cash, change, o.created, o.paid, o.created);

      o.items.forEach(([menuId, name, price, qty, notes], j) => {
        insOrderItem.run(`oi-${o.id}-${j + 1}`, o.id, menuId, name, price, qty, notes, price * qty);
      });

      // HPP dihitung dari resep (BOM) dan langsung memotong stok fisik,
      // sehingga nilai persediaan di jurnal selalu sama dengan stok fisik.
      let cogs = 0;
      if (o.payStatus === 'paid') {
        o.items.forEach(([menuId, , , qty]) => {
          (recipeStmt.all(menuId) as { raw_material_id: string; amount_needed: number; unit_cost: number }[]).forEach(
            (r) => {
              const used = r.amount_needed * qty;
              cogs += used * r.unit_cost;
              deductStmt.run(used, now, r.raw_material_id);
            }
          );
        });
      }
      seededSales.push({ orderNo: o.no, subtotal, serviceCharge, tax, total, cogs: Math.round(cogs) });

      if (o.table) {
        db.prepare('UPDATE restaurant_tables SET current_order_id = ?, status = ? WHERE table_no = ?')
          .run(o.no, o.status === 'completed' ? 'available' : 'occupied', o.table);
      }
    });

    /* ---------- 8. RESERVASI ---------- */
    const insBooking = db.prepare(
      `INSERT INTO bookings (id, booking_code, guest_name, guest_phone, guest_email, party_size,
        booking_date, time_slot, table_id, table_no, package_name, package_price, deposit_amount,
        deposit_status, deposit_method, special_requests, status, qr_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    insBooking.run('bkg-1', 'BKG-2026-001', 'Dr. Hendra Wijaya', '0813-8899-7711', 'hendra.wijaya@gmail.com',
      4, today, '19:00 - 21:00', 'tbl-6', 'Meja 06', 'Paket Makan Malam (3 jam)', 300000, 100000,
      'paid', 'qris', 'Dekat jendela, mohon siapkan baby chair 1 unit.', 'confirmed', 'qr-bkg-1',
      new Date(Date.now() - 86400000).toISOString());

    insBooking.run('bkg-2', 'BKG-2026-002', 'Ibu Cindy (PT Cipta Kreasi)', '0812-7766-5544', 'cindy@ciptakreasi.co.id',
      10, tomorrow, '18:30 - 21:30', 'tbl-7', 'VIP 01', 'Paket Meeting Dinner', 1000000, 300000,
      'paid', 'debit', 'Meeting makan malam direksi, proyektor disiapkan.', 'confirmed', 'qr-bkg-2',
      new Date(Date.now() - 43200000).toISOString());

    db.prepare('UPDATE restaurant_tables SET current_booking_id = ? WHERE id = ?').run('BKG-2026-001', 'tbl-6');

    /* ---------- 9. KONFIGURASI PEMBAYARAN ---------- */
    db.prepare(
      `INSERT INTO payment_configs (id, deposit_type, deposit_value, refund_policy, cancellation_policy, penalty_percent, min_notice_hours)
       VALUES ('cfg-1', 'percent', 25, 'full', 'partial', 50, 24)`
    ).run();

    /* ---------- 10. SESI KASIR ---------- */
    db.prepare(
      `INSERT INTO pos_sessions (id, cashier_id, cashier_name, opening_cash, total_transactions, total_revenue, opened_at)
       VALUES ('ses-101', 'u-kasir1', 'Rifky (Kasir Utama)', 500000, 2, 292100, ?)`
    ).run(new Date(Date.now() - 3600000 * 5).toISOString());

    /* ---------- 11. JURNAL PEMBUKAAN ---------- */
    hashSeedLedger(db, now, openingInventory, seededSales);
  });

  seed();
  // Template pesan dimuat setelah transaksi selesai
  seedTemplates();
  return { skipped: false };
}