/**
 * Persists the operator session token. localStorage can be unavailable
 * (private mode, blocked storage), so every access is guarded and an
 * in-memory copy keeps the current tab working regardless.
 */
const KEY = 'sta.session';

interface StoredSession {
  token: string;
  expiresAt: number; // epoch ms
}

type Listener = () => void;

let memory: StoredSession | null = null;
const listeners = new Set<Listener>();

function read(): StoredSession | null {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    memory = null;
  }
  return memory;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export const tokenStore = {
  get(): string | null {
    const session = read();
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
      tokenStore.clear();
      return null;
    }
    return session.token;
  },

  set(token: string, expiresInSeconds: number): void {
    memory = { token, expiresAt: Date.now() + expiresInSeconds * 1000 };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(memory));
    } catch {
      /* in-memory only */
    }
    notify();
  },

  clear(): void {
    const hadSession = memory !== null;
    memory = null;
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    if (hadSession) notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
