export type ProductCategory = 'Makanan Utama' | 'Minuman' | 'Camilan' | 'Dessert' | 'Paket Hemat';

export interface RecipeIngredient {
  rawMaterialId: string;
  amountNeeded: number; // e.g. 0.1 kg or 1 pcs
  unit: string;
}

export interface MenuItem {
  id: string;
  name: string;
  category: ProductCategory;
  price: number;
  costPrice: number; // HPP dasar
  barcode: string;
  image: string;
  description: string;
  available: boolean;
  recipe?: RecipeIngredient[];
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
}

export type OrderStatus = 'pending' | 'cooking' | 'ready' | 'served' | 'completed' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';
export type PaymentMethod = 'cash' | 'qris' | 'debit' | 'credit';

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  subtotal: number;
}

export interface Order {
  id: string;
  orderNo: string;
  tableNumber: string; // e.g. "Meja 05" or "Takeaway"
  customerName: string;
  customerPhone?: string;
  items: OrderItem[];
  subtotal: number;
  tax: number; // 10% PB1
  serviceCharge: number; // 5%
  discount: number;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  cashReceived?: number;
  change?: number;
  createdAt: string;
  paidAt?: string;
  source: 'customer_qr' | 'pos_cashier';
}

export interface PosSession {
  id: string;
  cashierName: string;
  startTime: string;
  endTime?: string;
  openingCash: number;
  closingCash?: number;
  totalTransactions: number;
  totalRevenue: number;
  isOpen: boolean;
}

export type TableStatus = 'available' | 'occupied' | 'reserved';
export type TableSection = 'Indoor Utama' | 'VIP Room' | 'Outdoor Garden';

export interface RestaurantTable {
  id: string;
  tableNo: string;
  capacity: number;
  section: TableSection;
  status: TableStatus;
  currentOrderId?: string;
  currentBookingId?: string;
  x: number; // coordinate for floor map
  y: number;
}

export type BookingStatus = 'pending_payment' | 'confirmed' | 'checked_in' | 'cancelled';

export interface TableBooking {
  id: string;
  bookingCode: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  partySize: number;
  date: string;
  timeSlot: string;
  tableId: string;
  tableNo: string;
  depositAmount: number;
  depositStatus: 'pending' | 'paid' | 'refunded';
  depositPaymentMethod?: PaymentMethod;
  specialRequests?: string;
  status: BookingStatus;
  createdAt: string;
}

export interface RawMaterial {
  id: string;
  sku: string;
  name: string;
  category: string;
  currentStock: number;
  minStock: number;
  unit: string;
  unitCost: number; // harga beli per satuan
  supplierId: string;
  supplierName: string;
  expiryDate?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  paymentTerms: string;
}

export type POStatus = 'draft' | 'submitted' | 'received' | 'cancelled';

export interface PurchaseOrderItem {
  rawMaterialId: string;
  name: string;
  quantity: number;
  unit: string;
  unitCost: number;
  subtotal: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseOrderItem[];
  totalCost: number;
  status: POStatus;
  orderDate: string;
  receivedDate?: string;
  notes?: string;
}

export type LedgerCategory =
  | 'Pendapatan'
  | 'HPP (Bahan Baku)'
  | 'Beban Operasional'
  | 'Kas/Bank'
  | 'Persediaan'
  | 'Modal'
  | 'Kewajiban PPN'
  | 'Deposit Pelanggan';

export interface LedgerEntry {
  id: string;
  date: string;
  description: string;
  category: LedgerCategory;
  debit: number;
  credit: number;
  referenceId?: string;
}
