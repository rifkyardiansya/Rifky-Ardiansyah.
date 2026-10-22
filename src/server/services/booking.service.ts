import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb, nowISO, todayISO } from '../db/client';
import { ApiError } from '../http/api';
import {
  notifyBookingCancelled,
  notifyBookingConfirmed,
  notifyBookingCreated,
} from './notification.service';
import { publish } from '../realtime/bus';

export const bookingSchema = z.object({
  guestName: z.string().min(2, 'Nama tamu minimal 2 karakter').max(80),
  guestPhone: z.string().min(6, 'Nomor telepon tidak valid').max(30),
  guestEmail: z.string().email('Format email tidak valid').optional().or(z.literal('')),
  partySize: z.number().int().min(1).max(30),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  timeSlot: z.string().min(3).max(30),
  tableId: z.string().min(1),
  packageName: z.string().max(100).optional(),
  packagePrice: z.number().int().min(0).default(0),
  specialRequests: z.string().max(500).optional(),
});

export type BookingInput = z.infer<typeof bookingSchema>;

/** Deposit default 25% dari nilai paket (dapat diubah lewat payment_configs). */
export function depositConfig() {
  const cfg = getDb()
    .prepare('SELECT deposit_type, deposit_value, penalty_percent, min_notice_hours FROM payment_configs LIMIT 1')
    .get() as
    | { deposit_type: string; deposit_value: number; penalty_percent: number; min_notice_hours: number }
    | undefined;
  return cfg ?? { deposit_type: 'percent', deposit_value: 25, penalty_percent: 50, min_notice_hours: 24 };
}

export function calculateDeposit(packagePrice: number): number {
  const cfg = depositConfig();
  if (cfg.deposit_type === 'percent') return Math.round((packagePrice * cfg.deposit_value) / 100);
  return Math.round(packagePrice * cfg.deposit_value);
}

export function nextBookingCode(): string {
  const row = getDb()
    .prepare(
      `SELECT booking_code FROM bookings WHERE booking_code LIKE 'BKG-%'
       ORDER BY CAST(SUBSTR(booking_code, 10) AS INTEGER) DESC LIMIT 1`
    )
    .get() as { booking_code: string } | undefined;
  const year = new Date().getFullYear();
  const next = row ? Number(row.booking_code.slice(9)) + 1 : 1;
  return `BKG-${year}-${String(next).padStart(3, '0')}`;
}

export function isTableAvailable(tableId: string, date: string, timeSlot: string): boolean {
  const clash = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM bookings
       WHERE table_id = ? AND booking_date = ? AND time_slot = ?
         AND status IN ('pending_payment','confirmed','checked_in')`
    )
    .get(tableId, date, timeSlot) as { c: number };
  return clash.c === 0;
}

export function createBooking(input: BookingInput) {
  const db = getDb();
  if (!isTableAvailable(input.tableId, input.date, input.timeSlot)) {
    throw new ApiError(409, 'Meja sudah dibooking pada tanggal & jam tersebut.');
  }

  const table = db
    .prepare('SELECT table_no, capacity FROM restaurant_tables WHERE id = ?')
    .get(input.tableId) as { table_no: string; capacity: number } | undefined;
  if (!table) throw new ApiError(404, 'Meja tidak ditemukan.');
  if (table.capacity < input.partySize) {
    throw new ApiError(422, `Kapasitas meja ${table.table_no} hanya ${table.capacity} orang.`);
  }

  const code = nextBookingCode();
  const deposit = calculateDeposit(input.packagePrice);
  const id = `bkg-${crypto.randomUUID().slice(0, 8)}`;
  const qrToken = `RN:${code}:${input.tableId}:${input.date}`;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO bookings (id, booking_code, guest_name, guest_phone, guest_email, party_size,
        booking_date, time_slot, table_id, table_no, package_name, package_price, deposit_amount,
        deposit_status, special_requests, status, qr_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'pending_payment', ?, ?)`
    ).run(
      id, code, input.guestName, input.guestPhone, input.guestEmail || null, input.partySize,
      input.date, input.timeSlot, input.tableId, table.table_no, input.packageName ?? 'Tanpa Paket',
      input.packagePrice, deposit, input.specialRequests ?? null, qrToken, nowISO()
    );

    db.prepare(
      `UPDATE restaurant_tables SET status = 'reserved', current_booking_id = ? WHERE id = ?`
    ).run(code, input.tableId);
  })();

  notifyBookingCreated({
    bookingCode: code,
    guestName: input.guestName,
    guestEmail: input.guestEmail || undefined,
    guestPhone: input.guestPhone,
    date: input.date,
    timeSlot: input.timeSlot,
    tableNo: table.table_no,
    depositAmount: deposit,
  });

  publish('booking', { action: 'created', bookingCode: code, tableNo: table.table_no });

  return { id, bookingCode: code, depositAmount: deposit, qrToken };
}

