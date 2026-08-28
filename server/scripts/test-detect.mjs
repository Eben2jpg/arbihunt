// Quick sanity test: feed synthetic crossed order books into the detector.
import { detectOpportunities } from '../src/scanner/engine.js';

const mkBook = (bid, ask) => ({
  bids: [[bid, 100], [bid * 0.999, 500]],
  asks: [[ask, 100], [ask * 1.001, 500]],
});

const booksByExchange = {
  binance: [{ base: 'TEST', symbol: 'TEST/USDT', taker: 0.001, book: mkBook(99.5, 100) }],
  btse: [{ base: 'TEST', symbol: 'TEST/USDT', taker: 0.001, book: mkBook(103, 103.5) }],
};

const result = detectOpportunities(booksByExchange);
console.log('opportunities found:', result.length);
for (const op of result) {
  console.log(`#${op.rank} ${op.base} buy=${op.buyExchange}@${op.buyPrice.toFixed(4)} sell=${op.sellExchange}@${op.sellPrice.toFixed(4)} net=${op.netProfitPct.toFixed(2)}% ($${op.netProfitUsdt.toFixed(2)})`);
}
if (!result.length) { console.error('FAIL: detector found nothing on a clearly crossed book'); process.exit(1); }
console.log('PASS');
