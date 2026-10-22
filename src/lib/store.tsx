'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  INITIAL_BOOKINGS,
  INITIAL_LEDGER,
  INITIAL_MENU_ITEMS,
  INITIAL_ORDERS,
  INITIAL_POS_SESSION,
  INITIAL_RAW_MATERIALS,
  INITIAL_SUPPLIERS,
  INITIAL_TABLES,
} from './initialData';
import { Api, ApiRequestError, type SessionPayload } from './api';
import { useRealtime, type ConnectionState } from './useRealtime';
import { saveOfflineCart } from './offlineCart';
import { DEPOSIT_RATE, calcTotals, todayISO, uid } from './utils';
import type {
  BookingStatus,
  CartItem,
  LedgerEntry,
  MenuItem,
  Order,
  OrderStatus,
  PaymentMethod,
  PosSession,
  PurchaseOrder,
  RawMaterial,
  RestaurantTable,
  Supplier,
  TableBooking,
} from '../types';

const STORAGE_KEY = 'resto-nusantara-proto-v1';

export type DataMode = 'server' | 'local';

interface PersistedState {
  menuItems: MenuItem[];
  rawMaterials: RawMaterial[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  tables: RestaurantTable[];
  orders: Order[];
  bookings: TableBooking[];
  ledger: LedgerEntry[];
  posSession: PosSession | null;
  cart: CartItem[];
  cartTable: string;
  counters: { order: number; booking: number; po: number };
}

function buildInitialState(): PersistedState {
  return {
    menuItems: INITIAL_MENU_ITEMS,
    rawMaterials: INITIAL_RAW_MATERIALS,
    suppliers: INITIAL_SUPPLIERS,
    purchaseOrders: [],
    tables: INITIAL_TABLES,
    orders: INITIAL_ORDERS,
    bookings: INITIAL_BOOKINGS,
    ledger: INITIAL_LEDGER,
    posSession: INITIAL_POS_SESSION,
    cart: [],
    cartTable: '',
    counters: { order: 1003, booking: 2, po: 0 },
  };
}

/* --------------------------- Snapshot mapping -------------------------- */

type Row = Record<string, unknown>;

function mapSnapshot(raw: Record<string, unknown>): PersistedState {
  const base = buildInitialState();

  const menuItems: MenuItem[] = (raw.menuItems as Row[] | undefined)?.map((m) => ({
    id: String(m.id),
    name: String(m.name),
    category: String(m.category) as MenuItem['category'],
    price: Number(m.price),
    costPrice: Number(m.costPrice),
    barcode: String(m.barcode),
    image: String(m.image ?? ''),
    description: String(m.description ?? ''),
    available: Boolean(m.available),
    recipe: ((m.recipe as Row[] | undefined) ?? []).map((r) => ({
      rawMaterialId: String(r.rawMaterialId),
      amountNeeded: Number(r.amountNeeded),
      unit: String(r.unit),
    })),
  })) ?? base.menuItems;

  const orders = ((raw.orders as Row[] | undefined) ?? []).map((o) => ({
    id: String(o.id),
    orderNo: String(o.orderNo),
    tableNumber: String(o.tableNumber),
    customerName: String(o.customerName),
    customerPhone: o.customerPhone ? String(o.customerPhone) : undefined,
    items: ((o.items as Row[] | undefined) ?? []).map((i) => ({
      id: String(i.id),
      menuItemId: String(i.menuItemId),
      name: String(i.name),
      price: Number(i.price),
      quantity: Number(i.quantity),
      notes: i.notes ? String(i.notes) : undefined,
      subtotal: Number(i.subtotal),
    })),
    subtotal: Number(o.subtotal),
    tax: Number(o.tax),
    serviceCharge: Number(o.serviceCharge),
    discount: Number(o.discount),
    total: Number(o.total),
    status: o.status as Order['status'],
    paymentStatus: o.paymentStatus as Order['paymentStatus'],
    paymentMethod: (o.paymentMethod ?? undefined) as PaymentMethod | undefined,
    cashReceived: o.cashReceived === null ? undefined : Number(o.cashReceived ?? 0) || undefined,
    change: o.change === null ? undefined : Number(o.change ?? 0) || undefined,
    createdAt: String(o.createdAt),
    paidAt: o.paidAt ? String(o.paidAt) : undefined,
    source: o.source as Order['source'],
  }));

  const bookings = ((raw.bookings as Row[] | undefined) ?? []).map((b) => ({
    id: String(b.id),
    bookingCode: String(b.bookingCode),
    guestName: String(b.guestName),
    guestPhone: String(b.guestPhone ?? '-'),
    guestEmail: String(b.guestEmail ?? ''),
    partySize: Number(b.partySize),
    date: String(b.date),
    timeSlot: String(b.timeSlot),
    tableId: String(b.tableId),
    tableNo: String(b.tableNo),
    depositAmount: Number(b.depositAmount),
    depositStatus: b.depositStatus as TableBooking['depositStatus'],
    depositPaymentMethod: (b.depositPaymentMethod ?? undefined) as PaymentMethod | undefined,
    specialRequests: b.specialRequests ? String(b.specialRequests) : undefined,
    status: b.status as TableBooking['status'],
    createdAt: String(b.createdAt),
  }));

  const rawMaterials = ((raw.rawMaterials as Row[] | undefined) ?? []).map((m) => ({
    id: String(m.id),
    sku: String(m.sku),
    name: String(m.name),
    category: String(m.category),
    currentStock: Number(m.currentStock),
    minStock: Number(m.minStock),
    unit: String(m.unit),
    unitCost: Number(m.unitCost),
    supplierId: String(m.supplierId ?? ''),
    supplierName: String(m.supplierName ?? '-'),
    expiryDate: m.expiryDate ? String(m.expiryDate) : undefined,
  }));

  const purchaseOrders = ((raw.purchaseOrders as Row[] | undefined) ?? []).map((po) => ({
    id: String(po.id),
    poNumber: String(po.poNumber),
    supplierId: String(po.supplierId),
    supplierName: String(po.supplierName),
    items: ((po.items as Row[] | undefined) ?? []).map((i) => ({
      rawMaterialId: String(i.rawMaterialId),
      name: String(i.name),
      quantity: Number(i.quantity),
      unit: String(i.unit),
      unitCost: Number(i.unitCost),
      subtotal: Number(i.subtotal),
    })),
    totalCost: Number(po.totalCost),
    status: po.status as PurchaseOrder['status'],
    orderDate: String(po.orderDate),
    receivedDate: po.receivedDate ? String(po.receivedDate) : undefined,
    notes: po.notes ? String(po.notes) : undefined,
  }));

  const tables: RestaurantTable[] = ((raw.tables as Row[] | undefined) ?? []).map((t) => ({
    id: String(t.id),
    tableNo: String(t.tableNo),
    capacity: Number(t.capacity),
    section: String(t.section) as RestaurantTable['section'],
    status: t.status as RestaurantTable['status'],
    currentOrderId: t.currentOrderId ? String(t.currentOrderId) : undefined,
    currentBookingId: t.currentBookingId ? String(t.currentBookingId) : undefined,
    x: Number(t.x),
    y: Number(t.y),
  }));

  const session = raw.posSession as Row | null | undefined;

  return {
    menuItems,
    rawMaterials,
    suppliers: (raw.suppliers as Supplier[] | undefined) ?? base.suppliers,
    purchaseOrders,
    tables,
    orders,
    bookings,
    ledger: (raw.ledger as LedgerEntry[] | undefined) ?? [],
    posSession: session
      ? {
          id: String(session.id),
          cashierName: String(session.cashierName),
          startTime: String(session.startTime),
          endTime: session.endTime ? String(session.endTime) : undefined,
          openingCash: Number(session.openingCash),
          closingCash: session.closingCash === null ? undefined : Number(session.closingCash),
          totalTransactions: Number(session.totalTransactions),
          totalRevenue: Number(session.totalRevenue),
          isOpen: true,
        }
      : null,
    cart: [],
    cartTable: '',
    counters: { order: 1000, booking: bookings.length, po: purchaseOrders.length },
  };
}

export interface PlaceOrderInput {
  items: CartItem[];
  tableNumber: string;
  customerName: string;
  customerPhone?: string;
  source: Order['source'];
  paymentMethod?: PaymentMethod;
  cashReceived?: number;
}

interface StoreValue extends PersistedState {
  mounted: boolean;
  loading: boolean;
  mode: DataMode;
  user: SessionPayload | null;
  lastError: string | null;
  connection: ConnectionState;
  liveEvent: { channel: string; action: string; at: string } | null;
  refresh: () => Promise<PersistedState | null>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  dismissError: () => void;

