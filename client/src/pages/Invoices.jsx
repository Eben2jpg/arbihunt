import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Receipt, CheckCircle2, Clock, XCircle } from 'lucide-react';

const STATUS_META = {
  pending: { label: 'Pending', icon: Clock, cls: 'text-amber-300' },
  paid: { label: 'Paid', icon: CheckCircle2, cls: 'text-emerald-300' },
  failed: { label: 'Failed', icon: XCircle, cls: 'text-red-300' },
};

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/payments/invoices')
      .then((r) => setInvoices(r.data.invoices))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load invoices'))
      .finally(() => setLoading(false));
  }, []);

  const planName = (p) => ({ '1-week': '1 Week', '1-month': '1 Month', '1-year': '1 Year' }[p] || p);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center gap-4">
          <Link to="/dashboard" className="text-slate-300 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
          <h1 className="text-xl font-bold">Invoices & Payments</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {error && <p className="text-red-300 mb-4">{error}</p>}

        {loading ? (
          <p className="text-slate-400">Loading invoices...</p>
        ) : invoices.length === 0 ? (
          <div className="text-center py-16">
            <Receipt className="w-10 h-10 text-slate-500 mx-auto" />
            <p className="text-slate-400 mt-3">No invoices yet.</p>
            <Link to="/pricing" className="mt-3 text-emerald-400 hover:text-emerald-300 text-sm">Go to pricing to upgrade to PRO →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {invoices.map((inv) => {
              const meta = STATUS_META[inv.status] || STATUS_META.pending;
              const Icon = meta.icon;
              return (
                <div key={inv.id} className="p-4 border border-slate-800 rounded-xl bg-slate-900/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{planName(inv.plan)} PRO</div>
                      <div className="text-xs text-slate-400 font-mono">Invoice {inv.code}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-emerald-400">${inv.amountUsd} USDT</span>
                      <span className={`inline-flex items-center gap-1 text-xs ${meta.cls}`}><Icon className="w-3 h-3" /> {meta.label}</span>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500 flex flex-wrap gap-2">
                    <span>Network: {inv.network}</span>
                    <span>· Created: {new Date(inv.createdAt).toLocaleString()}</span>
                    {inv.confirmations > 0 && <span>· Confirmations: {inv.confirmations}</span>}
                    {inv.paidAt && <span>· Paid: {new Date(inv.paidAt).toLocaleString()}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}