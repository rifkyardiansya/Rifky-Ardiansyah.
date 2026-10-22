import { MenuItem, RawMaterial, Supplier, RestaurantTable, Order, TableBooking, LedgerEntry, PosSession } from '../types';

export const INITIAL_SUPPLIERS: Supplier[] = [
  {
    id: 'sup-1',
    name: 'PT Berkah Pangan Nusantara',
    contactPerson: 'Bapak Gunawan',
    phone: '0812-3456-7890',
    email: 'order@berkahpangan.co.id',
    address: 'Kawasan Industri Pangan No. 12, Jakarta Timur',
    paymentTerms: 'Tempo 30 Hari'
  },
  {
    id: 'sup-2',
    name: 'CV Segar Jaya Organik',
    contactPerson: 'Ibu Ratna',
    phone: '0857-9876-5432',
    email: 'sales@segarjaya.id',
    address: 'Pasar Induk Kramat Jati Blok C/14',
    paymentTerms: 'COD / Tunai'
  },
  {
    id: 'sup-3',
    name: 'Distributor Kopi & Beverage Makmur',
    contactPerson: 'Hendra Saputra',
    phone: '0821-1122-3344',
    email: 'hendra@makmurbev.com',
    address: 'Jl. Radio Dalam No. 45, Jakarta Selatan',
    paymentTerms: 'Tempo 14 Hari'
  }
];

export const INITIAL_RAW_MATERIALS: RawMaterial[] = [
  {
    id: 'raw-1',
    sku: 'RAW-BRS-01',
    name: 'Beras Pandan Wangi Premium',
    category: 'Sembako',
    currentStock: 45,
    minStock: 20,
    unit: 'kg',
    unitCost: 15000,
    supplierId: 'sup-1',
    supplierName: 'PT Berkah Pangan Nusantara',
    expiryDate: '2027-03-15'
  },
  {
    id: 'raw-2',
    sku: 'RAW-AYM-01',
    name: 'Daging Ayam Fillet Segar',
    category: 'Daging & Unggas',
    currentStock: 8,
    minStock: 15, // Low stock alert demo!
    unit: 'kg',
    unitCost: 42000,
    supplierId: 'sup-2',
    supplierName: 'CV Segar Jaya Organik',
    expiryDate: '2026-10-10'
  },
  {
    id: 'raw-3',
    sku: 'RAW-SPI-01',
    name: 'Daging Sapi Gandik (Tender)',
    category: 'Daging & Unggas',
    currentStock: 18,
    minStock: 10,
    unit: 'kg',
    unitCost: 125000,
    supplierId: 'sup-1',
    supplierName: 'PT Berkah Pangan Nusantara',
    expiryDate: '2026-10-20'
  },
  {
    id: 'raw-4',
    sku: 'RAW-TLR-01',
    name: 'Telur Ayam Negeri',
    category: 'Sembako',
    currentStock: 32,
    minStock: 15,
    unit: 'kg',
    unitCost: 28000,
    supplierId: 'sup-2',
    supplierName: 'CV Segar Jaya Organik',
    expiryDate: '2026-10-18'
  },
  {
    id: 'raw-5',
    sku: 'RAW-MYK-01',
    name: 'Minyak Goreng Kelapa Sawit',
    category: 'Sembako',
    currentStock: 50,
    minStock: 25,
    unit: 'liter',
    unitCost: 17000,
    supplierId: 'sup-1',
    supplierName: 'PT Berkah Pangan Nusantara',
    expiryDate: '2027-06-30'
  },
  {
    id: 'raw-6',
    sku: 'RAW-KOP-01',
    name: 'Biji Kopi Arabika House Blend',
    category: 'Minuman',
    currentStock: 12,
    minStock: 5,
    unit: 'kg',
    unitCost: 160000,
    supplierId: 'sup-3',
    supplierName: 'Distributor Kopi & Beverage Makmur',
    expiryDate: '2027-01-10'
  },
  {
    id: 'raw-7',
    sku: 'RAW-SSU-01',
    name: 'Susu UHT Full Cream',
    category: 'Minuman',
    currentStock: 5,
    minStock: 12, // Low stock demo!
    unit: 'karton',
    unitCost: 210000,
    supplierId: 'sup-3',
    supplierName: 'Distributor Kopi & Beverage Makmur',
    expiryDate: '2026-12-05'
  },
  {
    id: 'raw-8',
    sku: 'RAW-BMB-01',
    name: 'Bumbu Dapur Segar (Bawang & Cabai)',
    category: 'Bumbu',
    currentStock: 22,
    minStock: 10,
    unit: 'kg',
    unitCost: 35000,
    supplierId: 'sup-2',
    supplierName: 'CV Segar Jaya Organik',
    expiryDate: '2026-10-14'
  }
];

