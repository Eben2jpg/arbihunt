import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { config } from '../config.js';
import { getUserByEmail, listUsers, updateUserPlan } from '../db.js';

const router = express.Router();

// All endpoints below are restricted to the owner email set in .env (OWNER_EMAIL).
function isOwner(req) {
  return !!config.ownerEmail && req.user.email.toLowerCase() === config.ownerEmail.toLowerCase();
}

router.use(authRequired);
router.use((req, res, next) => {
  if (!isOwner(req)) return res.status(403).json({ error: 'Owner only' });
  next();
});

// Set the owner's own account to PRO (lifetime). Handy for first-time setup.
router.post('/self', (req, res) => {
  updateUserPlan(req.user.id, 'pro', null);
  res.json({ ok: true, message: 'Your account is now PRO (lifetime)' });
});

// List every registered account (email, plan, created).
router.get('/users', (req, res) => {
  res.json({ users: listUsers() });
});

// Upgrade any user by email. days omitted/0 => lifetime PRO.
router.post('/upgrade', (req, res) => {
  const email = String((req.body?.email || '').trim()).toLowerCase();
  const days = Number(req.body?.days) || 0;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const expiresAt = days > 0 ? Date.now() + days * 86400000 : null;
  updateUserPlan(user.id, 'pro', expiresAt);
  console.log(`[admin] ${req.user.email} upgraded ${email} to PRO (${days || 'lifetime'} days)`);
  res.json({ ok: true, user: { email: user.email, plan: 'pro', planExpiresAt: expiresAt, days: days || null } });
});

export default router;