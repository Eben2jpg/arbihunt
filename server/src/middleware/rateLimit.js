// Tiny in-memory rate limiter. Per-IP sliding window. Resets on process restart.
// Sufficient for a single-node app; swap for Redis when going multi-node.
const buckets = new Map(); // key -> { count, resetAt }

export function rateLimit({ windowMs = 60_000, max = 30, keyFn } = {}) {
  return (req, res, next) => {
    const k = (keyFn ? keyFn(req) : (req.ip || req.headers['x-forwarded-for'] || 'global')) + ':' + (req.path || req.url);
    const now = Date.now();
    const b = buckets.get(k);
    if (!b || b.resetAt < now) {
      buckets.set(k, { count: 1, resetAt: now + windowMs });
      return next();
    }
    b.count++;
    if (b.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests, please try again shortly.' });
    }
    next();
  };
}
