import { describe, it, expect } from 'vitest'
import {
  boardColumnForStatus,
  groupOrdersByColumn,
  ACTIVE_BOARD_COLUMNS,
  belongsToBoardDay,
  isCompletedToday,
  localDayKey,
  shiftLocalDayKey,
  startOfLocalDayMs,
} from '../orderBoardColumns'
import { orderElapsed } from '../orderElapsed'
import { getPrimaryAction, getActionButtons } from '../orderActions'
import type { Order } from '../../types'

describe('orderBoardColumns', () => {
  it('maps statuses to columns', () => {
    expect(boardColumnForStatus('pending')).toBe('new')
    expect(boardColumnForStatus('approved')).toBe('preparing')
    expect(boardColumnForStatus('preparing')).toBe('preparing')
    expect(boardColumnForStatus('ready')).toBe('delivery')
    expect(boardColumnForStatus('on_the_way')).toBe('delivery')
    expect(boardColumnForStatus('delivered')).toBe('done')
    expect(boardColumnForStatus('rejected')).toBe('done')
  })

  it('groups orders by column', () => {
    const orders = [
      { id: '1', status: 'pending' },
      { id: '2', status: 'ready' },
      { id: '3', status: 'on_the_way' },
      { id: '4', status: 'completed' },
    ] as Order[]
    const g = groupOrdersByColumn(orders)
    expect(g.new).toHaveLength(1)
    expect(g.delivery).toHaveLength(2)
    expect(g.done).toHaveLength(1)
    expect(g.preparing).toHaveLength(0)
  })

  it('active board columns are New → Preparing → Delivery → Done', () => {
    expect(ACTIVE_BOARD_COLUMNS.map((c) => c.key)).toEqual([
      'new',
      'preparing',
      'delivery',
      'done',
    ])
  })

  it('shiftLocalDayKey steps calendar days', () => {
    expect(shiftLocalDayKey('2026-07-16', -1)).toBe('2026-07-15')
    expect(shiftLocalDayKey('2026-07-01', -1)).toBe('2026-06-30')
    expect(shiftLocalDayKey('2026-07-15', 1)).toBe('2026-07-16')
  })

  it('Done shows only orders completed today (local calendar day)', () => {
    const now = Date.parse('2026-07-16T15:00:00.000Z')
    // Build a "today" stamp in local TZ relative to `now`
    const todayMs = startOfLocalDayMs(now) + 2 * 60 * 60 * 1000
    const yesterdayMs = startOfLocalDayMs(now) - 60 * 60 * 1000
    const oldCreated = new Date(now - 96 * 60 * 60 * 1000).toISOString()

    expect(
      isCompletedToday(
        { status: 'delivered', createdAt: oldCreated, deliveredAt: new Date(todayMs).toISOString() } as Order,
        now,
      ),
    ).toBe(true)
    expect(
      isCompletedToday(
        { status: 'delivered', createdAt: oldCreated, deliveredAt: new Date(yesterdayMs).toISOString() } as Order,
        now,
      ),
    ).toBe(false)
  })

  it('belongsToBoardDay is createdAt day only (ignores late completion / updatedAt)', () => {
    const day = localDayKey(Date.parse('2026-07-16T12:00:00'))
    const onDay = new Date(startOfLocalDayMs(Date.parse('2026-07-16T12:00:00')) + 3 * 60 * 60 * 1000).toISOString()
    const otherDay = new Date(startOfLocalDayMs(Date.parse('2026-07-12T12:00:00')) + 3 * 60 * 60 * 1000).toISOString()

    expect(
      belongsToBoardDay({ status: 'pending', createdAt: onDay } as Order, day),
    ).toBe(true)
    expect(
      belongsToBoardDay({ status: 'ready', createdAt: otherDay } as Order, day),
    ).toBe(false)
    // Delivered "today" but placed 4 days ago must not appear on today's board
    expect(
      belongsToBoardDay(
        {
          status: 'delivered',
          createdAt: otherDay,
          deliveredAt: onDay,
          updatedAt: onDay,
        } as Order,
        day,
      ),
    ).toBe(false)
  })

  it('isCompletedToday ignores updatedAt bumps on old terminal orders', () => {
    const now = Date.parse('2026-07-16T15:00:00.000Z')
    const todayMs = startOfLocalDayMs(now) + 2 * 60 * 60 * 1000
    const oldMs = startOfLocalDayMs(now) - 4 * 24 * 60 * 60 * 1000
    expect(
      isCompletedToday(
        {
          status: 'delivered',
          createdAt: new Date(oldMs).toISOString(),
          deliveredAt: new Date(oldMs).toISOString(),
          updatedAt: new Date(todayMs).toISOString(),
        } as Order,
        now,
      ),
    ).toBe(false)
  })

  it('legacy terminal without stamps falls back to createdAt for isCompletedToday', () => {
    const now = Date.parse('2026-07-16T15:00:00.000Z')
    const todayMs = startOfLocalDayMs(now) + 2 * 60 * 60 * 1000
    const oldMs = startOfLocalDayMs(now) - 4 * 24 * 60 * 60 * 1000
    expect(
      isCompletedToday(
        { status: 'completed', createdAt: new Date(todayMs).toISOString() } as Order,
        now,
      ),
    ).toBe(true)
    expect(
      isCompletedToday(
        { status: 'completed', createdAt: new Date(oldMs).toISOString() } as Order,
        now,
      ),
    ).toBe(false)
  })
})

describe('orderElapsed', () => {
  const now = Date.parse('2026-07-16T12:00:00.000Z')

  it('marks fresh pending orders as new', () => {
    const info = orderElapsed(now - 2 * 60_000, 'pending', now)
    expect(info.isNew).toBe(true)
    expect(info.labelKey).toBe('minutesAgo')
    expect(info.labelParams).toEqual({ count: 2 })
  })

  it('escalates urgency after 10 and 20 minutes', () => {
    expect(orderElapsed(now - 11 * 60_000, 'preparing', now).urgency).toBe('warn')
    expect(orderElapsed(now - 25 * 60_000, 'preparing', now).urgency).toBe('danger')
    expect(orderElapsed(now - 25 * 60_000, 'delivered', now).urgency).toBe('normal')
  })
})

describe('orderActions helpers', () => {
  it('returns reject plus approve for pending', () => {
    const buttons = getActionButtons('pending')
    expect(buttons.map((b) => b.action)).toEqual(['approve', 'reject'])
    expect(getPrimaryAction('pending')?.action).toBe('approve')
  })

  it('picks delivery vs pickup advance from preparing', () => {
    expect(getPrimaryAction('preparing', 'delivery')?.action).toBe('on-the-way')
    expect(getPrimaryAction('preparing', 'pickup')?.action).toBe('ready')
  })
})
