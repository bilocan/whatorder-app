import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AiConfigPage from '../pages/admin/AiConfigPage'

vi.mock('../lib/firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('token'),
    },
  },
}))

vi.mock('../lib/apiUrl', () => ({ API_URL: '' }))

const catalogPayload = {
  catalog: {
    providers: [
      { id: 'google', ready: true },
      { id: 'openrouter', ready: false },
    ],
    models: [
      { label: 'gemini-2.5-flash-lite', model: 'gemini-2.5-flash-lite', provider: 'google' },
      { label: 'OR google/gemini-2.5-flash-lite', model: 'google/gemini-2.5-flash-lite', provider: 'openrouter' },
    ],
    envDefaults: {
      aiIntentEnabled: true,
      llmProvider: 'google',
      llmModel: 'gemini-2.5-flash-lite',
      llmFallbackProvider: null,
      llmFallbackModel: null,
    },
    ops: {
      timeoutMs: 8000,
      retryAttempts: 3,
      rateLimitMs: 60000,
      dailyCallCap: 5000,
    },
  },
  selection: {
    aiIntentEnabled: true,
    llmProvider: 'google',
    llmModel: 'gemini-2.5-flash-lite',
    llmFallbackProvider: null,
    llmFallbackModel: null,
  },
  status: {
    source: 'env',
    primaryLabel: 'gemini-2.5-flash-lite',
    primaryReady: true,
    fallbackConfigured: false,
    dailyCallCount: 12,
    dailyCallCap: 5000,
    dailyDate: '2026-07-20',
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastOk: null,
    lastError: null,
    lastProvider: null,
    lastModel: null,
    lastLatencyMs: null,
  },
}

describe('AiConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => catalogPayload,
    })
  })

  it('renders catalog and saves selection', async () => {
    const user = userEvent.setup()
    render(<AiConfigPage />)

    await waitFor(() => {
      expect(screen.getByText('AI config')).toBeInTheDocument()
    })

    expect(screen.getByText(/Today \(UTC\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Last call: never/i)).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/admin/llm-config', expect.any(Object))

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...catalogPayload,
        selection: { ...catalogPayload.selection, aiIntentEnabled: false },
        status: { ...catalogPayload.status, source: 'firestore' },
      }),
    })

    await user.selectOptions(screen.getByDisplayValue('On'), 'off')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/admin/llm-config', expect.objectContaining({
        method: 'PUT',
      }))
    })
  })
})
