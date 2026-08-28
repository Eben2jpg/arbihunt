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

const router = express.Router();

router.post('/register', authLimiter, (req, res) => {
  const { email, password, referredBy } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (getUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });

  const user = createUser({ email, passwordHash: hashPassword(password), referredBy });
  const token = makeToken(user.id);
  res.json({ token, user: serializeUser(user) });
});

router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = makeToken(user.id);
  res.json({ token, user: serializeUser(user) });
});

router.post('/change-password', authRequired, (req, res) => {
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
  resetUserPassword(req.user.email, hashPassword(newPassword));
  res.json({ ok: true, message: 'Password updated successfully' });
});

router.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const userId = verifyToken(token);
  if (!userId) return res.status(401).json({ error: 'Invalid token' });
  const user = getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Account not found' });
  res.json({ user: serializeUser(user) });
});

router.post('/forgot-password', resetLimiter, async (req, res) => {
  const email = String((req.body?.email || '').trim()).toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = getUserByEmail(email);
  // Always respond the same to avoid leaking which emails exist.
  if (!user) return res.json({ ok: true, message: 'If an account exists for that email, a reset code has been issued.' });

  // Short-lived reset code (15 minutes). In dev mode the code is returned in the
  // response; in production it should be delivered via email/SMS out-of-band.
  const code = randomToken(3).toUpperCase();
  setPasswordReset(email, code, Date.now() + 15 * 60 * 1000);
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
});

router.post('/reset-password', resetLimiter, (req, res) => {
  const email = String((req.body?.email || '').trim()).toLowerCase();
  const code = String((req.body?.code || '').trim()).toUpperCase();
  const { newPassword } = req.body || {};
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, reset code and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const user = getUserByEmail(email);
  const byCode = getUserByResetCode(code);
  if (!user || !byCode || byCode.id !== user.id) {
    return res.status(400).json({ error: 'Invalid or expired reset code' });
  }

  resetUserPassword(email, hashPassword(newPassword));
  clearPasswordReset(email);
  res.json({ ok: true, message: 'Password updated. You can now log in.' });
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
