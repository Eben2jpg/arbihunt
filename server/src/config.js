import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '../.env') });

const env = (key, fallback = '') => process.env[key] ?? fallback;

export const config = {
  port: Number(env('PORT', 4000)),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  clientOrigin: env('CLIENT_ORIGIN', 'http://localhost:5173'),
  ownerEmail: env('OWNER_EMAIL', ''),
  dbPath: env('DB_PATH', './data/arbihunt.db'),
  scanIntervalMs: Number(env('SCAN_INTERVAL_MS', 30000)),
  maxOpportunities: Number(env('MAX_OPPORTUNITIES', 1000)),

  usdt: {
    tronAddress: env('USDT_TRON_ADDRESS'),
    bscAddress: env('USDT_BSC_ADDRESS'),
    tronGridUrl: env('TRONGRID_API_URL', 'https://api.trongrid.io'),
    tronGridApiKey: env('TRONGRID_API_KEY'),
    bscscanApiKey: env('BSCSCAN_API_KEY'),
    confirmationsTron: Number(env('REQUIRED_CONFIRMATIONS_TRON', 19)),
    confirmationsBsc: Number(env('REQUIRED_CONFIRMATIONS_BSC', 15)),
  },

  // API-key slots for every exchange. Leave blank for public (no-key)
  // access; drop your own credentials in server/.env if a venue is
  // rate-limiting you from your IP. Keys are NEVER required for the
  // scanner — the public market endpoints always work without them.
  exchanges: {
    binance: { apiKey: env('BINANCE_API_KEY'), secret: env('BINANCE_API_SECRET') },
    bybit: { apiKey: env('BYBIT_API_KEY'), secret: env('BYBIT_API_SECRET') },
    okx: { apiKey: env('OKX_API_KEY'), secret: env('OKX_API_SECRET'), passphrase: env('OKX_PASSPHRASE') },
    kucoin: { apiKey: env('KUCOIN_API_KEY'), secret: env('KUCOIN_API_SECRET'), passphrase: env('KUCOIN_PASSPHRASE') },
    gate: { apiKey: env('GATE_API_KEY'), secret: env('GATE_API_SECRET') },
    mexc: { apiKey: env('MEXC_API_KEY'), secret: env('MEXC_API_SECRET') },
    bitget: { apiKey: env('BITGET_API_KEY'), secret: env('BITGET_API_SECRET'), passphrase: env('BITGET_PASSPHRASE') },
    htx: { apiKey: env('HTX_API_KEY'), secret: env('HTX_API_SECRET') },
    cryptocom: { apiKey: env('CRYPTOCOM_API_KEY'), secret: env('CRYPTOCOM_API_SECRET') },
    bitfinex: { apiKey: env('BITFINEX_API_KEY'), secret: env('BITFINEX_API_SECRET') },
    poloniex: { apiKey: env('POLONIEX_API_KEY'), secret: env('POLONIEX_API_SECRET') },
    whitebit: { apiKey: env('WHITEBIT_API_KEY'), secret: env('WHITEBIT_API_SECRET') },
    hitbtc: { apiKey: env('HITBTC_API_KEY'), secret: env('HITBTC_API_SECRET') },
    phemex: { apiKey: env('PHEMEX_API_KEY'), secret: env('PHEMEX_API_SECRET') },
    coinex: { apiKey: env('COINEX_API_KEY'), secret: env('COINEX_API_SECRET') },
    digifinex: { apiKey: env('DIGIFINEX_API_KEY'), secret: env('DIGIFINEX_API_SECRET') },
    bitrue: { apiKey: env('BITRUE_API_KEY'), secret: env('BITRUE_API_SECRET') },
    lbank: { apiKey: env('LBANK_API_KEY'), secret: env('LBANK_API_SECRET') },
    xt: { apiKey: env('XT_API_KEY'), secret: env('XT_API_SECRET') },
    latoken: { apiKey: env('LATOKEN_API_KEY'), secret: env('LATOKEN_API_SECRET') },
    btse: { apiKey: env('BTSE_API_KEY'), secret: env('BTSE_API_SECRET') },
    toobit: { apiKey: env('TOOBIT_API_KEY'), secret: env('TOOBIT_API_SECRET') },
    kraken: { apiKey: env('KRAKEN_API_KEY'), secret: env('KRAKEN_API_SECRET') },
    bitstamp: { apiKey: env('BITSTAMP_API_KEY'), secret: env('BITSTAMP_API_SECRET') },
    bigone: { apiKey: env('BIGONE_API_KEY'), secret: env('BIGONE_API_SECRET') },
    cex: { apiKey: env('CEX_API_KEY'), secret: env('CEX_API_SECRET') },
    bitso: { apiKey: env('BITSO_API_KEY'), secret: env('BITSO_API_SECRET') },
    bitbns: { apiKey: env('BITBNS_API_KEY'), secret: env('BITBNS_API_SECRET') },
    indodax: { apiKey: env('INDODAX_API_KEY'), secret: env('INDODAX_API_SECRET') },
    zebpay: { apiKey: env('ZEBPAY_API_KEY'), secret: env('ZEBPAY_API_SECRET') },
    btcturk: { apiKey: env('BTCTURK_API_KEY'), secret: env('BTCTURK_API_SECRET') },
    coinone: { apiKey: env('COINONE_API_KEY'), secret: env('COINONE_API_SECRET') },
    bithumb: { apiKey: env('BITHUMB_API_KEY'), secret: env('BITHUMB_API_SECRET') },
    upbit: { apiKey: env('UPBIT_API_KEY'), secret: env('UPBIT_API_SECRET') },
    coincheck: { apiKey: env('COINCHECK_API_KEY'), secret: env('COINCHECK_API_SECRET') },
    bit2c: { apiKey: env('BIT2C_API_KEY'), secret: env('BIT2C_API_SECRET') },
  },

  // When true, the reset code is returned in the forgot-password API response.
  // Auto-enabled when no email sender is configured; force a value via
  // RESET_CODE_EXPOSED in .env. In production, set RESEND_API_KEY + leave
  // RESET_CODE_EXPOSED unset (or "false") so codes are only sent out-of-band.
  email: {
    resendApiKey: env('RESEND_API_KEY', ''),
    from: env('EMAIL_FROM', 'ArbiHunt <noreply@example.com>'),
  },
  resetCodeExposed: env('RESET_CODE_EXPOSED',
    env('RESEND_API_KEY', '') ? 'false' : 'true') === 'true',
};
