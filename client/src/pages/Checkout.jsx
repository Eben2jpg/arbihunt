import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, ArrowLeft, Wallet, ShieldCheck } from 'lucide-react';
import { api, useAuth } from '../api';

const PLANS = {
  '1-week': { name: '1 Week', priceUsd: 7 },
  '1-month': { name: '1 Month', priceUsd: 22 },
  '1-year': { name: '1 Year', priceUsd: 240 },
};

const NETWORKS = [
  { id: 'TRC-20', label: 'TRC-20', hint: 'Tron network' },
  { id: 'BEP-20', label: 'BEP-20', hint: 'BNB Smart Chain' },
];

export default function Checkout() {
  const { refreshUser } = useAuth();
  const [params] = useSearchParams();
  const planId = params.get('plan') || '1-week';
  const plan = PLANS[planId] || PLANS['1-week'];

  const [network, setNetwork] = useState(() => localStorage.getItem('preferredNetwork') || 'TRC-20');
  const [invoice, setInvoice] = useState(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(true);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyError, setVerifyError] = useState('');

  const createInvoice = useCallback(async (net) => {
    setCreating(true);
    setError('');
    try {
      const r = await api.post('/plans/upgrade', { planId, network: net });
      localStorage.setItem('preferredNetwork', net);
      setInvoice(r.data.invoice);
    } catch (e) {
      console.error('invoice error', e);
      const msg = e.response?.status === 401 || e.response?.status === 403
        ? 'Please log in again, then retry.'
        : e.response?.data?.error || 'Failed to create invoice. Check your connection and try again.';
      setError(msg);
      setInvoice(null);
    } finally {
      setCreating(false);
    }
  }, [planId]);

  useEffect(() => { createInvoice(network); }, [createInvoice, network]);

  function chooseNetwork(net) {
    if (net === network || creating) return;
    setNetwork(net);
  }

  async function copyAddress() {
    if (invoice?.toAddress) {
      try { await navigator.clipboard.writeText(invoice.toAddress); } catch (_) {}
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function retry() {
    setError('');
    setInvoice(null);
    createInvoice(network);
  }

  async function verifyPayment() {
    if (!invoice || !txHash.trim()) {
      setVerifyError('Paste the transaction hash (TXID) from your wallet first.');
      return;
    }
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError('');
    try {
      const r = await api.post('/payments/verify', { invoiceCode: invoice.code, txHash: txHash.trim() });
      setVerifyResult(r.data);
      if (r.data.verified) {
        try { await refreshUser(); } catch (_e) {}
      }
    } catch (e) {
      setVerifyError(e.response?.data?.error || 'Something went wrong. The automatic monitor will keep checking for you.');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center gap-4">
          <Link to="/pricing" className="text-slate-300 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
          <h1 className="text-xl font-bold">Pay with USDT</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="p-6 border border-slate-800 rounded-xl bg-slate-900/50">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold">Invoice {invoice?.code || '...'}</h2>
              <p className="text-slate-400 text-sm">Plan: {plan.name}</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">${plan.priceUsd}</div>
              <div className="text-xs text-slate-400">Send USDT only</div>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-xs text-slate-400 mb-2">Choose the network / wallet you pay from</label>
            <div className="grid grid-cols-2 gap-3">
              {NETWORKS.map((n) => (
                <button key={n.id} onClick={() => chooseNetwork(n.id)}
                  className={`p-4 rounded-xl border text-left transition ${network === n.id ? 'border-emerald-500 bg-emerald-950/20' : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'}`}>
                  <div className="font-semibold">{n.label}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{n.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 border border-red-700/60 bg-red-950/30 rounded-lg text-sm text-red-300">
              <div>{error}</div>
              <button onClick={retry} className="mt-2 px-3 py-1 bg-red-700 text-white text-xs rounded-lg hover:bg-red-600">
                Retry
              </button>
            </div>
          )}

          {creating ? (
            <div className="py-10 text-center text-slate-400">Creating invoice for {network}...</div>
          ) : invoice ? (
            <>
              <div className="grid md:grid-cols-2 gap-8 items-center">
                <div className="flex items-center justify-center flex-col bg-white p-4 rounded-xl">
                  <QRCodeSVG value={invoice.toAddress} size={170} />
                  <span className="mt-2 text-xs text-slate-500 font-mono">{invoice.network}</span>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-slate-300">
                    <Wallet className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-medium">Deposit wallet ({invoice.network})</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-700 rounded-lg text-sm break-all font-mono">{invoice.toAddress}</div>
                  <button onClick={copyAddress} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied!' : 'Copy address'}
                  </button>
                  <div className="text-xs text-slate-400">
                    <p>Send exactly <span className="font-semibold text-slate-200">${invoice.amountUsd} USDT</span> on the <span className="font-semibold">{invoice.network}</span> network to the address above.</p>
                    <p className="mt-1">PRO activates automatically after network confirmations. Usually a few minutes.</p>
                  </div>
                </div>
              </div>
              <div className="mt-6 text-xs text-slate-500">Double-check the network. Sending on the wrong network cannot be recovered.</div>
            </>
          ) : null}

          {invoice && (
            <div className="mt-6 p-4 border border-slate-700/70 rounded-xl bg-slate-950/40">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300 mb-1">
                <ShieldCheck className="w-4 h-4" /> Already sent the payment?
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Paste the transaction hash (TXID) from your wallet and we will verify it on the {invoice.network} network instantly. The automatic monitor also checks every ~60s.
              </p>
              <div className="flex gap-2 flex-wrap">
                <input
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder="e.g. 0x… / 8f4e…"
                  className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono placeholder:text-slate-600"
                />
                <button
                  onClick={verifyPayment}
                  disabled={verifying}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg font-medium hover:bg-emerald-500 disabled:opacity-50"
                >
                  {verifying ? 'Verifying…' : 'Verify payment'}
                </button>
              </div>

              {verifyError && <div className="mt-3 text-sm text-red-300">{verifyError}</div>}
              {verifyResult && (
                <div className={`mt-3 text-sm rounded-lg p-3 border ${verifyResult.verified ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200' : verifyResult.found ? 'border-amber-700/60 bg-amber-950/30 text-amber-200' : 'border-slate-700 bg-slate-900/50 text-slate-300'}`}>
                  {verifyResult.message}
                  {verifyResult.reason ? <div className="mt-1">{verifyResult.reason}</div> : null}
                  {verifyResult.confirmations || verifyResult.required
                    ? <div className="mt-1">Confirmations: {verifyResult.confirmations}/{verifyResult.required}</div>
                    : null}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
