import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RestaurantBundleImport from '../pages/admin/RestaurantBundleImport';

const mockRequest = vi.hoisted(() => vi.fn());
const mockUpload = vi.hoisted(() => vi.fn());
const mockPreview = vi.hoisted(() => vi.fn());
const mockRun = vi.hoisted(() => vi.fn());
const mockSetPhoneNumberId = vi.hoisted(() => vi.fn());
const phoneLineState = vi.hoisted(() => ({
  phoneNumberId: '1147794621759163' as string | undefined,
  phoneLines: [
    { id: '1147794621759163', displayNumber: '+1 (555) 196-1529' },
    { id: '1056173694256337', displayNumber: '+1 (555) 650-3274' },
  ],
  loading: false,
}));

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
    phoneNumberId: phoneLineState.phoneNumberId,
    phoneLines: phoneLineState.phoneLines,
    setPhoneNumberId: mockSetPhoneNumberId,
    loading: phoneLineState.loading,
  }),
}));

async function previewFile() {
  render(<RestaurantBundleImport />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['zip'], 'biz_doner-setup.woz.zip', { type: 'application/zip' });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview file' }));
  await screen.findByText(/Döner Palace/);
}

describe('RestaurantBundleImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    phoneLineState.phoneNumberId = '1147794621759163';
    phoneLineState.phoneLines = [
      { id: '1147794621759163', displayNumber: '+1 (555) 196-1529' },
      { id: '1056173694256337', displayNumber: '+1 (555) 650-3274' },
    ];
    phoneLineState.loading = false;
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
    await previewFile();
    expect(mockRequest).toHaveBeenCalled();
    expect(mockUpload).toHaveBeenCalled();
    expect(mockPreview).toHaveBeenCalledWith('tok-1');
    expect(JSON.stringify(mockPreview.mock.calls)).not.toContain('gcsPath');
  });

  it('requires a WhatsApp line and always attaches to the selected inbound number', async () => {
    mockRun.mockResolvedValue({ businessId: 'biz_doner', counts: { menu: 3 }, warnings: [] });
    await previewFile();
    expect(screen.getByLabelText('WhatsApp line for the bot list')).toHaveValue('1147794621759163');
    expect(screen.getByRole('option', { name: '+1 (555) 196-1529 (…759163)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({
        importToken: 'tok-commit',
        attachToPhoneLine: true,
        targetPhoneNumberId: '1147794621759163',
      }));
    });
    expect(await screen.findByText('Imported biz_doner. Bot list: +1 (555) 196-1529 (…759163).')).toBeInTheDocument();
  });

  it('blocks import when no WhatsApp line is selected', async () => {
    phoneLineState.phoneNumberId = undefined;
    await previewFile();
    expect(screen.getByText('Pick a WhatsApp line before import.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(mockRun).not.toHaveBeenCalled();
  });
});
