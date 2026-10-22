-- =====================================================================
--  Restoran Nusantara — Database Schema (SQLite / stand-in PostgreSQL)
--  Layered: Presentation -> Application(Service) -> Domain -> Infrastructure
--  Seluruh tabel memakai snake_case + FK + CHECK constraint.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1. AUTH & RBAC
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,           -- scrypt: salt:hash
  role          TEXT NOT NULL CHECK (role IN ('customer','cashier','manager','admin')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- 2. MASTER DATA: kategori, menu, meja, supplier, bahan baku
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  category     TEXT NOT NULL,
  barcode      TEXT NOT NULL UNIQUE,
  image        TEXT,
  description  TEXT,
  price        INTEGER NOT NULL CHECK (price >= 0),
  cost_price   INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_menu_barcode ON menu_items(barcode);
CREATE INDEX IF NOT EXISTS idx_menu_category ON menu_items(category);

-- Resep / BOM (bill of materials) -> sumber HPP
CREATE TABLE IF NOT EXISTS menu_recipes (
  id                TEXT PRIMARY KEY,
  menu_item_id      TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  raw_material_id   TEXT NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  amount_needed     REAL NOT NULL CHECK (amount_needed > 0),
  unit              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipe_menu ON menu_recipes(menu_item_id);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id            TEXT PRIMARY KEY,
  table_no      TEXT NOT NULL UNIQUE,
  barcode       TEXT NOT NULL UNIQUE,
  capacity      INTEGER NOT NULL CHECK (capacity > 0),
  section       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','occupied','reserved')),
  current_order_id   TEXT,
  current_booking_id TEXT,
  pos_x         REAL NOT NULL DEFAULT 0,
  pos_y         REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS suppliers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  payment_terms  TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_materials (
  id            TEXT PRIMARY KEY,
  sku           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  unit          TEXT NOT NULL,
  min_stock     REAL NOT NULL DEFAULT 0,
  unit_cost     INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  supplier_id   TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  expiry_date   TEXT,
  location      TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_items (
  id              TEXT PRIMARY KEY,
  raw_material_id TEXT NOT NULL UNIQUE REFERENCES raw_materials(id) ON DELETE CASCADE,
  quantity        REAL NOT NULL DEFAULT 0,
  last_updated    TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- 3. TRANSAKSI PEMESANAN
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT UNIQUE,
  email        TEXT,
  loyalty_pts  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  order_no       TEXT NOT NULL UNIQUE,
  customer_id    TEXT REFERENCES customers(id) ON DELETE SET NULL,
  table_id       TEXT REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  table_number   TEXT NOT NULL,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT,
  source         TEXT NOT NULL CHECK (source IN ('customer_qr','pos_cashier')),
  subtotal       INTEGER NOT NULL,
  discount       INTEGER NOT NULL DEFAULT 0,
  service_charge INTEGER NOT NULL DEFAULT 0,
  tax            INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','cooking','ready','served','completed','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
                 CHECK (payment_status IN ('unpaid','paid','refunded')),
  payment_method TEXT CHECK (payment_method IN ('cash','qris','debit','credit')),
  cash_received  INTEGER,
  change_amount  INTEGER,
  cashier_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  void_reason    TEXT,
  created_at     TEXT NOT NULL,
  paid_at        TEXT,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id  TEXT NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  price         INTEGER NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  notes         TEXT,
  subtotal      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method         TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  reference_id   TEXT,
  status         TEXT NOT NULL CHECK (status IN ('pending','success','failed','refunded')),
  created_at     TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- 4. KASIR (POS SESSION)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_sessions (
  id            TEXT PRIMARY KEY,
  cashier_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cashier_name  TEXT NOT NULL,
  opening_cash  INTEGER NOT NULL DEFAULT 0,
  closing_cash  INTEGER,
  expected_cash INTEGER,
  total_transactions INTEGER NOT NULL DEFAULT 0,
  total_revenue      INTEGER NOT NULL DEFAULT 0,
  opened_at     TEXT NOT NULL,
  closed_at     TEXT
);

-- ---------------------------------------------------------------------
-- 5. RESERVASI / BOOKING
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id              TEXT PRIMARY KEY,
  booking_code    TEXT NOT NULL UNIQUE,
  guest_name      TEXT NOT NULL,
  guest_phone     TEXT NOT NULL,
  guest_email     TEXT,
  party_size      INTEGER NOT NULL CHECK (party_size > 0),
  booking_date    TEXT NOT NULL,
  time_slot       TEXT NOT NULL,
  table_id        TEXT NOT NULL REFERENCES restaurant_tables(id) ON DELETE CASCADE,
  table_no        TEXT NOT NULL,
  package_name    TEXT,
  package_price   INTEGER NOT NULL DEFAULT 0,
  deposit_amount  INTEGER NOT NULL DEFAULT 0,
  deposit_status  TEXT NOT NULL DEFAULT 'pending'
                  CHECK (deposit_status IN ('pending','paid','refunded')),
  deposit_method  TEXT,
  special_requests TEXT,
  status          TEXT NOT NULL DEFAULT 'pending_payment'
                  CHECK (status IN ('pending_payment','confirmed','checked_in','cancelled')),
  qr_token        TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_date ON bookings(booking_date);

CREATE TABLE IF NOT EXISTS booking_payments (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount        INTEGER NOT NULL,
  method        TEXT,
  status        TEXT NOT NULL,
  transaction_ref TEXT,
  paid_at       TEXT,
  refunded_at   TEXT,
  refunded_amount INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_configs (
  id              TEXT PRIMARY KEY,
  deposit_type    TEXT NOT NULL DEFAULT 'percent',
  deposit_value   REAL NOT NULL DEFAULT 25,
  refund_policy   TEXT NOT NULL DEFAULT 'full',
  cancellation_policy TEXT NOT NULL DEFAULT 'partial',
  penalty_percent REAL NOT NULL DEFAULT 50,
  min_notice_hours INTEGER NOT NULL DEFAULT 24
);

-- ---------------------------------------------------------------------
-- 6. INVENTORY: PO, GRN, STOCK MOVEMENT
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id            TEXT PRIMARY KEY,
  po_number     TEXT NOT NULL UNIQUE,
  supplier_id   TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  order_date    TEXT NOT NULL,
  due_date      TEXT,
  total_cost    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','submitted','received','cancelled')),
  received_date TEXT,
  received_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id              TEXT PRIMARY KEY,
  po_id           TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  raw_material_id TEXT NOT NULL REFERENCES raw_materials(id) ON DELETE RESTRICT,
  quantity        REAL NOT NULL CHECK (quantity > 0),
  unit            TEXT NOT NULL,
  unit_cost       INTEGER NOT NULL,
  subtotal        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS grn (
  id          TEXT PRIMARY KEY,
  grn_number  TEXT NOT NULL UNIQUE,
  po_id       TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  received_date TEXT NOT NULL,
  received_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  total_cost  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'received'
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id          TEXT PRIMARY KEY,
  raw_material_id TEXT NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('increase','decrease','correction')),
  qty_before  REAL NOT NULL,
  qty_after   REAL NOT NULL,
  reason      TEXT NOT NULL,
  adjusted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id              TEXT PRIMARY KEY,
  raw_material_id TEXT NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('purchase','sale','adjustment','waste','return')),
  qty_change      REAL NOT NULL,
  ref_id          TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movement_material ON stock_movements(raw_material_id);

-- ---------------------------------------------------------------------
-- 7. AKUNTANSI (double entry) & LAPORAN
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit','credit'))
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id           TEXT PRIMARY KEY,
  entry_date   TEXT NOT NULL,
  description  TEXT NOT NULL,
  account_code TEXT NOT NULL REFERENCES accounts(code) ON DELETE RESTRICT,
  category     TEXT NOT NULL,
  debit        INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit       INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  reference_id TEXT,
  created_at   TEXT NOT NULL,
  CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_entries(reference_id);

CREATE TABLE IF NOT EXISTS financial_reports (
  id           TEXT PRIMARY KEY,
  report_type  TEXT NOT NULL,
  period       TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'generated',
  data_json    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_reports (
  id          TEXT PRIMARY KEY,
  tax_period  TEXT NOT NULL,
  tax_type    TEXT NOT NULL DEFAULT 'PPN',
  base_amount INTEGER NOT NULL,
  tax_amount  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  filing_date TEXT
);

-- ---------------------------------------------------------------------
-- 8. AUDIT LOG
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  detail      TEXT,
  ip_address  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ---------------------------------------------------------------------
-- 9. SCHEMA MIGRATIONS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- 10. PAYMENT GATEWAY & NOTIFICATION  (Phase 2)
-- ---------------------------------------------------------------------
-- Penyimpanan payload webhook mentah + penanda idempotensi, agar callback
-- gateway yang terkirim ganda tidak menyebabkan pembayaran terduplikasi.
CREATE TABLE IF NOT EXISTS payment_webhooks (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  external_id   TEXT,
  event_type    TEXT NOT NULL,
  order_id      TEXT,
  booking_id    TEXT,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  processed     INTEGER NOT NULL DEFAULT 0,
  payload_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_external ON payment_webhooks(external_id);

-- Outbox notification: pesan disusun lalu "dikirim" ke kanal (email/SMS/WA).
CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  channel      TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  recipient    TEXT NOT NULL,
  template     TEXT NOT NULL,
  subject      TEXT,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  ref_type     TEXT,
  ref_id       TEXT,
  error        TEXT,
  sent_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_status ON notifications(status);

-- Template pesan (email/SMS) agar konten tidak di-hardcode di service.
CREATE TABLE IF NOT EXISTS notification_templates (
  code        TEXT PRIMARY KEY,
  channel     TEXT NOT NULL,
  subject     TEXT,
  body        TEXT NOT NULL,
  description TEXT
);