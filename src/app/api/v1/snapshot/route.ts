export const dynamic = 'force-dynamic';

import { getDb, nowISO } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';
import type { Order, OrderItem } from '@/types';

/**
 * Endpoint agregat: mengembalikan seluruh state yang dibutuhkan UI.
 * Digunakan sebagai sumber data tunggal pada prototype (menggantikan localStorage).
 */
export const GET = handler(async () => {
  const db = getDb();

  const menuItems = db
    .prepare(
      `SELECT id, name, category, barcode, image, description, price,
              cost_price AS costPrice, is_active AS available
       FROM menu_items ORDER BY category, name`
    )
    .all() as Record<string, unknown>[];

  const recipes = db
    .prepare(
      `SELECT r.menu_item_id AS menuItemId, r.raw_material_id AS rawMaterialId,
              r.amount_needed AS amountNeeded, r.unit
       FROM menu_recipes r`
    )
    .all() as { menuItemId: string; rawMaterialId: string; amountNeeded: number; unit: string }[];

  const materials = db
    .prepare(
      `SELECT m.id, m.sku, m.name, m.category, m.unit, m.min_stock AS minStock,
              m.unit_cost AS unitCost, m.expiry_date AS expiryDate,
              s.quantity AS currentStock, m.supplier_id AS supplierId,
              COALESCE(sup.name, '-') AS supplierName
       FROM raw_materials m
       JOIN stock_items s ON s.raw_material_id = m.id
       LEFT JOIN suppliers sup ON sup.id = m.supplier_id
       ORDER BY m.name`
    )
    .all() as Record<string, unknown>[];

  const suppliers = db
    .prepare(
      `SELECT id, name, contact_person AS contactPerson, phone, email, address, payment_terms AS paymentTerms
       FROM suppliers WHERE is_active = 1 ORDER BY name`
    )
    .all() as Record<string, unknown>[];

  const purchaseOrders = db
    .prepare(
      `SELECT po.id, po.po_number AS poNumber, po.supplier_id AS supplierId,
              COALESCE(sup.name, '-') AS supplierName, po.total_cost AS totalCost,
              po.status, po.order_date AS orderDate, po.received_date AS receivedDate, po.notes
       FROM purchase_orders po LEFT JOIN suppliers sup ON sup.id = po.supplier_id
       ORDER BY po.order_date DESC, po.po_number DESC`
    )
    .all() as Record<string, unknown>[];

  const poItems = db
    .prepare(
      `SELECT poi.po_id AS poId, poi.raw_material_id AS rawMaterialId, m.name,
              poi.quantity, poi.unit, poi.unit_cost AS unitCost, poi.subtotal
       FROM purchase_order_items poi JOIN raw_materials m ON m.id = poi.raw_material_id`
    )
    .all() as Record<string, unknown>[];

  const tables = db
    .prepare(
      `SELECT id, table_no AS tableNo, barcode, capacity, section, status,
              current_order_id AS currentOrderId, current_booking_id AS currentBookingId,
              pos_x AS x, pos_y AS y
       FROM restaurant_tables ORDER BY table_no`
    )
    .all() as Record<string, unknown>[];

  const orders = db
    .prepare(
      `SELECT id, order_no AS orderNo, table_number AS tableNumber, customer_name AS customerName,
              customer_phone AS customerPhone, source, subtotal, discount, service_charge AS serviceCharge,
              tax, total, status, payment_status AS paymentStatus, payment_method AS paymentMethod,
              cash_received AS cashReceived, change_amount AS change, created_at AS createdAt,
              paid_at AS paidAt
       FROM orders ORDER BY created_at DESC LIMIT 100`
    )
    .all() as Order[];

  const orderItems = db
    .prepare(
      `SELECT id, order_id AS orderId, menu_item_id AS menuItemId, name, price, quantity, notes, subtotal
       FROM order_items`
    )
    .all() as (OrderItem & { orderId: string })[];

  const bookings = db
    .prepare(
      `SELECT id, booking_code AS bookingCode, guest_name AS guestName, guest_phone AS guestPhone,
              guest_email AS guestEmail, party_size AS partySize, booking_date AS date, time_slot AS timeSlot,
              table_id AS tableId, table_no AS tableNo, deposit_amount AS depositAmount,
              deposit_status AS depositStatus, deposit_method AS depositPaymentMethod,
              special_requests AS specialRequests, status, qr_token AS qrToken, created_at AS createdAt
       FROM bookings ORDER BY booking_date DESC, created_at DESC`
    )
    .all() as Record<string, unknown>[];

  const ledger = db
    .prepare(
      `SELECT id, entry_date AS date, description, category, debit, credit, reference_id AS referenceId
       FROM ledger_entries ORDER BY created_at DESC, rowid DESC LIMIT 300`
    )
    .all() as Record<string, unknown>[];

  const posSession = db
    .prepare(
      `SELECT ps.id, ps.cashier_name AS cashierName, ps.opening_cash AS openingCash,
              ps.closing_cash AS closingCash, ps.expected_cash AS expectedCash,
              ps.total_transactions AS totalTransactions, ps.total_revenue AS totalRevenue,
              ps.opened_at AS startTime, ps.closed_at AS endTime
       FROM pos_sessions ps WHERE ps.closed_at IS NULL ORDER BY ps.opened_at DESC LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined;

  const sessionUser = db
    .prepare(
      `SELECT u.id, u.username, u.full_name AS fullName, u.role
       FROM pos_sessions ps JOIN users u ON u.id = ps.cashier_id
       WHERE ps.closed_at IS NULL ORDER BY ps.opened_at DESC LIMIT 1`
    )
    .get() as { id: string; username: string; fullName: string; role: string } | undefined;

  return ok({
    serverTime: nowISO(),
    menuItems: menuItems.map((m) => ({
      ...m,
      recipe: recipes.filter((r) => r.menuItemId === String(m.id)),
    })),
    rawMaterials: materials,
    suppliers,
    purchaseOrders: purchaseOrders.map((po) => ({
      ...po,
      items: poItems.filter((i) => i.poId === po.id),
    })),
    tables,
    orders: orders.map((o) => ({ ...o, items: orderItems.filter((i) => i.orderId === o.id) })),
    bookings,
    ledger,
    posSession: posSession
      ? { ...posSession, isOpen: true, cashierId: sessionUser?.id ?? null }
      : null,
    counters: {
      order: orders.length
        ? Math.max(...orders.map((o) => Number(o.orderNo.replace('ORD-', '')) || 0))
        : 1000,
    },
  });
});