export const INITIAL_MENU_ITEMS: MenuItem[] = [
  {
    id: 'menu-1',
    name: 'Nasi Goreng Spesial Resto',
    category: 'Makanan Utama',
    price: 38000,
    costPrice: 16000,
    barcode: '8991001001',
    image: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=600&q=80',
    description: 'Nasi goreng harum rempah istimewa dengan suwiran ayam, telur ceplok, sate ayam, dan kerupuk udang.',
    available: true,
    recipe: [
      { rawMaterialId: 'raw-1', amountNeeded: 0.2, unit: 'kg' },
      { rawMaterialId: 'raw-4', amountNeeded: 0.1, unit: 'kg' },
      { rawMaterialId: 'raw-2', amountNeeded: 0.1, unit: 'kg' },
      { rawMaterialId: 'raw-5', amountNeeded: 0.05, unit: 'liter' }
    ]
  },
  {
    id: 'menu-2',
    name: 'Ayam Bakar Madu Pedas',
    category: 'Makanan Utama',
    price: 42000,
    costPrice: 19000,
    barcode: '8991001002',
    image: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=600&q=80',
    description: 'Ayam pejantan panggang arang bumbu marinasi madu dan rempah pedas gurih, disajikan dengan lalapan segar.',
    available: true,
    recipe: [
      { rawMaterialId: 'raw-2', amountNeeded: 0.35, unit: 'kg' },
      { rawMaterialId: 'raw-8', amountNeeded: 0.05, unit: 'kg' }
    ]
  },
  {
    id: 'menu-3',
    name: 'Rendang Sapi Warisan Minang',
    category: 'Makanan Utama',
    price: 55000,
    costPrice: 26000,
    barcode: '8991001003',
    image: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=600&q=80',
    description: 'Daging sapi pilihan dimasak lambat 6 jam dengan santan kental dan kelapa sangrai kaya rempah aromatik.',
    available: true,
    recipe: [
      { rawMaterialId: 'raw-3', amountNeeded: 0.25, unit: 'kg' },
      { rawMaterialId: 'raw-8', amountNeeded: 0.08, unit: 'kg' }
    ]
  },
  {
    id: 'menu-4',
    name: 'Sate Ayam Madura (10 Tusuk)',
    category: 'Makanan Utama',
    price: 35000,
    costPrice: 15000,
    barcode: '8991001004',
    image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=600&q=80',
    description: 'Daging ayam lembut dibakar arang disiram bumbu kacang kental khas Madura, bawang goreng, dan lontong.',
    available: true,
    recipe: [
      { rawMaterialId: 'raw-2', amountNeeded: 0.25, unit: 'kg' }
    ]
  },
  {
    id: 'menu-5',
    name: 'Es Kopi Susu Gula Aren',
    category: 'Minuman',
    price: 24000,
    costPrice: 8500,
    barcode: '8991002001',
    image: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=600&q=80',
    description: 'Espresso double shot house blend arabika dipadu susu segar dingin dan sirup gula aren murni.',
    available: true,
    recipe: [
      { rawMaterialId: 'raw-6', amountNeeded: 0.02, unit: 'kg' },
      { rawMaterialId: 'raw-7', amountNeeded: 0.05, unit: 'karton' }
    ]
  },
  {
    id: 'menu-6',
    name: 'Es Teh Melati Spesial',
    category: 'Minuman',
    price: 12000,
    costPrice: 3000,
    barcode: '8991002002',
    image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=600&q=80',
    description: 'Seduhan daun teh melati asli pegunungan disajikan segar dingin dengan rasa manis pas menyegarkan.',
    available: true
  },
  {
    id: 'menu-7',
    name: 'Pisang Goreng Karamel Crispy',
    category: 'Camilan',
    price: 22000,
    costPrice: 7500,
    barcode: '8991003001',
    image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=600&q=80',
    description: 'Pisang kepok manis berbalut tepung renyah keemasan dengan siraman saus karamel dan parutan keju.',
    available: true
  },
  {
    id: 'menu-8',
    name: 'Tahu Cabe Garam',
    category: 'Camilan',
    price: 20000,
    costPrice: 6000,
    barcode: '8991003002',
    image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
    description: 'Tahu sutra crispy ditumis dengan potongan cabai rawit pedas, daun bawang, dan bawang putih cincang renyah.',
    available: true
  }
];

