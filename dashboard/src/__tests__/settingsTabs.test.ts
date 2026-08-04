import { describe, it, expect } from 'vitest'
import { parseSettingsTab } from '../lib/settingsTabs'

describe('parseSettingsTab', () => {
  it('defaults and rejects invalid values', () => {
    expect(parseSettingsTab(null)).toBe('restaurant')
    expect(parseSettingsTab('nope')).toBe('restaurant')
    expect(parseSettingsTab('hours')).toBe('hours')
    expect(parseSettingsTab('payments')).toBe('payments')
  })
})
