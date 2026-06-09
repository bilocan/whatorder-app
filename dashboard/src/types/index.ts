import type { Timestamp } from 'firebase/firestore';

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
  createdAt: Timestamp | string | null;
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

export interface Business {
  id: string;
  name: string;
  phone: string;
  whatsappNumber?: string;
  timezone?: string;
  avgPrepTime?: number;
  status: 'active' | 'paused';
  createdAt?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface PhoneRouting {
  id: string;           // the Meta phone_number_id (document ID)
  businessId: string;
  displayNumber?: string;
}

export interface Owner {
  uid: string;          // Firebase UID (document ID)
  businessId: string;
}

export interface Admin {
  uid: string;          // Firebase UID (document ID)
}

export interface Customer {
  phone: string;
  name: string;
  totalSpent: number;
  orderCount: number;
  lastOrderDate: string;
}

export function toDate(v: Timestamp | string | null | undefined): Date {
  if (!v) return new Date(0);
  if (typeof v === 'string') return new Date(v);
  if (typeof (v as Timestamp).toDate === 'function') return (v as Timestamp).toDate();
  // Plain {seconds, nanoseconds} — Firestore Timestamp serialized to plain object
  const secs = (v as unknown as { seconds?: number }).seconds;
  if (typeof secs === 'number') return new Date(secs * 1000);
  return new Date(0);
}
