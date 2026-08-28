import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    try { await login(email, password); navigate('/dashboard'); }
    catch (err) { setError(err.response?.data?.error || 'Login failed'); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-slate-800 rounded-xl p-8 bg-slate-900/50">
        <h1 className="text-2xl font-bold mb-6">Log in</h1>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg" required />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg" required />
          </div>
          <button type="submit" className="w-full py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-400">Log in</button>
        </form>
        <p className="text-sm text-slate-400 mt-4">No account? <Link to="/register" className="text-emerald-400">Create one</Link></p>
        <p className="text-sm text-slate-400 mt-2">Forgot your password? <Link to="/forgot-password" className="text-emerald-400">Reset it</Link></p>
      </div>
    </div>
  );
}
