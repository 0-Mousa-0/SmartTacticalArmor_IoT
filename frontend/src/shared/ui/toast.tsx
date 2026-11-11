import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { ToastContext, type ToastKind } from './toastContext';
import s from './ui.module.css';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4500);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={s.toasts} role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`${s.toast} ${item.kind === 'success' ? s.toastSuccess : item.kind === 'error' ? s.toastError : ''}`}>
            <Icon name={item.kind === 'error' ? 'alert' : 'check'} size={16} />
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
