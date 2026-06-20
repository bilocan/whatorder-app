import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<((message: string) => Promise<boolean>) | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirmDialog = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ message, resolve });
    });
  }, []);

  function close(result: boolean) {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirmDialog}>
      {children}
      {state && (
        <div className="confirm-overlay" onClick={() => close(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="confirm-dialog-title">{t('common.confirmTitle')}</p>
            <p className="confirm-dialog-message">{state.message}</p>
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => close(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="confirm-dialog-confirm" onClick={() => close(true)}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  const confirmDialog = useContext(ConfirmContext);
  if (!confirmDialog) {
    throw new Error('useConfirm must be used within a ConfirmDialogProvider');
  }
  return confirmDialog;
}
