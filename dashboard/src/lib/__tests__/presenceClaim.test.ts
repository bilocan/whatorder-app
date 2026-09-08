import { describe, expect, it } from 'vitest'
import { needsPresenceMapSeed } from '../presenceClaim'

describe('needsPresenceMapSeed', () => {
  it('is true when import stripped presenceSessions', () => {
    expect(needsPresenceMapSeed(undefined)).toBe(true)
  })

  it('is true when the field is null', () => {
    expect(needsPresenceMapSeed(null)).toBe(true)
  })

  it('is false when a tab map already exists', () => {
    expect(needsPresenceMapSeed({ tab1: { seconds: 1 } })).toBe(false)
  })

  it('is false for an empty map so dotted tab writes are allowed', () => {
    expect(needsPresenceMapSeed({})).toBe(false)
  })
})
