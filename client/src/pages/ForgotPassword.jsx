import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Check } from 'lucide-react';
import { api } from '../api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setResetCode('');
    setCopied(false);
    setLoading(true);
    try {
      const r = await api.post('/auth/forgot-password', { email });
      setMessage(r.data.message);
      if (r.data.resetCode) setResetCode(r.data.resetCode);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function copyCode() {
    if (!resetCode) return;
    navigator.clipboard.writeText(resetCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-slate-800 rounded-xl p-8 bg-slate-900/50">
        <h1 className="text-2xl font-bold mb-2">Reset password</h1>
        <p className="text-sm text-slate-400 mb-6">Enter your email and we'll issue a one-time reset code.</p>

        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        {message && <p className="text-emerald-300 text-sm mb-4">{message}</p>}
        {resetCode && (
          <div className="mb-4 p-4 border border-emerald-700/60 bg-emerald-950/30 rounded-lg">
            <div className="text-slate-300 text-xs mb-2">
              Your one-time reset code (valid for 15 minutes):
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-3xl font-black tracking-[0.3em] text-emerald-200 font-mono">
                {resetCode}
              </div>
              <button
                type="button"
                onClick={copyCode}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-emerald-700 text-emerald-300 rounded-md hover:bg-emerald-950/40"
                aria-label="Copy reset code"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg" required />
          </div>
          <button type="submit" disabled={loading} className="w-full py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-400 disabled:opacity-50">
            {loading ? 'Sending…' : 'Send reset code'}
          </button>
        </form>

        {resetCode && (
          <button onClick={() => navigate('/reset-password', { state: { email, code: resetCode } })}
            className="mt-4 w-full py-2 border border-emerald-600 text-emerald-300 rounded-lg text-sm hover:bg-emerald-950/40">
            I have a code — set a new password →
          </button>
        )}

        <p className="text-sm text-slate-400 mt-4">Remembered it? <Link to="/login" className="text-emerald-400">Log in</Link></p>
      </div>
    </div>
  );
}