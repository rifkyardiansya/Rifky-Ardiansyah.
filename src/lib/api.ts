/**
 * Client API terpusat untuk seluruh modul.
 * Semua request memakai credentials cookie sehingga JWT tersimpan HttpOnly.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'same-origin',
    cache: 'no-store',
  });

  let payload: ApiEnvelope<T> = { success: false };
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    /* respons non-JSON */
  }

  if (!res.ok || !payload.success) {
    throw new ApiRequestError(res.status, payload.error ?? `Request gagal (${res.status})`, payload.code);
  }
  return payload.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/* ---------------------------- Tipe payload ---------------------------- */

export interface SessionPayload {
  id: string;
  username: string;
  fullName: string;
  role: 'customer' | 'cashier' | 'manager' | 'admin';
}

export interface ScanResult {
  kind: 'menu_item' | 'table' | 'takeaway' | 'invalid';
  item?: Record<string, unknown>;
  table?: Record<string, unknown>;
  message?: string;
}

export interface AvailabilityResponse {
  date: string;
  partySize: number;
  slots: { timeSlot: string; totalTables: number; availableTables: number; isOpen: boolean }[];
  tables: {
    id: string;
    table_no: string;
    capacity: number;
    section: string;
    status: string;
    available: boolean;
  }[];
  depositConfig: { deposit_type: string; deposit_value: number; penalty_percent: number; min_notice_hours: number };
}

export interface ZReport {
  sessionId: string;
  cashierName: string;
  openedAt: string;
  closedAt: string;
  openingCash: number;
  expectedCash: number;
  closingCash: number;
  difference: number;
  totalTransactions: number;
  totalRevenue: number;
  byMethod: { method: string; orders: number; revenue: number }[];
}

/* ---------------------------- Endpoint API ---------------------------- */

export const Api = {
  get: <T>(path: string) => api.get<T>(path),
  post: <T>(path: string, body?: unknown) => api.post<T>(path, body),
  patch: <T>(path: string, body?: unknown) => api.patch<T>(path, body),
  del: <T>(path: string) => api.delete<T>(path),

  login: (username: string, password: string) =>
    api.post<SessionPayload>('/auth/login', { username, password }),
  register: (body: { username: string; fullName: string; email: string; password: string }) =>
    api.post<{ id: string; username: string }>('/auth/register', body),
  me: () => api.get<{ user: SessionPayload | null }>('/auth/me'),
  logout: () => api.delete<{ loggedOut: boolean }>('/auth/me'),

  snapshot: () => api.get<Record<string, unknown>>('/snapshot'),

  scanBarcode: (code: string) => api.post<ScanResult>('/customer/scan-barcode', { code }),
  menu: (params?: { category?: string; q?: string }) =>
    api.get<{ items: Record<string, unknown>[]; categories: string[] }>(
      `/customer/menu${params ? `?${new URLSearchParams(params)}` : ''}`
    ),
  createCustomerOrder: (body: unknown) => api.post<Record<string, unknown>>('/customer/orders', body),

  posTransaction: (body: unknown) => api.post<Record<string, unknown>>('/pos/transactions', body),
  posPay: (orderId: string, body: { method: string; cashReceived?: number }) =>
    api.post<Record<string, unknown>>(`/pos/transactions/${orderId}/pay`, body),
  posVoid: (orderId: string, reason: string) =>
    api.post<Record<string, unknown>>(`/pos/transactions/${orderId}/void`, { reason }),
  posSession: () => api.get<{ session: Record<string, unknown> | null }>('/pos/session'),
  openSession: (openingCash: number, cashierName?: string) =>
    api.post<Record<string, unknown>>('/pos/session', { openingCash, cashierName }),
  closeSession: (closingCash: number) => api.patch<ZReport>('/pos/session', { closingCash }),

  orderStatus: (orderId: string, status: string) =>
    api.patch<Record<string, unknown>>(`/orders/${orderId}`, { status }),

  availability: (date: string, partySize: number) =>
    api.get<AvailabilityResponse>(`/booking/availability?date=${date}&partySize=${partySize}`),
  createBooking: (body: unknown) => api.post<Record<string, unknown>>('/booking', body),
  payBooking: (code: string, method: string) => api.post<Record<string, unknown>>(`/booking/${code}/payment`, { method }),
  updateBooking: (code: string, status: string) => api.patch<Record<string, unknown>>(`/booking/${code}`, { status }),

  inventory: () => api.get<Record<string, unknown>>('/inventory'),
  createPO: (body: unknown) => api.post<Record<string, unknown>>('/inventory/purchase-orders', body),
  receivePO: (id: string) => api.post<Record<string, unknown>>(`/inventory/purchase-orders/${id}/receive`),
  adjustStock: (body: { rawMaterialId: string; delta: number; reason: string }) =>
    api.post<Record<string, unknown>>('/inventory/stock-adjustments', body),
  updateProduct: (id: string, body: { name?: string; price?: number; isActive?: boolean }) =>
    api.patch<Record<string, unknown>>(`/inventory/products/${id}`, body),

  report: (type: string) => api.get<Record<string, unknown>>(`/reports?type=${type}`),  reportHistory: () => api.get<{ history: Record<string, unknown>[]; dailySummaries?: { period: string; omzet: number; transaksi: number }[] }>('/reports/export'),

  auditLogs: (limit = 150) =>
    api.get<{ logs: Record<string, unknown>[]; stats: { action: string; total: number }[] }>(
      `/audit-logs?limit=${limit}`
    ),
  dailyReportPreview: (date?: string) =>
    api.get<Record<string, unknown>>(`/cron/daily-report?preview=1${date ? `&date=${date}` : ''}`),
  exportReport: (body: { reportType: string; period: string; format: string }) =>
    api.post<Record<string, unknown>>('/reports/export', body),
};