export const INITIAL_TABLES: RestaurantTable[] = [
  { id: 'tbl-1', tableNo: 'Meja 01', capacity: 2, section: 'Indoor Utama', status: 'available', x: 10, y: 15 },
  { id: 'tbl-2', tableNo: 'Meja 02', capacity: 4, section: 'Indoor Utama', status: 'occupied', currentOrderId: 'ORD-1002', x: 35, y: 15 },
  { id: 'tbl-3', tableNo: 'Meja 03', capacity: 4, section: 'Indoor Utama', status: 'available', x: 60, y: 15 },
  { id: 'tbl-4', tableNo: 'Meja 04', capacity: 6, section: 'Indoor Utama', status: 'available', x: 85, y: 15 },
  { id: 'tbl-5', tableNo: 'Meja 05', capacity: 2, section: 'Indoor Utama', status: 'available', x: 10, y: 45 },
  { id: 'tbl-6', tableNo: 'Meja 06', capacity: 4, section: 'Indoor Utama', status: 'reserved', currentBookingId: 'BKG-2026-001', x: 35, y: 45 },
  { id: 'tbl-7', tableNo: 'VIP 01', capacity: 10, section: 'VIP Room', status: 'available', x: 75, y: 45 },
  { id: 'tbl-8', tableNo: 'VIP 02', capacity: 12, section: 'VIP Room', status: 'available', x: 75, y: 75 },
  { id: 'tbl-9', tableNo: 'Out 01', capacity: 4, section: 'Outdoor Garden', status: 'available', x: 15, y: 80 },
  { id: 'tbl-10', tableNo: 'Out 02', capacity: 4, section: 'Outdoor Garden', status: 'available', x: 45, y: 80 }
];

export const INITIAL_ORDERS: Order[] = [
  {
    id: 'ord-1001',
    orderNo: 'ORD-1001',
    tableNumber: 'Meja 04',
    customerName: 'Ahmad Fauzi',
    customerPhone: '081299887766',
    items: [
      { id: 'oi-1', menuItemId: 'menu-1', name: 'Nasi Goreng Spesial Resto', price: 38000, quantity: 2, subtotal: 76000, notes: 'Pedas sedang' },
      { id: 'oi-2', menuItemId: 'menu-5', name: 'Es Kopi Susu Gula Aren', price: 24000, quantity: 2, subtotal: 48000, notes: 'Less sugar' }
    ],
    subtotal: 124000,
    tax: 12400,
    serviceCharge: 6200,
    discount: 0,
    total: 142600,
    status: 'completed',
    paymentStatus: 'paid',
    paymentMethod: 'qris',
    createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    paidAt: new Date(Date.now() - 3600000 * 2.5).toISOString(),
    source: 'customer_qr'
  },
  {
    id: 'ord-1002',
    orderNo: 'ORD-1002',
    tableNumber: 'Meja 02',
    customerName: 'Siti Rahma',
    customerPhone: '087811223344',
    items: [
      { id: 'oi-3', menuItemId: 'menu-2', name: 'Ayam Bakar Madu Pedas', price: 42000, quantity: 2, subtotal: 84000 },
      { id: 'oi-4', menuItemId: 'menu-6', name: 'Es Teh Melati Spesial', price: 12000, quantity: 2, subtotal: 24000 },
      { id: 'oi-5', menuItemId: 'menu-7', name: 'Pisang Goreng Karamel Crispy', price: 22000, quantity: 1, subtotal: 22000 }
    ],
    subtotal: 130000,
    tax: 13000,
    serviceCharge: 6500,
    discount: 0,
    total: 149500,
    status: 'cooking',
    paymentStatus: 'paid',
    paymentMethod: 'cash',
    cashReceived: 150000,
    change: 500,
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    paidAt: new Date(Date.now() - 1700000).toISOString(),
    source: 'pos_cashier'
  },
  {
    id: 'ord-1003',
    orderNo: 'ORD-1003',
    tableNumber: 'Meja 05',
    customerName: 'Budi Santoso',
    customerPhone: '085678901234',
    items: [
      { id: 'oi-6', menuItemId: 'menu-3', name: 'Rendang Sapi Warisan Minang', price: 55000, quantity: 1, subtotal: 55000 },
      { id: 'oi-7', menuItemId: 'menu-8', name: 'Tahu Cabe Garam', price: 20000, quantity: 1, subtotal: 20000 },
      { id: 'oi-8', menuItemId: 'menu-6', name: 'Es Teh Melati Spesial', price: 12000, quantity: 1, subtotal: 12000 }
    ],
    subtotal: 87000,
    tax: 8700,
    serviceCharge: 4350,
    discount: 0,
    total: 100050,
    status: 'pending',
    paymentStatus: 'unpaid',
    createdAt: new Date(Date.now() - 600000).toISOString(),
    source: 'customer_qr'
  }
];

