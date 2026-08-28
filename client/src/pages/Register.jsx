import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../api';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, login } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      // First try: create the account.
      await register(email, password);
      navigate('/dashboard');
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error || err?.message || 'Registration failed';
      if (status === 409) {
        // Email is already registered. Try to sign them in with the password
        // they just typed — if it matches, they're in. If not, prompt for the
        // right password via the login form.
        setInfo('That email is already registered — signing you in…');
        try {
          await login(email, password);
          navigate('/dashboard');
        } catch (loginErr) {
          setInfo('');
          setError('That email is already registered. Use the Log in page to sign in with your existing password.');
        }
      } else {
        setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-slate-800 rounded-xl p-8 bg-slate-900/50">
        <h1 className="text-2xl font-bold mb-6">Create your account</h1>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        {info && <p className="text-emerald-300 text-sm mb-4">{info}</p>}
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg" required />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Password (8+ characters)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg" required minLength={8} />
          </div>
          <button type="submit" disabled={loading} className="w-full py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-400 disabled:opacity-50">
            {loading ? 'Working…' : 'Continue'}
          </button>
        </form>
        <p className="text-sm text-slate-400 mt-4">Already have an account? <Link to="/login" className="text-emerald-400">Log in</Link></p>
      </div>
    </div>
  );
}