  addToCart: (item: MenuItem, qty?: number, notes?: string) => void;
  updateCartQty: (menuItemId: string, qty: number) => void;
  removeFromCart: (menuItemId: string) => void;
  clearCart: () => void;
  setCartTable: (tableNo: string) => void;
  cartSubtotal: number;

  toggleMenuAvailability: (id: string) => void;
  updateMenuItem: (id: string, patch: Partial<MenuItem>) => void;
  findMenuByBarcode: (barcode: string) => MenuItem | undefined;

  placeOrder: (input: PlaceOrderInput) => Promise<Order | null>;
  updateOrderStatus: (id: string, status: OrderStatus) => void;
  payOrder: (id: string, method: PaymentMethod, cashReceived?: number) => void;
  voidOrder: (id: string, reason: string) => void;

  openSession: (cashierName: string, openingCash: number) => void;
  closeSession: (closingCash: number) => void;

  createBooking: (input: {
    guestName: string;
    guestPhone: string;
    guestEmail: string;
    partySize: number;
    date: string;
    timeSlot: string;
    tableId: string;
    specialRequests?: string;
    packagePrice?: number;
  }) => Promise<TableBooking | null>;
  payBookingDeposit: (id: string, method: PaymentMethod) => void;
  updateBookingStatus: (id: string, status: BookingStatus) => void;
  cancelBooking: (id: string) => void;
  isTableReserved: (tableId: string, date: string, timeSlot: string) => boolean;