/** Cek ketersediaan: kembalikan slot yang masih bisa dipesan. */
export function availability(date: string, partySize: number, slots: string[]) {
  const db = getDb();
  const tables = db
    .prepare('SELECT id, table_no, capacity, section, status FROM restaurant_tables WHERE capacity >= ?')
    .all(partySize) as { id: string; table_no: string; capacity: number; section: string; status: string }[];

  return {
    date,
    partySize,
    slots: slots.map((slot) => {
      const free = tables.filter((t) => isTableAvailable(t.id, date, slot));
      return { timeSlot: slot, totalTables: tables.length, availableTables: free.length, isOpen: free.length > 0 };
    }),
    tables: tables.map((t) => ({ ...t, available: isTableAvailable(t.id, date, slots[0] ?? '19:00 - 21:00') })),
  };
}

export function payDeposit(bookingId: string, method: string) {
  const db = getDb();
  const booking = db
    .prepare(
      `SELECT booking_code, deposit_amount, status, guest_phone, guest_name, guest_email,
              booking_date, time_slot, table_no
       FROM bookings WHERE id = ?`
    )
    .get(bookingId) as
    | {
        booking_code: string;
        deposit_amount: number;
        status: string;
        guest_phone: string;
        guest_name: string;
        guest_email: string | null;
        booking_date: string;
        time_slot: string;
        table_no: string;
      }
    | undefined;
  if (!booking) throw new ApiError(404, 'Reservasi tidak ditemukan.');
  if (booking.status === 'cancelled') throw new ApiError(409, 'Reservasi sudah dibatalkan.');

  db.transaction(() => {
    db.prepare(
      `UPDATE bookings SET deposit_status = 'paid', deposit_method = ?, status = 'confirmed' WHERE id = ?`
    ).run(method, bookingId);

    db.prepare(
      `INSERT INTO booking_payments (id, booking_id, amount, method, status, transaction_ref, paid_at)
       VALUES (?, ?, ?, ?, 'success', ?, ?)`
    ).run(`bpay-${crypto.randomUUID().slice(0, 10)}`, bookingId, booking.deposit_amount, method,
      `PAY-${booking.booking_code}`, nowISO());

    // Deposit = Kas (debit) & Liabilitas Deposit (kredit)
    const ins = db.prepare(
      `INSERT INTO ledger_entries (id, entry_date, description, account_code, category, debit, credit, reference_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    ins.run(`led-${crypto.randomUUID().slice(0, 10)}`, todayISO(),
      `Deposit reservasi ${booking.booking_code}`, '1-100', 'Kas/Bank', booking.deposit_amount, 0, booking.booking_code, nowISO());
    ins.run(`led-${crypto.randomUUID().slice(0, 10)}`, todayISO(),
      `Deposit reservasi ${booking.booking_code}`, '2-200', 'Deposit Pelanggan', 0, booking.deposit_amount, booking.booking_code, nowISO());
  })();

  notifyBookingConfirmed({
    bookingCode: booking.booking_code,
    guestPhone: booking.guest_phone,
    date: booking.booking_date,
    timeSlot: booking.time_slot,
    tableNo: booking.table_no,
  });

  publish('booking', { action: 'deposit_paid', bookingCode: booking.booking_code });

  return { bookingId, status: 'confirmed' };
}

export function updateBookingStatus(bookingId: string, status: string) {
  const db = getDb();
  const allowed = ['pending_payment', 'confirmed', 'checked_in', 'cancelled'];
  if (!allowed.includes(status)) throw new ApiError(422, `Status "${status}" tidak valid.`);

  const booking = db
    .prepare('SELECT booking_code, table_id, deposit_amount, deposit_status FROM bookings WHERE id = ?')
    .get(bookingId) as
    | {
        booking_code: string;
        table_id: string;
        deposit_amount: number;
        deposit_status: string;
        guest_name: string;
        guest_phone: string;
        guest_email: string | null;
        booking_date: string;
        time_slot: string;
        table_no: string;
      }
    | undefined;
  if (!booking) throw new ApiError(404, 'Reservasi tidak ditemukan.');

  db.transaction(() => {
    if (status === 'cancelled') {
      const cfg = depositConfig();
      const refund = booking.deposit_status === 'paid'
        ? Math.round(booking.deposit_amount * (1 - cfg.penalty_percent / 100))
        : 0;

      db.prepare(
        `UPDATE bookings SET status = 'cancelled',
           deposit_status = CASE WHEN deposit_status = 'paid' THEN 'refunded' ELSE 'pending' END
         WHERE id = ?`
      ).run(bookingId);

      if (refund > 0) {
        db.prepare(
          `INSERT INTO booking_payments (id, booking_id, amount, method, status, refunded_at, refunded_amount)
           VALUES (?, ?, ?, NULL, 'refunded', ?, ?)`
        ).run(`bpay-${crypto.randomUUID().slice(0, 10)}`, bookingId, refund, nowISO(), refund);

        const ins = db.prepare(
          `INSERT INTO ledger_entries (id, entry_date, description, account_code, category, debit, credit, reference_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const penalty = booking.deposit_amount - refund;
        const desc = `Pembatalan reservasi ${booking.booking_code}`;

        // Dr Liabilitas Deposit (seluruh deposit keluar dari liabilitas)
        ins.run(`led-${crypto.randomUUID().slice(0, 10)}`, todayISO(), desc,
          '2-200', 'Deposit Pelanggan', booking.deposit_amount, 0, booking.booking_code, nowISO());
        // Cr Kas (bagian yang dikembalikan ke tamu)
        ins.run(`led-${crypto.randomUUID().slice(0, 10)}`, todayISO(), `${desc} — refund`,
          '1-100', 'Kas/Bank', 0, refund, booking.booking_code, nowISO());
        // Cr Pendapatan (penalti pembatalan = pendapatan :: recognize revenue)
        if (penalty > 0) {
          ins.run(`led-${crypto.randomUUID().slice(0, 10)}`, todayISO(), `${desc} — penalti`,
            '4-100', 'Pendapatan', 0, penalty, booking.booking_code, nowISO());
        }
      }

      db.prepare(
        `UPDATE restaurant_tables SET status = 'available', current_booking_id = NULL WHERE id = ?`
      ).run(booking.table_id);

      notifyBookingCancelled({
        bookingCode: booking.booking_code,
        guestName: booking.guest_name,
        guestEmail: booking.guest_email ?? undefined,
        guestPhone: booking.guest_phone,
        depositAmount: booking.deposit_amount,
        refundAmount: refund,
      });
      publish('booking', { action: 'cancelled', bookingCode: booking.booking_code, refund });
      return;
    }

    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, bookingId);
    if (status === 'checked_in') {
      db.prepare(
        `UPDATE restaurant_tables SET status = 'occupied', current_booking_id = ? WHERE id = ?`
      ).run(booking.booking_code, booking.table_id);
    }
    publish('booking', { action: 'status', bookingCode: booking.booking_code, status });
  })();

  return { bookingId, status };
}