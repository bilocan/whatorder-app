import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PwaInstallHint from '../components/PwaInstallHint'

describe('PwaInstallHint', () => {
  it('renders nothing when already standalone', () => {
    const { container } = render(<PwaInstallHint forceStandalone />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows Android and iOS install steps when not standalone', () => {
    render(<PwaInstallHint forceStandalone={false} />)
    expect(screen.getByRole('heading', { name: 'Use on your phone' })).toBeInTheDocument()
    expect(screen.getByText(/go to Orders/)).toBeInTheDocument()
    expect(screen.getByText(/open Orders in Safari/)).toBeInTheDocument()
  })
})
