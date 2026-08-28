import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getUserById, isPro } from '../db.js';
import { randomToken } from '../auth/crypto.js';

export function makeToken(userId) {
  // Long-lived so the 72h "visit" rule is the real session gate, and an active
  // returning user is never dropped unexpectedly ("email recognized forever").
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '365d' });
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload.sub;
  } catch (e) {
    return null;
  }
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token && verifyToken(token);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Account not found' });
  req.user = user;
  next();
}

export function proRequired(req, res, next) {
  if (!isPro(req.user)) return res.status(403).json({ error: 'PRO plan required' });
  next();
}
