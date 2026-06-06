export type OrderStatus = 'pending' | 'ready' | 'completed';

export interface OrderItem {
  name: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  notes?: string;
  createdAt: string;
  readyAt?: string;
  completedAt?: string;
  pickupTime?: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: 'mains' | 'sides' | 'drinks';
  photoUrl?: string;
  available: boolean;
}

export interface Customer {
  phone: string;
  name: string;
  totalSpent: number;
  orderCount: number;
  lastOrderDate: string;
}

export interface Business {
  id: string;
  name: string;
  phone: string;
  whatsappNumber: string;
  timezone: string;
  avgPrepTime: number;
  status: 'active' | 'paused';
}
