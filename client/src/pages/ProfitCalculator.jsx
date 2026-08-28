import { useEffect, useMemo, useState } from 'react';
import { X, Calculator, ArrowRight } from 'lucide-react';

// Pure profit math, mirror of server/src/scanner/arbitrage.js#computeNetProfit
// so the user sees the exact same numbers the scanner used.
function computeNet({ buyAsk, buyTakerFeePct, sellBid, sellTakerFeePct, withdrawFeeBase, sizeBase }) {
  const buyCost = sizeBase * buyAsk;
  const buyFee = buyCost * (buyTakerFeePct / 100);
  const totalBuy = buyCost + buyFee;
  const received = Math.max(0, sizeBase - (Number(withdrawFeeBase) || 0));
  const sellValue = received * sellBid;
  const sellFee = sellValue * (sellTakerFeePct / 100);
  const netSell = sellValue - sellFee;
  const netUsdt = netSell - totalBuy;
  const netPct = totalBuy > 0 ? (netUsdt / totalBuy) * 100 : 0;
  return { netUsdt, netPct, totalBuy, sellValue, sellFee, buyFee };
}

export default function ProfitCalculator({ open, onClose, opportunities, exchanges, isPro }) {
  const [token, setToken] = useState('');
  const [buyEx, setBuyEx] = useState('');
  const [sellEx, setSellEx] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [buyFee, setBuyFee] = useState('0.1');
  const [sellFee, setSellFee] = useState('0.1');
  const [withdraw, setWithdraw] = useState('0');
  const [sizeBase, setSizeBase] = useState('20');

  // Reset when opening
  useEffect(() => { if (open) { setToken(''); setBuyEx(''); setSellEx(''); setBuyPrice(''); setSellPrice(''); setWithdraw('0'); setSizeBase('20'); } }, [open]);

  // Picking a token pre-fills price + fee defaults from the first matching opportunity
  const matches = useMemo(() => {
    if (!token) return [];
    return (opportunities || []).filter((o) => o.base.toUpperCase() === token.toUpperCase());
  }, [token, opportunities]);

  function pickRoute(op) {
    setToken(op.base);
    setBuyEx(op.buyExchange);
    setSellEx(op.sellExchange);
    setBuyPrice(String(op.buyPrice ?? ''));
    setSellPrice(String(op.sellPrice ?? ''));
    setBuyFee('0.1');
    setSellFee('0.1');
    setWithdraw(String(op.withdrawFee ?? 0));
  }

  const result = useMemo(() => computeNet({
    buyAsk: Number(buyPrice) || 0,
    buyTakerFeePct: Number(buyFee) || 0,
    sellBid: Number(sellPrice) || 0,
    sellTakerFeePct: Number(sellFee) || 0,
    withdrawFeeBase: Number(withdraw) || 0,
    sizeBase: Number(sizeBase) || 0,
  }), [buyPrice, buyFee, sellPrice, sellFee, withdraw, sizeBase]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold">Profit Calculator</h2>
            {!isPro && <span className="text-xs text-amber-300 ml-2">PRO feature</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {!isPro && (
            <div className="p-3 border border-amber-700/60 bg-amber-950/30 rounded-lg text-xs text-amber-200">
              The calculator is included with PRO. You can still try it below, but live results on the dashboard are limited to spreads from 0.10% up to 1.5%.
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400">Token symbol</label>
            <input value={token} onChange={(e) => setToken(e.target.value.toUpperCase())}
              placeholder="e.g. BTC, ETH, SOL"
              className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono" />
            {matches.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {matches.slice(0, 4).map((m) => (
                  <button key={m.id} onClick={() => pickRoute(m)}
                    className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200">
                    {m.buyExchange} → {m.sellExchange} · {m.netProfitPct.toFixed(2)}%
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">Buy exchange</label>
              <select value={buyEx} onChange={(e) => setBuyEx(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm">
                <option value="">Select…</option>
                {(exchanges || []).map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">Sell exchange</label>
              <select value={sellEx} onChange={(e) => setSellEx(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm">
                <option value="">Select…</option>
                {(exchanges || []).map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">Buy price (USDT)</label>
              <input type="number" inputMode="decimal" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-400">Sell price (USDT)</label>
              <input type="number" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-400">Buy taker fee (%)</label>
              <input type="number" inputMode="decimal" value={buyFee} onChange={(e) => setBuyFee(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-400">Sell taker fee (%)</label>
              <input type="number" inputMode="decimal" value={sellFee} onChange={(e) => setSellFee(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-400">Withdrawal fee (base units)</label>
              <input type="number" inputMode="decimal" value={withdraw} onChange={(e) => setWithdraw(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-400">Trade size (base units)</label>
              <input type="number" inputMode="decimal" value={sizeBase} onChange={(e) => setSizeBase(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono" />
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60">
            <div className="text-xs text-slate-400 mb-1">Result</div>
            <div className={`text-3xl font-bold ${result.netUsdt >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              {result.netUsdt >= 0 ? '+' : ''}{result.netUsdt.toFixed(2)} USDT
            </div>
            <div className="text-sm text-slate-400 mt-1">
              {result.netPct >= 0 ? '+' : ''}{result.netPct.toFixed(2)}% net
            </div>
            <div className="mt-3 text-xs text-slate-500 grid grid-cols-2 gap-1">
              <div>Buy cost: <span className="text-slate-300 font-mono">${result.totalBuy.toFixed(2)}</span></div>
              <div>Sell value: <span className="text-slate-300 font-mono">${result.sellValue.toFixed(2)}</span></div>
              <div>Buy fee: <span className="text-slate-300 font-mono">${result.buyFee.toFixed(2)}</span></div>
              <div>Sell fee: <span className="text-slate-300 font-mono">${result.sellFee.toFixed(2)}</span></div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            Numbers match the scanner's net-profit calculation (after taker fees and transfer cost).
            Withdrawal fee is in the base token (e.g. 0.00005 BTC for BTC transfers). Taker fees default to 0.1% (Binance/Bybit tier).
          </p>
        </div>
      </div>
    </div>
  );
}
