import { describe, expect, it, vi } from 'vitest'
import { belegPaymentLine, buildOrderBelegHtml, printOrderBeleg, restaurantSlipLines, writeAndPrint, type OrderBelegPrintInput } from '../printOrderBeleg'

const INPUT: OrderBelegPrintInput = {
  code: '0XG2YS',
  restaurantName: 'Enes Kebap',
  restaurantAddress: 'Huttengasse 41, 1160 Wien',
  restaurantPhone: '+43 660 111111',
  customerName: 'Lalib <Aygün>',
  customerPhone: '905323458516',
  orderedAt: '27.09.26, 15:26',
  fulfillment: 'Lieferung',
  address: 'Huttengasse 41',
  lines: [
    { label: '2× Falafel Dürüm', amount: '€14.00' },
    { label: '1× Almdudler 0.5L', amount: '€3.50' },
  ],
  adjustments: ['Rabatt (Mittagsmenü): −€1.00'],
  totalLabel: 'Gesamt',
  totalAmount: '€17.50',
  notes: 'Hinweis: ohne Zwiebel',
  payment: 'Bezahlt per Karte',
}

describe('buildOrderBelegHtml', () => {
  it('lays the bon out for an 80 mm roll with a 72 mm print width', () => {
    const html = buildOrderBelegHtml(INPUT)
    expect(html).toContain('size: 80mm auto')
    expect(html).toContain('width: 72mm')
    expect(html).toContain('Enes Kebap')
    expect(html).toContain('Huttengasse 41, 1160 Wien')
    expect(html).toContain('+43 660 111111')
    expect(html).toContain('Bezahlt per Karte')
    expect(html).toContain('#0XG2YS')
    expect(html).toContain('2× Falafel Dürüm')
    expect(html).toContain('€17.50')
    expect(html).toContain('Huttengasse 41')
    expect(html).toContain('ohne Zwiebel')
  })

  it('escapes customer text so it cannot break the receipt markup', () => {
    const html = buildOrderBelegHtml(INPUT)
    expect(html).toContain('Lalib &lt;Aygün&gt;')
    expect(html).not.toContain('Lalib <Aygün>')
  })
})

describe('restaurantSlipLines', () => {
  it('uses the shop name, public address, and phone', () => {
    expect(restaurantSlipLines({
      name: 'Enes Kebap',
      address: 'Huttengasse 41, 1160 Wien',
      alertPhone: '+43 660 111111',
    })).toEqual({
      name: 'Enes Kebap',
      address: 'Huttengasse 41, 1160 Wien',
      phone: '+43 660 111111',
    })
  })

  it('falls back to the legal address when the public address is empty', () => {
    expect(restaurantSlipLines({
      name: '',
      legal: { legalName: 'Enes Kebap GmbH', street: 'Huttengasse 41', zip: '1160', city: 'Wien' },
    })).toEqual({
      name: 'Enes Kebap GmbH',
      address: 'Huttengasse 41, 1160 Wien',
      phone: undefined,
    })
  })
})

describe('belegPaymentLine', () => {
  const labels = {
    cash: 'Cash',
    card: 'Paid via card',
    pending: 'Unpaid',
    failed: 'Failed',
    refunded: 'Refunded',
  }

  it('names cash as the method and card only after it is paid', () => {
    expect(belegPaymentLine({}, labels)).toBe('Cash')
    expect(belegPaymentLine({ paymentMethod: 'cash', paymentStatus: 'cash' }, labels)).toBe('Cash')
    expect(belegPaymentLine({ paymentMethod: 'stripe', paymentStatus: 'paid' }, labels)).toBe('Paid via card')
    expect(belegPaymentLine({ paymentMethod: 'stripe', paymentStatus: 'pending' }, labels)).toBe('Unpaid')
  })
})

describe('writeAndPrint', () => {
  it('writes the receipt and opens the print dialog after layout', () => {
    vi.useFakeTimers()
    const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() } as unknown as Document
    const win = { focus: vi.fn(), print: vi.fn(), setTimeout: window.setTimeout } as unknown as Window
    writeAndPrint('<html>bon</html>', doc, win)
    expect(doc.write).toHaveBeenCalledWith('<html>bon</html>')
    expect(win.print).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(win.print).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('printOrderBeleg', () => {
  it('prints through a hidden frame and removes it when the dialog closes', () => {
    vi.useFakeTimers()
    const print = vi.fn()
    const addEventListener = vi.fn()
    const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() }
    const iframe = document.createElement('iframe')
    Object.defineProperty(iframe, 'contentDocument', { value: doc })
    Object.defineProperty(iframe, 'contentWindow', {
      value: { print, focus: vi.fn(), addEventListener, setTimeout: window.setTimeout },
    })
    const create = vi.spyOn(document, 'createElement').mockReturnValue(iframe)

    printOrderBeleg(INPUT)

    expect(doc.write).toHaveBeenCalledWith(expect.stringContaining('80mm'))
    vi.advanceTimersByTime(50)
    expect(print).toHaveBeenCalled()
    vi.useRealTimers()
    const afterPrint = addEventListener.mock.calls.find((call) => call[0] === 'afterprint')
    expect(afterPrint).toBeTruthy()
    document.body.appendChild(iframe)
    afterPrint?.[1]()
    expect(iframe.isConnected).toBe(false)

    create.mockRestore()
  })
})
