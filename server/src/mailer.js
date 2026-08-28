// Email transport. Resend (https://resend.com) when RESEND_API_KEY is set,
// otherwise the calling code falls back to the dev-mode "code in response" path.
// The transport never throws on a network error — failures are logged and the
// caller can decide what to do (the dev fallback covers dev, production
// surfaces the error to the user).
import { config } from './config.js';

export async function sendEmail({ to, subject, html, text }) {
  if (!config.email.resendApiKey) {
    console.warn(`[mail] no RESEND_API_KEY set — skipping send to ${to}: "${subject}"`);
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.email.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.email.from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || text,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[mail] resend ${res.status}: ${body.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data.id };
  } catch (e) {
    console.warn('[mail] send failed:', e?.message || e);
    return { ok: false, error: e?.message };
  }
}

export function passwordResetEmail({ email, code }) {
  return {
    subject: 'Your ArbiHunt password reset code',
    text: `Your ArbiHunt password reset code is: ${code}\n\nIt expires in 15 minutes. If you did not request this, ignore this email.`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #10b981; margin: 0 0 16px 0;">ArbiHunt</h2>
        <p style="color: #334155; line-height: 1.5;">Use this code to reset your password. It expires in 15 minutes.</p>
        <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0;">
          <span style="font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #0f172a;">${code}</span>
        </div>
        <p style="color: #64748b; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  };
}