  createPurchaseOrder: (input: {
    supplierId: string;
    items: { rawMaterialId: string; quantity: number }[];
    notes?: string;
  }) => Promise<PurchaseOrder | null>;
  receivePurchaseOrder: (id: string) => void;
  adjustStock: (rawMaterialId: string, delta: number, reason: string) => void;
  resetDemo: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(buildInitialState);
  const [user, setUser] = useState<SessionPayload | null>(null);
  const [mode, setMode] = useState<DataMode>('server');
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [liveEvent, setLiveEvent] = useState<{ channel: string; action: string; at: string } | null>(null);
  const hydrated = useRef(false);
  const cartRef = useRef<Pick<PersistedState, 'cart' | 'cartTable'>>({ cart: [], cartTable: '' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------- bootstrap ------------------------- */
  const refresh = useCallback(async (): Promise<PersistedState | null> => {
    try {
      const snap = await Api.snapshot();
      const next = mapSnapshot(snap);
      setState((prev) => {
        const merged = { ...next, cart: prev.cart, cartTable: prev.cartTable };
        return merged;
      });
      cartRef.current = { cart: state.cart, cartTable: state.cartTable };
      setMode('server');
      setLastError(null);
      return next;
    } catch {
      // Fallback offline: muat dari localStorage
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) setState({ ...buildInitialState(), ...(JSON.parse(raw) as PersistedState) });
      } catch {
        /* ignore */
      }
      setMode('local');
      return null;
    } finally {
      setLoading(false);
      setMounted(true);
    }
  }, [state.cart, state.cartTable]);

