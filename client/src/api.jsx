import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

// In production the Vite build is served from a different origin than
// the API server, so we need an absolute base URL. In dev the Vite
// proxy forwards /api to localhost:4000 and a relative base still works.
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '')}/api`
  : '/api';

// axios instance with a generous timeout and one retry on network
// errors. Render's free tier cold-starts can take up to 50s, so the
// first request after a sleep often fails with ECONNREFUSED or
// ETIMEDOUT; a single retry is enough to ride out that window.
export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15_000,
});
api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err?.config;
    if (!cfg || cfg.__retry) throw err;
    // Retry only on transport-level failures, never on 4xx.
    const isTransport = !err.response && (
      err.code === 'ECONNABORTED' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ETIMEDOUT' ||
      err.message === 'Network Error'
    );
    if (!isTransport) throw err;
    cfg.__retry = true;
    await new Promise((r) => setTimeout(r, 1500));
    return api.request(cfg);
  }
);

// WebSocket URL — used by the dashboard for live opportunity pushes.
// Same env var as the HTTP API; the dashboard falls back to the current
// host if VITE_API_URL is unset.
export const WS_URL = (() => {
  const v = import.meta.env.VITE_API_URL;
  if (!v) return `ws://${window.location.host}/ws`;
  const u = v.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${u}/ws`;
})();

// Reconnecting WebSocket helper. Returns an object with `socket`,
// `addEventListener`, and `close`. Reconnects with exponential
// backoff (1s -> 30s cap) on close/error, and resets the backoff on
// every successful open. Render's free tier sleeps the Web Service
// after 15 min idle, so the WS will drop; this wrapper brings it
// back automatically.
export function createReconnectingWS(url) {
  let ws = null;
  const listeners = new Map();
  let backoffMs = 1000;
  let closedByUser = false;
  const open = () => {
    if (closedByUser) return;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws.addEventListener('open', () => {
      backoffMs = 1000;
      emit('open');
    });
    ws.addEventListener('message', (ev) => emit('message', ev));
    ws.addEventListener('close', () => {
      emit('close');
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // 'close' will fire right after, so let it handle the reconnect.
      emit('error');
    });
  };
  const scheduleReconnect = () => {
    if (closedByUser) return;
    const wait = backoffMs;
    backoffMs = Math.min(backoffMs * 2, 30_000);
    setTimeout(open, wait);
  };
  const emit = (type, ev) => {
    const set = listeners.get(type);
    if (set) for (const fn of set) { try { fn(ev); } catch (_) {} }
  };
  open();
  return {
    get socket() { return ws; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    close() {
      closedByUser = true;
      if (ws) try { ws.close(); } catch (_) {}
    },
  };
}

// --- Sliding session (72h of no activity = sign in again) ---
const LAST_SEEN_KEY = 'arb_last_seen';
const INACTIVITY_MS = 72 * 60 * 60 * 1000; // 72 hours

let lastStamp = 0;
export function touchSession() {
  const now = Date.now();
  if (now - lastStamp > 60000) { // throttle to once a minute
    lastStamp = now;
    localStorage.setItem(LAST_SEEN_KEY, String(now));
  }
}
function inactiveLongEnough() {
  const last = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
  return last > 0 && Date.now() - last > INACTIVITY_MS;
}
function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem(LAST_SEEN_KEY);
}

export function setAuthToken(token) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
}

export const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }

    // 72h without visiting the site => force sign-in again.
    if (inactiveLongEnough()) { clearSession(); setLoading(false); return; }

    setAuthToken(token);
    touchSession();
    api.get('/auth/me')
      .then((r) => { setUser(r.data.user); touchSession(); })
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  // Any real interaction counts as "visiting" and keeps the session alive.
  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, touchSession, { passive: true }));
    const keepAlive = setInterval(touchSession, 60000); // an open tab is a visit
    return () => {
      events.forEach((e) => window.removeEventListener(e, touchSession));
      clearInterval(keepAlive);
    };
  }, []);

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    const { token, user } = r.data;
    localStorage.setItem('token', token);
    setAuthToken(token);
    touchSession();
    setUser(user);
  };
  const register = async (email, password, referredBy) => {
    const r = await api.post('/auth/register', { email, password, referredBy });
    const { token, user } = r.data;
    localStorage.setItem('token', token);
    setAuthToken(token);
    touchSession();
    setUser(user);
  };
  const logout = () => {
    clearSession();
    setAuthToken(null);
    setUser(null);
  };
  const refreshUser = async () => {
    const r = await api.get('/auth/me');
    touchSession();
    setUser(r.data.user);
    return r.data.user;
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() { return useContext(AuthContext); }
