import { describe, expect, it } from 'vitest'
import type { OrderBelegPrintInput } from '../printOrderBeleg'
import {
  claimKitchenJob,
  nextPaidArrivalPrints,
  parseKitchenPrint,
  postKitchenBon,
  releaseKitchenJob,
  validateKitchenPrint,
  type KitchenPrint,
} from '../kitchenPrint'

const SLIP: OrderBelegPrintInput = {
  code: '0XG2YS',
  customerName: 'Ayse',
  customerPhone: '905323458516',
  orderedAt: '06.10.26, 23:30',
  lines: [{ label: '1× Döner', amount: '€8.00' }],
  adjustments: [],
  totalLabel: 'Gesamt',
  totalAmount: '€8.00',
}

describe('parseKitchenPrint', () => {
  it('parses missing raw as chrome on the windows target', () => {
    expect(parseKitchenPrint(undefined)).toEqual({
      mode: 'chrome',
      target: 'windows',
      value: '',
      autoPrint: true,
      printOnPaid: false,
    })
  })

  it('treats an unknown mode as chrome and an unknown target as windows', () => {
    expect(parseKitchenPrint({ mode: 'usb', target: 'bluetooth', value: 'EPSON' })).toEqual({
      mode: 'chrome',
      target: 'windows',
      value: 'EPSON',
      autoPrint: true,
      printOnPaid: false,
    })
  })

  it('turns print on paid on only when the saved value is true', () => {
    expect(parseKitchenPrint({ printOnPaid: true }).printOnPaid).toBe(true)
    expect(parseKitchenPrint({ printOnPaid: false }).printOnPaid).toBe(false)
    expect(parseKitchenPrint({}).printOnPaid).toBe(false)
  })

  it('keeps auto print on unless the saved value is false', () => {
    expect(parseKitchenPrint({ mode: 'local', autoPrint: false }).autoPrint).toBe(false)
    expect(parseKitchenPrint({ mode: 'local', autoPrint: true }).autoPrint).toBe(true)
    expect(parseKitchenPrint({ mode: 'local' }).autoPrint).toBe(true)
  })
})

describe('nextPaidArrivalPrints', () => {
  const pending = (id: string, paymentStatus?: string, paymentMethod?: string) => ({
    id,
    status: 'pending',
    paymentMethod,
    paymentStatus,
  })

  it('remembers orders already on the board and prints none', () => {
    const first = nextPaidArrivalPrints(null, [pending('a', 'paid', 'stripe'), pending('b', 'cash', 'cash')])
    expect(first.toPrint).toEqual([])
    expect([...first.seen]).toEqual(['a', 'b'])
  })

  it('prints a card order when it becomes paid, and a cash order when it lands', () => {
    const first = nextPaidArrivalPrints(null, [pending('waiting', 'pending', 'stripe')])
    const paid = nextPaidArrivalPrints(first.seen, [pending('waiting', 'paid', 'stripe'), pending('cash', 'cash', 'cash')])
    expect(paid.toPrint.map((order) => order.id)).toEqual(['waiting', 'cash'])
  })

  it('does not print an unpaid card order or an order that already printed', () => {
    const first = nextPaidArrivalPrints(null, [])
    const unpaid = nextPaidArrivalPrints(first.seen, [pending('card', 'pending', 'stripe'), { id: 'done', status: 'approved', paymentMethod: 'stripe', paymentStatus: 'paid' }])
    expect(unpaid.toPrint).toEqual([])
    const again = nextPaidArrivalPrints(unpaid.seen, [pending('card', 'paid', 'stripe')])
    expect(again.toPrint.map((order) => order.id)).toEqual(['card'])
    const duplicate = nextPaidArrivalPrints(again.seen, [pending('card', 'paid', 'stripe')])
    expect(duplicate.toPrint).toEqual([])
  })
})

describe('validateKitchenPrint', () => {
  it('accepts chrome when the value is EPSON', () => {
    const print: KitchenPrint = { mode: 'chrome', target: 'windows', value: 'EPSON', autoPrint: true, printOnPaid: false }
    expect(validateKitchenPrint(print)).toBeNull()
  })

  it('accepts chrome when the value is empty', () => {
    const print: KitchenPrint = { mode: 'chrome', target: 'windows', value: '', autoPrint: true, printOnPaid: false }
    expect(validateKitchenPrint(print)).toBeNull()
  })

  it('returns name when the local windows name is empty', () => {
    const print: KitchenPrint = { mode: 'local', target: 'windows', value: '', autoPrint: true, printOnPaid: false }
    expect(validateKitchenPrint(print)).toBe('name')
  })

  it('accepts a local IPv4 address with no port', () => {
    const print: KitchenPrint = { mode: 'local', target: 'ip', value: '192.168.0.5', autoPrint: true, printOnPaid: false }
    expect(validateKitchenPrint(print)).toBeNull()
  })

  it('accepts a local IPv4 address with a port from 1 to 65535', () => {
    expect(validateKitchenPrint({ mode: 'local', target: 'ip', value: '192.168.0.5:9100' })).toBeNull()
    expect(validateKitchenPrint({ mode: 'local', target: 'ip', value: '10.0.0.1:1' })).toBeNull()
    expect(validateKitchenPrint({ mode: 'local', target: 'ip', value: '10.0.0.1:65535' })).toBeNull()
  })

  it('returns ip when the port is outside 1 to 65535', () => {
    expect(validateKitchenPrint({ mode: 'local', target: 'ip', value: '192.168.0.5:0' })).toBe('ip')
    expect(validateKitchenPrint({ mode: 'local', target: 'ip', value: '10.0.0.1:65536' })).toBe('ip')
  })

  it('returns ip for a hostname', () => {
    const print: KitchenPrint = { mode: 'local', target: 'ip', value: 'printer.local', autoPrint: true, printOnPaid: false }
    expect(validateKitchenPrint(print)).toBe('ip')
  })

  it('accepts a trimmed windows name of length 1 to 220 and rejects 221', () => {
    expect(validateKitchenPrint({ mode: 'local', target: 'windows', value: 'A' })).toBeNull()
    expect(validateKitchenPrint({ mode: 'local', target: 'windows', value: ` ${'B'.repeat(220)} ` })).toBeNull()
    expect(validateKitchenPrint({ mode: 'local', target: 'windows', value: 'C'.repeat(221) })).toBe('name')
  })
})