  useEffect(() => {
    hydrated.current = true;
    void (async () => {
      Api.me()
        .then((r) => setUser(r.user))
        .catch(() => setUser(null));
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server = database; browser = IndexedDB (agar keranjang tetap ada saat offline)
  useEffect(() => {
    if (!hydrated.current) return;
    if (mode === 'server') {
      // tetap menulis keranjang ke IndexedDB agar tersedia saat offline
      void saveOfflineCart({
        tableNo: state.cartTable || 'default',
        items: state.cart,
        subtotal: state.cart.reduce((s, c) => s + c.menuItem.price * c.quantity, 0),
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...state, cart: cartRef.current.cart, cartTable: cartRef.current.cartTable })
      );
    } catch {
      /* ignore */
    }
  }, [state, mode]);

  /* ------------------- REALTIME (Server-Sent Events) ------------------- */
  // Event dari server (order baru, perubahan stok, pembayaran, notifikasi)
  // memicu muat ulang snapshot secara debounce agar tidak remasteruh.
  const { state: connection } = useRealtime((event) => {
    setLiveEvent({ channel: event.channel, action: event.action, at: event.at });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void refresh();
    }, 350);
  });

  /* ------------------------ sinkronisasi antar tab ------------------------ */
  useEffect(() => {
    function onFocus() {
      if (mode === 'server') void refresh();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [mode, refresh]);

  const update = useCallback((fn: (prev: PersistedState) => PersistedState) => setState(fn), []);

  const run = useCallback(
    async (apiCall: () => Promise<unknown>, localApply?: (prev: PersistedState) => PersistedState) => {
      if (mode === 'server') {
        try {
          await apiCall();
          await refresh();
          return true;
        } catch (error) {
          const message =
            error instanceof ApiRequestError ? error.message : 'Gagal menghubungi server.';
          setLastError(message);
          return false;
        }
      }
      if (localApply) update(localApply);
      return true;
    },
    [mode, refresh, update]
  );

  /* ------------------------------ AUTH ------------------------------ */
  const login = useCallback(
    async (username: string, password: string) => {
      try {
        const session = await Api.login(username, password);
        setUser(session);
        setLastError(null);
        await refresh();
        return true;
      } catch (error) {
        setLastError(error instanceof ApiRequestError ? error.message : 'Login gagal.');
        return false;
      }
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    await Api.logout().catch(() => undefined);
    setUser(null);
    await refresh();
  }, [refresh]);

  /* ------------------------------ CART ------------------------------ */
  const addToCart = useCallback(
    (item: MenuItem, qty = 1, notes?: string) => {
      update((prev) => {
        const exists = prev.cart.find((c) => c.menuItem.id === item.id);
        const cart = exists
          ? prev.cart.map((c) => (c.menuItem.id === item.id ? { ...c, quantity: c.quantity + qty, notes: notes ?? c.notes } : c))
          : [...prev.cart, { menuItem: item, quantity: qty, notes }];
        cartRef.current = { cart, cartTable: prev.cartTable };
        return { ...prev, cart };
      });
    },
    [update]
  );

  const updateCartQty = useCallback(
    (menuItemId: string, qty: number) => {
      update((prev) => {
        const cart =
          qty <= 0
            ? prev.cart.filter((c) => c.menuItem.id !== menuItemId)
            : prev.cart.map((c) => (c.menuItem.id === menuItemId ? { ...c, quantity: qty } : c));
        cartRef.current = { cart, cartTable: prev.cartTable };
        return { ...prev, cart };
      });
    },
    [update]
  );

  const removeFromCart = useCallback(
    (menuItemId: string) => {
      update((prev) => {
        const cart = prev.cart.filter((c) => c.menuItem.id !== menuItemId);
        cartRef.current = { cart, cartTable: prev.cartTable };
        return { ...prev, cart };
      });
    },
    [update]
  );

  const clearCart = useCallback(() => {
    update((prev) => {
      cartRef.current = { cart: [], cartTable: '' };
      return { ...prev, cart: [], cartTable: '' };
    });
  }, [update]);

  const setCartTable = useCallback(
    (tableNo: string) => {
      update((prev) => {
        cartRef.current = { cart: prev.cart, cartTable: tableNo };
        return { ...prev, cartTable: tableNo };
      });
    },
    [update]
  );

  const cartSubtotal = useMemo(
    () => state.cart.reduce((sum, c) => sum + c.menuItem.price * c.quantity, 0),
    [state.cart]
  );

  /* ------------------------------ MENU ------------------------------ */
  const toggleMenuAvailability = useCallback(
    (id: string) => {
      const item = state.menuItems.find((m) => m.id === id);
      if (!item) return;
      void run(
        () => Api.updateProduct(id, { isActive: !item.available }),
        (prev) => ({
          ...prev,
          menuItems: prev.menuItems.map((m) => (m.id === id ? { ...m, available: !m.available } : m)),
        })
      );
    },
    [run, state.menuItems]
  );

  const updateMenuItem = useCallback(
    (id: string, patch: Partial<MenuItem>) => {
      void run(
        () => Api.updateProduct(id, { name: patch.name, price: patch.price }),
        (prev) => ({ ...prev, menuItems: prev.menuItems.map((m) => (m.id === id ? { ...m, ...patch } : m)) })
      );
    },
    [run]
  );

  const findMenuByBarcode = useCallback(
    (barcode: string) => state.menuItems.find((m) => m.barcode === barcode.trim()),
    [state.menuItems]
  );

  /* ------------------------------ ORDER ------------------------------ */
  const placeOrder = useCallback(
    async (input: PlaceOrderInput): Promise<Order | null> => {
      const payload = {
        tableNumber: input.tableNumber || 'Takeaway',
        customerName: input.customerName || 'Pelanggan Umum',
        customerPhone: input.customerPhone,
        source: input.source,
        paymentMethod: input.paymentMethod,
        cashReceived: input.cashReceived,
        items: input.items.map((i) => ({ menuItemId: i.menuItem.id, quantity: i.quantity, notes: i.notes })),
      };

      if (mode === 'server') {
        try {
          const result =
            input.source === 'pos_cashier'
              ? await Api.posTransaction(payload)
              : await Api.createCustomerOrder(payload);
          await refresh();
          const orderId = String(result.id);
          return state.orders.find((o) => o.id === orderId) ?? buildLocalOrder(input);
        } catch (error) {
          setLastError(error instanceof ApiRequestError ? error.message : 'Gagal membuat pesanan.');
          return null;
        }
      }

      return buildLocalOrder(input);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, refresh, state.orders, state.menuItems, state.rawMaterials]
  );

  /** Pembuatan order versi lokal (mode offline / demo tanpa server). */
  function buildLocalOrder(input: PlaceOrderInput): Order {
    const seq = state.counters.order + 1;
    const orderNo = `ORD-${seq}`;
    const subtotal = input.items.reduce((s, i) => s + i.menuItem.price * i.quantity, 0);
    const totals = calcTotals(subtotal);
    const now = new Date().toISOString();
    const isPaid = Boolean(input.paymentMethod);

    const order: Order = {
      id: uid('ord'),
      orderNo,
      tableNumber: input.tableNumber || 'Takeaway',
      customerName: input.customerName || 'Pelanggan Umum',
      customerPhone: input.customerPhone,
      items: input.items.map((i) => ({
        id: uid('oi'),
        menuItemId: i.menuItem.id,
        name: i.menuItem.name,
        price: i.menuItem.price,
        quantity: i.quantity,
        notes: i.notes,
        subtotal: i.menuItem.price * i.quantity,
      })),
      ...totals,
      status: 'pending',
      paymentStatus: isPaid ? 'paid' : 'unpaid',
      paymentMethod: input.paymentMethod,
      cashReceived: input.cashReceived,
      change:
        input.paymentMethod === 'cash' && input.cashReceived ? input.cashReceived - totals.total : undefined,
      createdAt: now,
      paidAt: isPaid ? now : undefined,
      source: input.source,
    };

    let cogs = 0;
    const stockDelta: Record<string, number> = {};
    order.items.forEach((oi) => {
      const menu = state.menuItems.find((m) => m.id === oi.menuItemId);
      menu?.recipe?.forEach((r) => {
        const mat = state.rawMaterials.find((m) => m.id === r.rawMaterialId);
        if (!mat) return;
        cogs += mat.unitCost * r.amountNeeded * oi.quantity;
        stockDelta[r.rawMaterialId] = (stockDelta[r.rawMaterialId] || 0) - r.amountNeeded * oi.quantity;
      });
    });

    update((prev) => {
      const ledgerEntries: LedgerEntry[] = isPaid
        ? [
            { id: uid('led'), date: todayISO(), description: `Penjualan ${orderNo}`, category: 'Kas/Bank', debit: order.total, credit: 0, referenceId: orderNo },
            { id: uid('led'), date: todayISO(), description: `Pendapatan ${orderNo}`, category: 'Pendapatan', debit: 0, credit: order.subtotal, referenceId: orderNo },
            { id: uid('led'), date: todayISO(), description: `Service charge ${orderNo}`, category: 'Pendapatan', debit: 0, credit: order.serviceCharge, referenceId: orderNo },
            { id: uid('led'), date: todayISO(), description: `PPN terutang ${orderNo}`, category: 'Kewajiban PPN', debit: 0, credit: order.tax, referenceId: orderNo },
            { id: uid('led'), date: todayISO(), description: `HPP ${orderNo}`, category: 'HPP (Bahan Baku)', debit: Math.round(cogs), credit: 0, referenceId: orderNo },
            { id: uid('led'), date: todayISO(), description: `Persediaan ${orderNo}`, category: 'Persediaan', debit: 0, credit: Math.round(cogs), referenceId: orderNo },
          ]
        : [];

      return {
        ...prev,
        orders: [order, ...prev.orders],
        counters: { ...prev.counters, order: seq },
        ledger: [...prev.ledger, ...ledgerEntries],
        rawMaterials: prev.rawMaterials.map((m) =>
          stockDelta[m.id] !== undefined
            ? { ...m, currentStock: Math.max(0, Number((m.currentStock + stockDelta[m.id]).toFixed(2))) }
            : m
        ),
        posSession:
          isPaid && prev.posSession
            ? {
                ...prev.posSession,
                totalTransactions: prev.posSession.totalTransactions + 1,
                totalRevenue: prev.posSession.totalRevenue + order.total,
              }
            : prev.posSession,
      };
    });

    return order;
  }

  const updateOrderStatus = useCallback(
    (id: string, status: OrderStatus) => {
      void run(
        () => Api.orderStatus(id, status),
        (prev) => {
          const orders = prev.orders.map((o) => (o.id === id ? { ...o, status } : o));
          const target = orders.find((o) => o.id === id);
          const tables = target?.tableNumber.startsWith('Meja')
            ? prev.tables.map((t) =>
                t.tableNo === target.tableNumber
                  ? {
                      ...t,
                      status: (status === 'completed' || status === 'cancelled' ? 'available' : 'occupied') as RestaurantTable['status'],
                      currentOrderId: status === 'completed' || status === 'cancelled' ? undefined : target.orderNo,
                    }
                  : t
              )
            : prev.tables;
          return { ...prev, orders, tables };
        }
      );
    },
    [run]
  );

  const payOrder = useCallback(
    (id: string, method: PaymentMethod, cashReceived?: number) => {
      void run(
        () => Api.posPay(id, { method, cashReceived }),
        (prev) => ({
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === id
              ? {
                  ...o,
                  paymentStatus: 'paid' as const,
                  paymentMethod: method,
                  cashReceived,
                  change: method === 'cash' && cashReceived ? cashReceived - o.total : undefined,
                  paidAt: new Date().toISOString(),
                }
              : o
          ),
        })
      );
    },
    [run]
  );

  const voidOrder = useCallback(
    (id: string, reason: string) => {
      void run(
        () => Api.posVoid(id, reason),
        (prev) => ({
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === id ? { ...o, status: 'cancelled' as const, paymentStatus: 'refunded' as const } : o
          ),
          ledger: [
            ...prev.ledger,
            {
              id: uid('led'),
              date: todayISO(),
              description: `Pembatalan transaksi — ${reason}`,
              category: 'Beban Operasional' as const,
              debit: prev.orders.find((o) => o.id === id)?.total ?? 0,
              credit: 0,
              referenceId: prev.orders.find((o) => o.id === id)?.orderNo,
            },
          ],
        })
      );
    },
    [run]
  );

  /* --------------------------- POS SESSION ---------------------------- */
  const openSession = useCallback(
    (cashierName: string, openingCash: number) => {
      void run(
        () => Api.openSession(openingCash, cashierName),
        (prev) => ({
          ...prev,
          posSession: {
            id: uid('ses'),
            cashierName,
            startTime: new Date().toISOString(),
            openingCash,
            totalTransactions: 0,
            totalRevenue: 0,
            isOpen: true,
          },
        })
      );
    },
    [run]
  );

  const closeSession = useCallback(
    (closingCash: number) => {
      void run(
        () => Api.closeSession(closingCash),
        (prev) =>
          prev.posSession
            ? {
                ...prev,
                posSession: {
                  ...prev.posSession,
                  isOpen: false,
                  closingCash,
                  endTime: new Date().toISOString(),
                },
              }
            : prev
      );
    },
    [run]
  );

  /* ----------------------------- BOOKING ------------------------------ */
  const createBooking = useCallback<StoreValue['createBooking']>(
    async (input) => {
      const packagePrice = input.packagePrice ?? 0;
      const depositAmount = Math.round(packagePrice * DEPOSIT_RATE) || 100000;

      if (mode === 'server') {
        try {
          const result = await Api.createBooking({
            guestName: input.guestName,
            guestPhone: input.guestPhone,
            guestEmail: input.guestEmail || undefined,
            partySize: input.partySize,
            date: input.date,
            timeSlot: input.timeSlot,
            tableId: input.tableId,
            specialRequests: input.specialRequests,
            packagePrice,
            packageName: input.packagePrice ? `Paket ${formatPackageLabel(input.packagePrice)}` : 'Tanpa Paket',
          });
          const fresh = await refresh();
          const booking = fresh?.bookings.find((b) => b.bookingCode === String(result.bookingCode));
          if (booking) return booking;
          const table = fresh?.tables.find((t) => t.id === String(result.tableId ?? ''));
          return {
            id: String(result.id ?? result.bookingCode),
            bookingCode: String(result.bookingCode),
            guestName: input.guestName,
            guestPhone: input.guestPhone,
            guestEmail: input.guestEmail ?? '',
            partySize: input.partySize,
            date: input.date,
            timeSlot: input.timeSlot,
            tableId: String(result.tableId ?? input.tableId),
            tableNo: table?.tableNo ?? '-',
            depositAmount,
            depositStatus: 'pending',
            specialRequests: input.specialRequests,
            status: 'pending_payment',
            createdAt: new Date().toISOString(),
          };
        } catch (error) {
          setLastError(error instanceof ApiRequestError ? error.message : 'Gagal membuat reservasi.');
          return null;
        }
      }

      const seq = state.counters.booking + 1;
      const code = `BKG-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`;
      const table = state.tables.find((t) => t.id === input.tableId);
      const booking: TableBooking = {
        id: uid('bkg'),
        bookingCode: code,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        guestEmail: input.guestEmail,
        partySize: input.partySize,
        date: input.date,
        timeSlot: input.timeSlot,
        tableId: input.tableId,
        tableNo: table?.tableNo ?? '-',
        depositAmount,
        depositStatus: 'pending',
        specialRequests: input.specialRequests,
        status: 'pending_payment',
        createdAt: new Date().toISOString(),
      };
      update((prev) => ({
        ...prev,
        bookings: [booking, ...prev.bookings],
        counters: { ...prev.counters, booking: seq },
        tables: prev.tables.map((t) =>
          t.id === input.tableId ? { ...t, status: 'reserved' as const, currentBookingId: code } : t
        ),
      }));
      return booking;
    },
    [mode, refresh, state.counters.booking, state.tables, update]
  );

  const payBookingDeposit = useCallback(
    (id: string, method: PaymentMethod) => {
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking) return;
      void run(
        () => Api.payBooking(booking.bookingCode, method),
        (prev) => ({
          ...prev,
          bookings: prev.bookings.map((b) =>
            b.id === id
              ? { ...b, depositStatus: 'paid' as const, depositPaymentMethod: method, status: 'confirmed' as const }
              : b
          ),
          ledger: [
            ...prev.ledger,
            {
              id: uid('led'),
              date: todayISO(),
              description: `Deposit reservasi ${booking.bookingCode}`,
              category: 'Deposit Pelanggan' as const,
              debit: booking.depositAmount,
              credit: 0,
              referenceId: booking.bookingCode,
            },
          ],
        })
      );
    },
    [run, state.bookings]
  );

