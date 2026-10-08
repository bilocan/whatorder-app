import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import FullscreenMinimizeButton from '../components/FullscreenMinimizeButton'

const originalMatchMedia = window.matchMedia

function stubDisplayMode(mode: string | null) {
  window.matchMedia = ((query: string) => ({
    matches: mode != null && query.includes(`display-mode: ${mode}`),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia
}

describe('FullscreenMinimizeButton', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia
    vi.unstubAllGlobals()
  })

  it('stays hidden in a browser tab', () => {
    stubDisplayMode('browser')
    render(<FullscreenMinimizeButton />)
    expect(screen.queryByRole('button', { name: 'Minimize' })).not.toBeInTheDocument()
  })

  it('asks the Windows program to minimize the installed app', async () => {
    stubDisplayMode('standalone')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exitFullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    })

    render(<FullscreenMinimizeButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:17341/minimize',
        expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
      )
    })
    expect(exitFullscreen).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an error when the kitchen program does not minimize', async () => {
    stubDisplayMode('standalone')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    render(<FullscreenMinimizeButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't minimize this window. Check the kitchen program on this computer.",
    )
  })
})
