import type { Timestamp } from 'firebase/firestore';

export type OrderStatus =
  | 'pending'
  | 'approved'
  | 'preparing'
  | 'ready'
  | 'on_the_way'
  | 'picked_up'
  | 'delivered'
  | 'rejected'
  | 'cancelled'
  | 'completed'; // legacy

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
  orderType?: 'pickup' | 'delivery';
  deliveryAddress?: string;
  deliveryFee?: number;
}

export interface MenuOption {
  id: string;
  label: string;
}

export interface MenuOptionGroup {
  id: string;
  label: string;
  type: 'single' | 'multi';
  required?: boolean;
  options: MenuOption[];
  /** multi only: preset when customer taps default / replies skip */
  multiDefault?: 'all' | 'none' | 'custom';
  /** multi + custom: which options are included in the default */
  defaultOptionIds?: string[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: 'mains' | 'sides' | 'drinks';
  photoUrl?: string;
  available: boolean;
  optionGroups?: MenuOptionGroup[];
}

export interface DaySchedule {
  openTime: string;       // 'HH:mm'
  closeTime: string;      // 'HH:mm'
  firstOrderTime: string; // 'HH:mm'
  lastOrderTime: string;  // 'HH:mm'
}

// Key is day-of-week as string ('0'=Sun … '6'=Sat); absence of a key means that day is closed.
export type BusinessSchedule = Record<string, DaySchedule>;

export interface Business {
  id: string;
  name: string;
  alertPhone: string;
  timezone?: string;
  avgPrepTime?: number;
  status: 'active' | 'paused';
  createdAt?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  deliveryEnabled?: boolean;
  deliveryFee?: number;
  deliveryZone?: string;
  minimumOrderValue?: number;
  schedule?: BusinessSchedule;
  botLanguage?: 'de' | 'tr' | 'en';
}

export interface PhoneRouting {
  id: string;             // Meta phone_number_id — numeric ID from Business Manager, used as document ID
  businessIds?: string[]; // all restaurants reachable via this phone number
  defaultBusinessId?: string; // bot uses this as fallback when the customer's session has no restaurant selected yet
  displayNumber?: string; // human-readable "+43 660 …" shown in admin UI; the document ID alone is an opaque numeric Meta ID
}

export interface Owner {
  uid: string;          // Firebase UID (document ID)
  businessId: string;
  phone?: string;
  name?: string;
}

export interface Admin {
  uid: string;          // Firebase UID (document ID)
}

export interface Customer {
  phone: string;
  name: string;
  totalSpent: number;
  orderCount: number;
  lastOrderDate: Timestamp | string | null;
  lastDeliveryAddress?: string;
  savedAddresses?: string[];
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
