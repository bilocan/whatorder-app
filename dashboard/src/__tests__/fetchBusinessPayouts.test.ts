import { describe, it, expect } from 'vitest'
import { sortByPaidAtDesc, isIndexNotReadyError } from '../lib/fetchBusinessPayouts'
import type { Payout } from '../types'

describe('fetchBusinessPayouts helpers', () => {
  it('sortByPaidAtDesc orders newest first', () => {
    const rows: Payout[] = [
      { id: 'a', businessId: 'b', orderIds: [], totalNetCents: 1, status: 'paid', connectMode: 'mock', paidAt: '2026-06-01T10:00:00Z' },
      { id: 'b', businessId: 'b', orderIds: [], totalNetCents: 2, status: 'paid', connectMode: 'mock', paidAt: '2026-06-10T10:00:00Z' },
    ]
    expect(sortByPaidAtDesc(rows).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('isIndexNotReadyError detects failed-precondition', () => {
    expect(isIndexNotReadyError({ code: 'failed-precondition', message: 'index' })).toBe(true)
    expect(isIndexNotReadyError(new Error('The query requires an index'))).toBe(true)
    expect(isIndexNotReadyError(new Error('permission-denied'))).toBe(false)
  })
})