describe('claimKitchenJob', () => {
  it('is false the second time until the job is released', () => {
    const jobs = new Set<string>()
    expect(claimKitchenJob(jobs, 'order-1')).toBe(true)
    expect(claimKitchenJob(jobs, 'order-1')).toBe(false)
    releaseKitchenJob(jobs, 'order-1')
    expect(claimKitchenJob(jobs, 'order-1')).toBe(true)
  })
})

describe('postKitchenBon', () => {
  it('does not call fetch when the printer name is missing', async () => {
    let called = false
    const fetchImpl: typeof fetch = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const result = await postKitchenBon(
      { mode: 'local', target: 'windows', value: '' },
      SLIP,
      fetchImpl,
    )
    expect(result).toEqual({ ok: false, kind: 'missing' })
    expect(called).toBe(false)
  })

  it('does not call fetch when the address is invalid', async () => {
    let called = false
    const fetchImpl: typeof fetch = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const result = await postKitchenBon(
      { mode: 'local', target: 'ip', value: 'printer.local' },
      SLIP,
      fetchImpl,
    )
    expect(result).toEqual({ ok: false, kind: 'missing' })
    expect(called).toBe(false)
  })

  it('returns unreachable when fetch rejects', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('network')
    }
    const result = await postKitchenBon(
      { mode: 'local', target: 'windows', value: 'EPSON' },
      SLIP,
      fetchImpl,
    )
    expect(result).toEqual({ ok: false, kind: 'unreachable' })
  })

  it('returns remote with the error message on HTTP 500', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'offline' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    const result = await postKitchenBon(
      { mode: 'local', target: 'windows', value: 'EPSON' },
      SLIP,
      fetchImpl,
    )
    expect(result).toEqual({ ok: false, kind: 'remote', message: 'offline' })
  })

  it('returns remote with the error message on HTTP 400', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'bad json' }), { status: 400 })
    const result = await postKitchenBon(
      { mode: 'local', target: 'ip', value: '192.168.0.5' },
      SLIP,
      fetchImpl,
    )
    expect(result).toEqual({ ok: false, kind: 'remote', message: 'bad json' })
  })

  it('returns unreachable when the body is not JSON', async () => {
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 200 })
    const result = await postKitchenBon(
      { mode: 'local', target: 'windows', value: 'EPSON' },
      SLIP,
      fetchImpl,
    )
    expect(result).toEqual({ ok: false, kind: 'unreachable' })
  })

  it('returns unreachable when a hanging fetch is aborted', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        const abort = () => reject(new DOMException('Aborted', 'AbortError'))
        if (signal.aborted) {
          abort()
          return
        }
        signal.addEventListener('abort', abort)
      })
    const result = await postKitchenBon(
      { mode: 'local', target: 'windows', value: 'EPSON' },
      SLIP,
      fetchImpl,
      20,
    )
    expect(result).toEqual({ ok: false, kind: 'unreachable' })
  }, 1000)

  it('sends a chrome-valid local post as JSON with target windows and the slip code', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    const fetchImpl: typeof fetch = async (input, init) => {
      captured = { url: String(input), init }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const result = await postKitchenBon(
      { mode: 'chrome', target: 'windows', value: 'EPSON' },
      SLIP,
      fetchImpl,
    )
    expect(result).toEqual({ ok: true })
    expect(captured?.url).toBe('http://127.0.0.1:17341/print')
    expect(captured?.init?.method).toBe('POST')
    expect(new Headers(captured?.init?.headers).get('content-type')).toBe('application/json')
    const body = JSON.parse(String(captured?.init?.body)) as {
      target: string
      value: string
      slip: OrderBelegPrintInput
    }
    expect(body.target).toBe('windows')
    expect(body.value).toBe('EPSON')
    expect(body.slip.code).toBe(SLIP.code)
    expect(body.slip).toEqual(SLIP)
  })
})