export const INITIAL_BOOKINGS: TableBooking[] = [
  {
    id: 'bkg-1',
    bookingCode: 'BKG-2026-001',
    guestName: 'Dr. Hendra Wijaya',
    guestPhone: '0813-8899-7711',
    guestEmail: 'hendra.wijaya@gmail.com',
    partySize: 4,
    date: '2026-10-02',
    timeSlot: '19:00 - 21:00',
    tableId: 'tbl-6',
    tableNo: 'Meja 06',
    depositAmount: 100000,
    depositStatus: 'paid',
    depositPaymentMethod: 'qris',
    specialRequests: 'Dekat jendela, mohon siapkan baby chair 1 unit.',
    status: 'confirmed',
    createdAt: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: 'bkg-2',
    bookingCode: 'BKG-2026-002',
    guestName: 'PT Cipta Kreasi Dinamika (Ibu Cindy)',
    guestPhone: '0812-7766-5544',
    guestEmail: 'cindy@ciptakreasi.co.id',
    partySize: 10,
    date: '2026-10-03',
    timeSlot: '18:30 - 21:30',
    tableId: 'tbl-7',
    tableNo: 'VIP 01',
    depositAmount: 300000,
    depositStatus: 'paid',
    depositPaymentMethod: 'debit',
    specialRequests: 'Meeting makan malam direksi, proyektor disiapkan.',
    status: 'confirmed',
    createdAt: new Date(Date.now() - 43200000).toISOString()
  }
];

export const INITIAL_POS_SESSION: PosSession = {
  id: 'ses-101',
  cashierName: 'Rifky (Kasir Utama)',
  startTime: new Date(Date.now() - 3600000 * 5).toISOString(),
  openingCash: 500000,
  totalTransactions: 2,
  totalRevenue: 292100,
  isOpen: true
};

export const INITIAL_LEDGER: LedgerEntry[] = [
  {
    id: 'led-1',
    date: '2026-10-01',
    description: 'Saldo Awal Modal Kas & Bank',
    category: 'Kas/Bank',
    debit: 25000000,
    credit: 0
  },
  {
    id: 'led-2',
    date: '2026-10-01',
    description: 'Pembelian Stok Bahan Baku Awal (Beras, Daging, Sembako)',
    category: 'HPP (Bahan Baku)',
    debit: 0,
    credit: 6850000
  },
  {
    id: 'led-3',
    date: '2026-10-01',
    description: 'Biaya Listrik, Air & Gas Operasional Dapur',
    category: 'Beban Operasional',
    debit: 0,
    credit: 1250000
  },
  {
    id: 'led-4',
    date: '2026-10-02',
    description: 'Pendapatan Penjualan Restoran (ORD-1001)',
    category: 'Pendapatan',
    debit: 142600,
    credit: 0,
    referenceId: 'ORD-1001'
  },
  {
    id: 'led-5',
    date: '2026-10-02',
    description: 'Pendapatan Penjualan Restoran (ORD-1002)',
    category: 'Pendapatan',
    debit: 149500,
    credit: 0,
    referenceId: 'ORD-1002'
  },
  {
    id: 'led-6',
    date: '2026-10-02',
    description: 'Penerimaan Deposit Reservasi Meja (BKG-2026-001)',
    category: 'Deposit Pelanggan',
    debit: 100000,
    credit: 0,
    referenceId: 'BKG-2026-001'
  },
  {
    id: 'led-7',
    date: '2026-10-02',
    description: 'Penerimaan Deposit Reservasi VIP (BKG-2026-002)',
    category: 'Deposit Pelanggan',
    debit: 300000,
    credit: 0,
    referenceId: 'BKG-2026-002'
  }
];
