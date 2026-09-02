import express from 'express';
import { verifyToken, authRequired } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

import { createUser, getUserByEmail, getUserById, isPro, resetUserPassword, setPasswordReset, getUserByResetCode, clearPasswordReset } from '../db.js';
import { hashPassword, verifyPassword, randomToken } from '../auth/crypto.js';
import { makeToken } from '../middleware/auth.js';
import { config } from '../config.js';
import { sendEmail, passwordResetEmail } from '../mailer.js';

// Auth endpoints get a per-IP cap to slow brute force + reset abuse.
const authLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const resetLimiter = rateLimit({ windowMs: 60_000, max: 5 });

// Hard 5s ceiling on every Supabase call in auth routes. Without
// this, a slow Supabase connection from Render's free tier can
// hang the request until Render's edge returns a 502 with HTML,
// which the frontend's axios reports as a "Network Error".
// With this race, the route returns a clean 503 within 5s.
function withDbTimeout(promise, ms = 5000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`db timeout after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const router = express.Router();

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, referredBy } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    let existing;
    try { existing = await withDbTimeout(getUserByEmail(email)); }
    catch (e) { return res.status(503).json({ error: 'Database temporarily unavailable, please retry' }); }
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = await createUser({ email, passwordHash: hashPassword(password), referredBy });
    const token = makeToken(user.id);
    res.json({ token, user: serializeUser(user) });
  } catch (e) {
    console.error('[auth] register error:', e?.message || e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    let user;
    try { user = await withDbTimeout(getUserByEmail(email)); }
    catch (e) { return res.status(503).json({ error: 'Database temporarily unavailable, please retry' }); }
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = makeToken(user.id);
    res.json({ token, user: serializeUser(user) });
  } catch (e) {
    console.error('[auth] login error:', e?.message || e);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/change-password', authRequired, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'New password must be different from the current one' });
    }
    if (!verifyPassword(currentPassword, req.user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await resetUserPassword(req.user.email, hashPassword(newPassword));
    res.json({ ok: true, message: 'Password updated successfully' });
  } catch (e) { res.status(500).json({ error: 'Password change failed' }); }
});

router.get('/me', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const userId = verifyToken(token);
    if (!userId) return res.status(401).json({ error: 'Invalid token' });
    let user;
    try { user = await withDbTimeout(getUserById(userId)); }
    catch (e) { return res.status(503).json({ error: 'Database temporarily unavailable' }); }
    if (!user) return res.status(401).json({ error: 'Account not found' });
    res.json({ user: serializeUser(user) });
  } catch (e) {
    console.error('[auth] me error:', e?.message || e);
    res.status(500).json({ error: 'Auth check failed' });
  }
});

router.post('/forgot-password', resetLimiter, async (req, res) => {
  try {
    const email = String((req.body?.email || '').trim()).toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await getUserByEmail(email);
    // Always respond the same to avoid leaking which emails exist.
    if (!user) return res.json({ ok: true, message: 'If an account exists for that email, a reset code has been issued.' });

    // Short-lived reset code (15 minutes). In dev mode the code is returned in the
    // response; in production it should be delivered via email/SMS out-of-band.
    const code = randomToken(3).toUpperCase();
    await setPasswordReset(email, code, Date.now() + 15 * 60 * 1000);
    console.log(`[auth] reset code issued for ${email} (expires in 15m)`);

    // Try to send the code via email. If a real sender is configured, the
    // response NEVER includes the code (devMode=false, resetCode=undefined).
    // In dev (no sender), the code is returned so the local flow still works.
    let delivered = false;
    if (config.email.resendApiKey) {
      const msg = passwordResetEmail({ email, code });
      const result = await sendEmail({ to: email, subject: msg.subject, html: msg.html, text: msg.text });
      delivered = !!result.ok;
    }

    res.json({
      ok: true,
      message: delivered
        ? 'A reset code has been emailed to you. It expires in 15 minutes.'
        : (config.resetCodeExposed
            ? 'If an account exists for that email, a reset code has been issued.'
            : 'We could not email a reset code right now. Please try again in a minute.'),
      resetCode: config.resetCodeExposed ? code : undefined,
      devMode: !!config.resetCodeExposed,
    });
  } catch (e) { res.status(500).json({ error: 'Reset request failed' }); }
});

router.post('/reset-password', resetLimiter, async (req, res) => {
  try {
    const email = String((req.body?.email || '').trim()).toLowerCase();
    const code = String((req.body?.code || '').trim()).toUpperCase();
    const { newPassword } = req.body || {};
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, reset code and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await getUserByEmail(email);
    const byCode = await getUserByResetCode(code);
    if (!user || !byCode || byCode.id !== user.id) {
      return res.status(400).json({ error: 'Invalid or expired reset code' });
    }

    await resetUserPassword(email, hashPassword(newPassword));
    await clearPasswordReset(email);
    res.json({ ok: true, message: 'Password updated. You can now log in.' });
  } catch (e) { res.status(500).json({ error: 'Password reset failed' }); }
});

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    plan: isPro(user) ? 'pro' : 'free',
    planExpiresAt: user.plan_expires_at,
    referralCode: user.referral_code,
    isOwner: !!config.ownerEmail && user.email.toLowerCase() === config.ownerEmail.toLowerCase(),
  };
}

export default router;
