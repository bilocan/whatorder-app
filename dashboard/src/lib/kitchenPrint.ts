import { isKitchenPaymentBlocked } from './orderActions';
import type { OrderBelegPrintInput } from './printOrderBeleg';

/** Local kitchen-print program on this machine. */
const LOCAL_PRINT_URL = 'http://127.0.0.1:17341/print';
const LOCAL_MINIMIZE_URL = 'http://127.0.0.1:17341/minimize';
const LOCAL_PRINT_TIMEOUT_MS = 8000;

export type KitchenPrintMode = 'chrome' | 'local';
export type KitchenPrintTarget = 'windows' | 'ip';

export interface KitchenPrint {
  mode: KitchenPrintMode;
  target: KitchenPrintTarget;
  value: string;
  /** Printing the bon when the kitchen accepts. Missing on the business doc means on. */
  autoPrint: boolean;
  /** Printing the bon when a paid order lands, before accept. Missing means off. Accept does not print again. */
  printOnPaid: boolean;
}

export type LocalPrintResult =
  | { ok: true }
  | { ok: false; kind: 'unreachable' | 'missing' | 'remote'; message?: string };

export function parseKitchenPrint(raw: unknown): KitchenPrint {
  if (!raw || typeof raw !== 'object') {
    return { mode: 'chrome', target: 'windows', value: '', autoPrint: true, printOnPaid: false };
  }
  const record = raw as Record<string, unknown>;
  return {
    mode: record.mode === 'local' ? 'local' : 'chrome',
    target: record.target === 'ip' ? 'ip' : 'windows',
    value: typeof record.value === 'string' ? record.value : '',
    autoPrint: record.autoPrint !== false,
    printOnPaid: record.printOnPaid === true,
  };
}

type PaidArrivalOrder = {
  id: string;
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
};

/** First call remembers orders already on the board and prints none. Later calls return newly payable pending orders. */
export function nextPaidArrivalPrints<T extends PaidArrivalOrder>(
  seen: Set<string> | null,
  orders: T[],
): { seen: Set<string>; toPrint: T[] } {
  const printable = orders.filter((order) => order.status === 'pending' && !isKitchenPaymentBlocked(order));
  if (seen === null) {
    return { seen: new Set(printable.map((order) => order.id)), toPrint: [] };
  }
  const next = new Set(seen);
  const toPrint: T[] = [];
  for (const order of printable) {
    if (next.has(order.id)) continue;
    next.add(order.id);
    toPrint.push(order);
  }
  return { seen: next, toPrint };
}

/** Null when the value is usable. Chrome always passes. */
export function validateKitchenPrint(input: KitchenPrint): 'name' | 'ip' | null {
  if (input.mode !== 'local') return null;
  if (input.target === 'ip') return isIpv4WithOptionalPort(input.value) ? null : 'ip';
  const length = [...input.value.trim()].length;
  if (length < 1 || length > 220) return 'name';
  return null;
}

export function claimKitchenJob(jobs: Set<string>, orderId: string): boolean {
  if (jobs.has(orderId)) return false;
  jobs.add(orderId);
  return true;
}

export function releaseKitchenJob(jobs: Set<string>, orderId: string): void {
  jobs.delete(orderId);
}

/** Asks the Windows program to send the installed dashboard window to the taskbar. */
export async function requestDashboardMinimize(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = LOCAL_PRINT_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(LOCAL_MINIMIZE_URL, {
      method: 'POST',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function postKitchenBon(
  print: KitchenPrint,
  slip: OrderBelegPrintInput,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = LOCAL_PRINT_TIMEOUT_MS,
): Promise<LocalPrintResult> {
  if (validateKitchenPrint(print) !== null) {
    return { ok: false, kind: 'missing' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(LOCAL_PRINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: print.target, value: print.value, slip }),
      signal: controller.signal,
    });
    const payload = await readJson(response);
    if (payload === undefined) return { ok: false, kind: 'unreachable' };
    if (response.status === 200) return { ok: true };
    if (response.status === 400 || response.status === 500) {
      const message = remoteError(payload);
      if (message !== undefined) return { ok: false, kind: 'remote', message };
    }
    return { ok: false, kind: 'unreachable' };
  } catch {
    return { ok: false, kind: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function isIpv4WithOptionalPort(raw: string): boolean {
  const value = raw.trim();
  let host = value;
  const colon = value.lastIndexOf(':');
  if (colon !== -1) {
    host = value.slice(0, colon);
    const portText = value.slice(colon + 1);
    if (!/^\d+$/.test(portText)) return false;
    const port = Number(portText);
    if (port < 1 || port > 65535) return false;
  }
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function remoteError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = (payload as { error?: unknown }).error;
  return typeof error === 'string' ? error : undefined;
}