  const updateBookingStatus = useCallback(
    (id: string, status: BookingStatus) => {
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking) return;
      void run(
        () => Api.updateBooking(booking.bookingCode, status),
        (prev) => ({
          ...prev,
          bookings: prev.bookings.map((b) => (b.id === id ? { ...b, status } : b)),
          tables:
            status === 'checked_in'
              ? prev.tables.map((t) => (t.id === booking.tableId ? { ...t, status: 'occupied' as const } : t))
              : prev.tables,
        })
      );
    },
    [run, state.bookings]
  );

  const cancelBooking = useCallback(
    (id: string) => {
      const booking = state.bookings.find((b) => b.id === id);
      if (!booking) return;
      void run(
        () => Api.updateBooking(booking.bookingCode, 'cancelled'),
        (prev) => ({
          ...prev,
          bookings: prev.bookings.map((b) =>
            b.id === id
              ? {
                  ...b,
                  status: 'cancelled' as const,
                  depositStatus: b.depositStatus === 'paid' ? ('refunded' as const) : b.depositStatus,
                }
              : b
          ),
          tables: prev.tables.map((t) =>
            t.id === booking.tableId ? { ...t, status: 'available' as const, currentBookingId: undefined } : t
          ),
        })
      );
    },
    [run, state.bookings]
  );

