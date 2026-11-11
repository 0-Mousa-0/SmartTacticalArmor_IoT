import { useEffect, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useI18n } from '@/core/i18n/useI18n';
import { Button } from './primitives';
import { Icon } from './Icon';
import s from './ui.module.css';

/* ── Field wrappers ─────────────────────────────────────── */
interface FieldShell {
  label: string;
  hint?: string;
  full?: boolean;
}

function Field({ label, hint, full, id, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`${s.field} ${full ? s.full : ''}`}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
}

export function TextField({ label, hint, full, ...input }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} full={full} id={id}>
      <input id={id} className={s.input} {...input} />
    </Field>
  );
}

export function SelectField({ label, hint, full, children, ...select }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} full={full} id={id}>
      <select id={id} className={s.select} {...select}>
        {children}
      </select>
    </Field>
  );
}

export function TextAreaField({ label, hint, full, ...area }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} full={full} id={id}>
      <textarea id={id} className={s.textarea} {...area} />
    </Field>
  );
}

export function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={s.checkbox}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className={s.formGrid}>{children}</div>;
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p className={s.formError} role="alert">
      {message}
    </p>
  ) : null;
}

/* ── Modal ──────────────────────────────────────────────── */
interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={s.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.modalHeader}>
          <span>{title}</span>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" size={16} />
          </Button>
        </div>
        <div className={s.modalBody}>{children}</div>
        {footer && <div className={s.modalFooter}>{footer}</div>}
      </div>
    </div>
  );
}

/* ── Confirm dialog ─────────────────────────────────────── */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onConfirm, onClose }: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
