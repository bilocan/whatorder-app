import type { OrderBelegPrintInput } from './printOrderBeleg';

/** Local kitchen-print program on this machine. */
const LOCAL_PRINT_URL = 'http://127.0.0.1:17341/print';
const LOCAL_PRINT_TIMEOUT_MS = 8000;

export type KitchenPrintMode = 'chrome' | 'local';
export type KitchenPrintTarget = 'windows' | 'ip';

export interface KitchenPrint {
  mode: KitchenPrintMode;
  target: KitchenPrintTarget;
  value: string;
}

export type LocalPrintResult =
  | { ok: true }
  | { ok: false; kind: 'unreachable' | 'missing' | 'remote'; message?: string };

export function parseKitchenPrint(raw: unknown): KitchenPrint {
  if (!raw || typeof raw !== 'object') {
    return { mode: 'chrome', target: 'windows', value: '' };
  }
  const record = raw as Record<string, unknown>;
  return {
    mode: record.mode === 'local' ? 'local' : 'chrome',
    target: record.target === 'ip' ? 'ip' : 'windows',
    value: typeof record.value === 'string' ? record.value : '',
  };
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
