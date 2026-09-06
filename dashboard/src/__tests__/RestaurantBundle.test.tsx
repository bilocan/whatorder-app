import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RestaurantBundleImport from '../pages/admin/RestaurantBundleImport';

const mockRequest = vi.hoisted(() => vi.fn());
const mockUpload = vi.hoisted(() => vi.fn());
const mockPreview = vi.hoisted(() => vi.fn());
const mockRun = vi.hoisted(() => vi.fn());

vi.mock('../lib/firebase', () => ({
  db: {},
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('tok') } },
}));

vi.mock('../lib/restaurantBundleApi', async () => {
  const actual = await vi.importActual<typeof import('../lib/restaurantBundleApi')>('../lib/restaurantBundleApi');
  return {
    ...actual,
    requestImportUpload: mockRequest,
    uploadBundleFile: mockUpload,
    previewImportBundle: mockPreview,
    runImportBundle: mockRun,
    isProductionDashboard: () => false,
  };
});

vi.mock('../contexts/AdminPhoneLineContext', () => ({
  useAdminPhoneLine: () => ({
    phoneNumberId: 'phone_456',
    phoneLines: [{ id: 'phone_456' }],
    setPhoneNumberId: vi.fn(),
    loading: false,
  }),
}));

describe('RestaurantBundleImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue({
      uploadUrl: 'https://storage.example/upload',
      importToken: 'tok-1',
      objectKey: 'restaurant-bundles/default/admin/in-1.zip',
    });
    mockPreview.mockResolvedValue({
      businessId: 'biz_doner',
      businessName: 'Döner Palace',
      profile: 'setup',
      exists: false,
      warnings: [],
      counts: { menu: 3 },
      pii: false,
      importToken: 'tok-commit',
    });
  });

  it('uploads the picked File and previews with importToken, never gcsPath', async () => {
    render(<RestaurantBundleImport />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['zip'], 'biz_doner-setup.woz.zip', { type: 'application/zip' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview file' }));

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalled();
      expect(mockUpload).toHaveBeenCalledWith('https://storage.example/upload', file);
      expect(mockPreview).toHaveBeenCalledWith('tok-1');
    });
    expect(JSON.stringify(mockPreview.mock.calls)).not.toContain('gcsPath');
    expect(screen.getByText(/Döner Palace/)).toBeInTheDocument();
  });

  it('imports with the preview commit token, not the upload token', async () => {
    mockRun.mockResolvedValue({ businessId: 'biz_doner', counts: { menu: 3 }, warnings: [] });
    render(<RestaurantBundleImport />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['zip'], 'biz_doner-setup.woz.zip', { type: 'application/zip' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview file' }));
    await screen.findByText(/Döner Palace/);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({
        importToken: 'tok-commit',
        attachToPhoneLine: true,
        targetPhoneNumberId: 'phone_456',
      }));
    });
  });
});