  const isTableReserved = useCallback(
    (tableId: string, date: string, timeSlot: string) =>
      state.bookings.some(
        (b) =>
          b.tableId === tableId &&
          b.date === date &&
          b.timeSlot === timeSlot &&
          ['pending_payment', 'confirmed', 'checked_in'].includes(b.status)
      ),
    [state.bookings]
  );

  /* ---------------------------- INVENTORY ----------------------------- */
  const createPurchaseOrder = useCallback<StoreValue['createPurchaseOrder']>(
    async (input) => {
      if (mode === 'server') {
        try {
          const result = await Api.createPO({ supplierId: input.supplierId, items: input.items, notes: input.notes });
          const fresh = await refresh();
          const po = fresh?.purchaseOrders.find(
            (p) => p.id === String(result.id) || p.poNumber === String(result.poNumber)
          );
          if (po) return po;
          return {
            id: String(result.id ?? result.poNumber),
            poNumber: String(result.poNumber ?? '-'),
            supplierId: input.supplierId,
            supplierName: fresh?.suppliers.find((s) => s.id === input.supplierId)?.name ?? '-',
            items: [],
            totalCost: Number(result.totalCost ?? 0),
            status: 'submitted',
            orderDate: todayISO(),
            notes: input.notes,
          };
        } catch (error) {
          setLastError(error instanceof ApiRequestError ? error.message : 'Gagal membuat PO.');
          return null;
        }
      }

      const seq = state.counters.po + 1;
      const supplier = state.suppliers.find((s) => s.id === input.supplierId);
      const items = input.items
        .map((i) => {
          const mat = state.rawMaterials.find((m) => m.id === i.rawMaterialId);
          if (!mat) return null;
          return {
            rawMaterialId: mat.id,
            name: mat.name,
            quantity: i.quantity,
            unit: mat.unit,
            unitCost: mat.unitCost,
            subtotal: mat.unitCost * i.quantity,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const po: PurchaseOrder = {
        id: uid('po'),
        poNumber: `PO-${String(seq).padStart(4, '0')}`,
        supplierId: input.supplierId,
        supplierName: supplier?.name ?? '-',
        items,
        totalCost: items.reduce((s, i) => s + i.subtotal, 0),
        status: 'submitted',
        orderDate: todayISO(),
        notes: input.notes,
      };
      update((prev) => ({
        ...prev,
        purchaseOrders: [po, ...prev.purchaseOrders],
        counters: { ...prev.counters, po: seq },
      }));
      return po;
    },
    [mode, refresh, state.counters.po, state.rawMaterials, state.suppliers, update]
  );

  const receivePurchaseOrder = useCallback(
    (id: string) => {
      void run(
        () => Api.receivePO(id),
        (prev) => {
          const po = prev.purchaseOrders.find((p) => p.id === id);
          if (!po || po.status === 'received') return prev;
          return {
            ...prev,
            purchaseOrders: prev.purchaseOrders.map((p) =>
              p.id === id ? { ...p, status: 'received' as const, receivedDate: todayISO() } : p
            ),
            rawMaterials: prev.rawMaterials.map((m) => {
              const item = po.items.find((i) => i.rawMaterialId === m.id);
              if (!item) return m;
              const newQty = m.currentStock + item.quantity;
              return {
                ...m,
                currentStock: Number(newQty.toFixed(2)),
                unitCost: Math.round((m.currentStock * m.unitCost + item.subtotal) / newQty),
              };
            }),
            ledger: [
              ...prev.ledger,
              { id: uid('led'), date: todayISO(), description: `Pembelian ${po.poNumber}`, category: 'Persediaan' as const, debit: po.totalCost, credit: 0, referenceId: po.poNumber },
              { id: uid('led'), date: todayISO(), description: `Pembelian ${po.poNumber}`, category: 'Kas/Bank' as const, debit: 0, credit: po.totalCost, referenceId: po.poNumber },
            ],
          };
        }
      );
    },
    [run]
  );

  const adjustStock = useCallback(
    (rawMaterialId: string, delta: number, reason: string) => {
      void run(
        () => Api.adjustStock({ rawMaterialId, delta, reason }),
        (prev) => {
          const material = prev.rawMaterials.find((m) => m.id === rawMaterialId);
          if (!material) return prev;
          const amount = Math.abs(delta * material.unitCost);
          return {
            ...prev,
            rawMaterials: prev.rawMaterials.map((m) =>
              m.id === rawMaterialId
                ? { ...m, currentStock: Math.max(0, Number((m.currentStock + delta).toFixed(2))) }
                : m
            ),
            ledger: [
              ...prev.ledger,
              {
                id: uid('led'),
                date: todayISO(),
                description: `Penyesuaian stok ${material.name} — ${reason}`,
                category: 'Persediaan' as const,
                debit: delta > 0 ? amount : 0,
                credit: delta < 0 ? amount : 0,
              },
            ],
          };
        }
      );
    },
    [run]
  );

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    void refresh();
  }, [refresh]);

  const value: StoreValue = {
    ...state,
    mounted,
    loading,
    mode,
    user,
    lastError,
    connection,
    liveEvent,
    refresh,
    login,
    logout,
    dismissError: () => setLastError(null),
    addToCart,
    updateCartQty,
    removeFromCart,
    clearCart,
    setCartTable,
    cartSubtotal,
    toggleMenuAvailability,
    updateMenuItem,
    findMenuByBarcode,
    placeOrder,
    updateOrderStatus,
    payOrder,
    voidOrder,
    openSession,
    closeSession,
    createBooking,
    payBookingDeposit,
    updateBookingStatus,
    cancelBooking,
    isTableReserved,
    createPurchaseOrder,
    receivePurchaseOrder,
    adjustStock,
    resetDemo,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function formatPackageLabel(price: number) {
  if (price >= 1000000) return 'Private Event';
  if (price >= 300000) return 'Makan Malam';
  if (price >= 150000) return 'Makan Siang';
  return 'Reguler';
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore harus dipakai di dalam <StoreProvider>');
  return ctx;
}