import ccxt from 'ccxt';
import { config } from '../config.js';

// 36 exchanges, all verified against the installed CCXT version.
// Dead/renamed ids (gateio->gate, bitmart, ascendex, lykke, fidex, etc.) removed.
const EXCHANGE_DEFS = [
  { id: 'binance', name: 'Binance' },
  { id: 'bybit', name: 'Bybit' },
  { id: 'okx', name: 'OKX' },
  { id: 'kucoin', name: 'KuCoin' },
  { id: 'gate', name: 'Gate.io' },
  { id: 'mexc', name: 'MEXC' },
  { id: 'bitget', name: 'Bitget' },
  { id: 'htx', name: 'HTX' },
  { id: 'cryptocom', name: 'Crypto.com' },
  { id: 'bitfinex', name: 'Bitfinex' },
  { id: 'poloniex', name: 'Poloniex' },
  { id: 'whitebit', name: 'WhiteBIT' },
  { id: 'hitbtc', name: 'HitBTC' },
  { id: 'phemex', name: 'Phemex' },
  { id: 'coinex', name: 'CoinEx' },
  { id: 'digifinex', name: 'DigiFinex' },
  { id: 'bitrue', name: 'Bitrue' },
  { id: 'lbank', name: 'LBank' },
  { id: 'xt', name: 'XT.com' },
  { id: 'latoken', name: 'LATOKEN' },
  { id: 'btse', name: 'BTSE' },
  { id: 'toobit', name: 'Toobit' },
  { id: 'kraken', name: 'Kraken' },
  { id: 'bitstamp', name: 'Bitstamp' },
  { id: 'bigone', name: 'BigONE' },
  { id: 'cex', name: 'CEX.IO' },
  { id: 'bitso', name: 'Bitso' },
  { id: 'bitbns', name: 'Bitbns' },
  { id: 'indodax', name: 'Indodax' },
  { id: 'zebpay', name: 'ZebPay' },
  { id: 'btcturk', name: 'BTCTurk' },
  { id: 'coinone', name: 'Coinone' },
  { id: 'bithumb', name: 'Bithumb' },
  { id: 'upbit', name: 'Upbit' },
  { id: 'coincheck', name: 'Coincheck' },
  { id: 'bit2c', name: 'Bit2c' },
];

function makeExchange(id) {
  const Client = ccxt[id];
  if (!Client) return null;
  const creds = config.exchanges[id] || {};
  // Passphrase-based exchanges (OKX, KuCoin, Bitget) use a third
  // credential the CCXT client calls `password`. Surface it for any
  // venue that supplies one.
  const inst = new Client({
    enableRateLimit: true,
    timeout: 8000,
    apiKey: creds.apiKey || undefined,
    secret: creds.secret || undefined,
    ...(creds.passphrase ? { password: creds.passphrase } : {}),
    options: { adjustForTimeDifference: true },
  });
  return inst;
}

export const exchanges = EXCHANGE_DEFS.map((def) => {
  const client = makeExchange(def.id);
  return { ...def, id: def.id, client };
});
// Keep exchanges that failed CCXT class lookup out of the live scan loop
// (they have no client to call), but they still appear in the picker so
// the user can see the full 36 we declare.
export const liveExchanges = exchanges.filter((e) => e.client);

export const exchangeNames = exchanges.map((e) => ({ id: e.id, name: e.name }));
