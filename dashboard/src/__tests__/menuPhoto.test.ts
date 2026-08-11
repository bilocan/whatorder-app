import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockUploadBytes, mockGetDownloadURL, mockDeleteObject, mockRef } = vi.hoisted(() => ({
  mockUploadBytes: vi.fn(),
  mockGetDownloadURL: vi.fn(),
  mockDeleteObject: vi.fn(),
  mockRef: vi.fn((_storage: unknown, path: string) => ({ path })),
}))

vi.mock('../lib/firebase', () => ({ storage: {} }))
vi.mock('firebase/storage', () => ({
  ref: mockRef,
  uploadBytes: mockUploadBytes,
  getDownloadURL: mockGetDownloadURL,
  deleteObject: mockDeleteObject,
}))

const { uploadMenuPhoto, deleteMenuPhotoBestEffort, normalizeFlowListImageBase64, MenuPhotoError, FLOW_LIST_IMAGE_MAX_BYTES } = await import('../lib/menuPhoto')

function makeFile(name: string, type: string, sizeBytes: number): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type })
  return new File([blob], name, { type })
}

describe('uploadMenuPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadBytes.mockResolvedValue(undefined)
    mockGetDownloadURL.mockResolvedValue('https://cdn.example.com/photo.jpg')
  })

  it('rejects non-image files', async () => {
    const file = makeFile('menu.pdf', 'application/pdf', 100)
    await expect(uploadMenuPhoto('biz1', file)).rejects.toBeInstanceOf(MenuPhotoError)
    expect(mockUploadBytes).not.toHaveBeenCalled()
  })

  it('rejects files larger than 5MB', async () => {
    const file = makeFile('big.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1)
    await expect(uploadMenuPhoto('biz1', file)).rejects.toBeInstanceOf(MenuPhotoError)
    expect(mockUploadBytes).not.toHaveBeenCalled()
  })

  it('uploads under menu-photos/{businessId}/ and returns the download URL', async () => {
    const file = makeFile('doner.jpg', 'image/jpeg', 1024)
    const url = await uploadMenuPhoto('biz1', file)
    expect(url).toBe('https://cdn.example.com/photo.jpg')
    expect(mockRef).toHaveBeenCalledWith({}, expect.stringMatching(/^menu-photos\/biz1\/.+-doner\.jpg$/))
    expect(mockUploadBytes).toHaveBeenCalledTimes(1)
  })
})

describe('deleteMenuPhotoBestEffort', () => {
  it('swallows errors instead of throwing', async () => {
    mockDeleteObject.mockRejectedValue(new Error('not found'))
    await expect(deleteMenuPhotoBestEffort('https://cdn.example.com/photo.jpg')).resolves.toBeUndefined()
  })
})

describe('normalizeFlowListImageBase64', () => {
  it('strips data URL prefix', () => {
    expect(normalizeFlowListImageBase64('data:image/jpeg;base64,abc123')).toBe('abc123')
  })

  it('rejects empty and oversized', () => {
    expect(normalizeFlowListImageBase64('')).toBeNull()
    expect(normalizeFlowListImageBase64('data:image/jpeg;base64,')).toBeNull()
    expect(normalizeFlowListImageBase64('x'.repeat(FLOW_LIST_IMAGE_MAX_BYTES + 1))).toBeNull()
  })
})
