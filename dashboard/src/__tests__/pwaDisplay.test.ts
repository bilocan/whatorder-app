import { describe, it, expect, afterEach } from 'vitest'
import { isStandaloneDisplay } from '../lib/pwaDisplay'

function stubMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia
}

describe('isStandaloneDisplay', () => {
  afterEach(() => {
    stubMatchMedia(false)
    delete (navigator as Navigator & { standalone?: boolean }).standalone
  })

  it('is true when display-mode is standalone', () => {
    stubMatchMedia(true)
    expect(isStandaloneDisplay()).toBe(true)
  })

  it('is true on iOS navigator.standalone', () => {
    stubMatchMedia(false)
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    expect(isStandaloneDisplay()).toBe(true)
  })

  it('is false otherwise', () => {
    stubMatchMedia(false)
    expect(isStandaloneDisplay()).toBe(false)
  })
})
