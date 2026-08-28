import { Link } from 'react-router-dom';
import { ArrowRight, Crown } from 'lucide-react';

// Inline plans to keep client standalone.
// 1-week is the popular entry point: lowest barrier, biggest funnel.
const PLANS_DATA = [
  { id: '1-week', name: '1 Week', priceUsd: 7, days: 7, popular: true },
  { id: '1-month', name: '1 Month', priceUsd: 22, days: 30 },
  { id: '1-year', name: '1 Year', priceUsd: 240, days: 365 },
];

export default function Pricing() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold">ArbiHunt Clone</Link>
          <Link to="/login" className="text-sm text-slate-300 hover:text-white">Log in</Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Simple, USDT-only pricing</h1>
          <p className="text-slate-300">Start at 7 USDT per week. Stay as long as the trades are good. No auto-renewal.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {PLANS_DATA.map((p) => (
            <div key={p.id} className={`p-6 rounded-xl border ${p.popular ? 'border-emerald-500 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/40'}`}>
              {p.popular && <span className="text-xs text-emerald-300 mb-2 inline-block">Most popular</span>}
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <div className="text-3xl font-bold mt-2">${p.priceUsd}</div>
              <div className="text-xs text-slate-400 mt-1">{p.days ? `${p.days} days` : 'Forever'}</div>
              <Link to={`/checkout?plan=${p.id}`} className={`mt-4 w-full py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-2 ${
                p.popular ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'border border-emerald-600 text-emerald-300 hover:bg-emerald-950/40'
              }`}>
                Pay {p.priceUsd} USDT for {p.name.toLowerCase()} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-slate-400 text-sm">Pay with USDT on TRC-20 or BEP-20. Activates automatically after confirmation.</p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <Crown className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-amber-300">55,000+ traders worldwide</span>
          </div>
        </div>
      </section>
    </div>
  );
}
