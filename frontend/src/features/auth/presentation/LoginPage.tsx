import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { Button, FormError, Icon, TextField, useErrorMessage } from '@/shared/ui';
import { useAuth } from '../application/authContext';
import { SessionSplash } from './SessionSplash';
import s from './login.module.css';

export function LoginPage() {
  const { t, toggleLang } = useI18n();
  const { status, login } = useAuth();
  const errorMessage = useErrorMessage();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed in already, or public access (no sign-in needed): go to the dashboard.
  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }
  if (status === 'loading' || status === 'unreachable') return <SessionSplash />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.page}>
      <div className={s.glow} aria-hidden="true" />
      <form className={s.card} onSubmit={onSubmit} noValidate>
        <div className={s.header}>
          <span className={s.mark}>
            <Icon name="shield" size={28} />
          </span>
          <div>
            <h1 className={s.title}>
              {t('app.name')} <span className={s.sep}>|</span> {t('login.title')}
            </h1>
            <p className={s.subtitle}>{t('login.subtitle')}</p>
          </div>
        </div>
        <TextField label={t('login.email')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        <TextField label={t('login.password')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
        <FormError message={error} />
        <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>
          {busy ? t('login.signingIn') : t('login.submit')}
        </Button>
        <div className={s.footer}>
          <span>{t('login.footer')}</span>
          <Button variant="ghost" size="sm" icon="globe" onClick={toggleLang}>
            {t('shell.otherLanguage')}
          </Button>
        </div>
      </form>
    </div>
  );
}
