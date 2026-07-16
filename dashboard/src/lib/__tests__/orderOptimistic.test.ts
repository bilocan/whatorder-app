import { describe, it, expect } from 'vitest'
import {
  applyOptimisticToRemote,
  mergeOrdersWithOptimistic,
  stampTerminalFields,
} from '../orderOptimistic'
import type { Order } from '../../types'

describe('orderOptimistic', () => {
  it('keeps optimistic status when remote is still behind', () => {
    const remote = { id: 'o1', status: 'on_the_way' } as Order
    const patch = stampTerminalFields('delivered', '2026-07-16T12:00:00.000Z')
    const { order, clearPatch } = applyOptimisticToRemote(remote, patch)
    expect(clearPatch).toBe(false)
    expect(order.status).toBe('delivered')
    expect(order.deliveredAt).toBe('2026-07-16T12:00:00.000Z')
  })

  it('clears patch when remote catches up and fills missing stamps', () => {
    const remote = { id: 'o1', status: 'delivered' } as Order
    const patch = stampTerminalFields('delivered', '2026-07-16T12:00:00.000Z')
    const { order, clearPatch } = applyOptimisticToRemote(remote, patch)
    expect(clearPatch).toBe(true)
    expect(order.status).toBe('delivered')
    expect(order.deliveredAt).toBe('2026-07-16T12:00:00.000Z')
  })

  it('clears patch when remote moved ahead of the optimistic status', () => {
    const remote = { id: 'o1', status: 'delivered' } as Order
    const patch = { status: 'preparing' as const }
    const { order, clearPatch } = applyOptimisticToRemote(remote, patch)
    expect(clearPatch).toBe(true)
    expect(order.status).toBe('delivered')
  })

  it('merges a list and reports cleared patch ids', () => {
    const patches = new Map([
      ['o1', stampTerminalFields('delivered', '2026-07-16T12:00:00.000Z')],
      ['o2', { status: 'preparing' as const }],
    ])
    const remote = [
      { id: 'o1', status: 'delivered' },
      { id: 'o2', status: 'approved' },
    ] as Order[]
    const { orders, clearedIds } = mergeOrdersWithOptimistic(remote, patches)
    expect(clearedIds).toEqual(['o1'])
    expect(orders[0].deliveredAt).toBe('2026-07-16T12:00:00.000Z')
    expect(orders[1].status).toBe('preparing')
  })
})
