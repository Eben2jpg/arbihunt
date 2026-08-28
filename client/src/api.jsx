import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

// In production the Vite build is served from a different origin than
// the API server, so we need an absolute base URL. In dev the Vite
// proxy forwards /api to localhost:4000 and a relative base still works.
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '')}/api`
  : '/api';

export const api = axios.create({ baseURL: API_BASE });

// WebSocket URL — used by the dashboard for live opportunity pushes.
// Same env var as the HTTP API; the dashboard falls back to the current
// host if VITE_API_URL is unset.
export const WS_URL = (() => {
  const v = import.meta.env.VITE_API_URL;
  if (!v) return `ws://${window.location.host}/ws`;
  const u = v.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${u}/ws`;
})();

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
