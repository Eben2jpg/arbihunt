import { Link } from 'react-router-dom';
import { ArrowRight, Zap, TrendingUp, Shield, Globe } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen">
      <nav className="border-b border-slate-800">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold tracking-tight">ArbiHunt Clone</Link>
          <div className="flex gap-4">
            <Link to="/login" className="text-sm text-slate-300 hover:text-white">Log in</Link>
            <Link to="/register" className="px-4 py-2 bg-emerald-500 text-white text-sm rounded-lg font-medium hover:bg-emerald-400">
              Start free
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-6 pt-20 pb-16 text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          Crypto arbitrage, <span className="text-emerald-400">made easy.</span>
        </h1>
        <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-8">
          Real-time scanner across 36 exchanges and thousands of tokens. Net profit after fees, transfer costs and liquidity — ranked live. Free plan shows signals from 0.10% up to 1.5%; PRO unlocks everything from 7 USDT/week.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link to="/register" className="px-6 py-3 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-400">
            Start free <ArrowRight className="inline ml-1 w-4 h-4" />
          </Link>
          <Link to="/pricing" className="px-6 py-3 border border-slate-700 rounded-lg text-slate-200 hover:bg-slate-800">
            See pricing — from 7 USDT/week
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20 grid md:grid-cols-3 gap-6">
        {[
          { icon: Zap, title: 'Real-time scanning', desc: 'Every pair across 36 exchanges, re-checked every ~30 seconds.' },
          { icon: TrendingUp, title: 'Net profit ranked', desc: 'Taker fees, withdrawal costs and live liquidity already subtracted.' },
          { icon: Globe, title: 'Transfer-ready routes', desc: 'Matched networks with live deposit & withdrawal status on both legs.' },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="p-6 rounded-xl border border-slate-800 bg-slate-900/50">
            <Icon className="w-8 h-8 text-emerald-400 mb-3" />
            <h3 className="text-lg font-semibold mb-2">{title}</h3>
            <p className="text-slate-300 text-sm">{desc}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-slate-800">
        <div className="mx-auto max-w-7xl px-6 py-6 flex items-center justify-between text-sm text-slate-500">
          <span>ArbiHunt Clone — built for demo purposes.</span>
          <div className="flex gap-4">
            <Link to="/pricing" className="hover:text-slate-300">Pricing</Link>
            <Link to="/status" className="hover:text-slate-300">Status</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
