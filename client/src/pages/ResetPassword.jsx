import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';

export default function ResetPassword() {
  const loc = useLocation();
  const [email, setEmail] = useState(loc.state?.email || '');
  const [code, setCode] = useState(loc.state?.code || '');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const r = await api.post('/auth/reset-password', { email, code, newPassword });
      setMessage(r.data.message);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-slate-800 rounded-xl p-8 bg-slate-900/50">
        <h1 className="text-2xl font-bold mb-6">Set a new password</h1>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        {message && <p className="text-emerald-300 text-sm mb-4">{message}</p>}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg" required />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Reset code</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg font-mono" required />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">New password (8+ characters)</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg" required minLength={8} />
          </div>
          <button type="submit" disabled={loading} className="w-full py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-400 disabled:opacity-50">
            {loading ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
        <p className="text-sm text-slate-400 mt-4">Back to <Link to="/login" className="text-emerald-400">log in</Link></p>
      </div>
    </div>
  );
}