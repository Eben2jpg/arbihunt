// Plan definitions (match the pricing page). Prices in USD, paid in USDT.
export const PLANS = {
  '1-week': { id: '1-week', name: '1 Week', priceUsd: 7, days: 7 },
  '1-month': { id: '1-month', name: '1 Month', priceUsd: 22, days: 30 },
  '1-year': { id: '1-year', name: '1 Year', priceUsd: 240, days: 365 },
};

// Free users see opportunities from 0.10% (the engine floor) up to this
// spread. Anything at or above this threshold is gated behind PRO. PRO
// users see every spread from 0.10% upward with no upper cap.
export const FREE_MAX_SPREAD_PERCENT = 1.5;
export const NETWORKS = ['TRC-20', 'BEP-20'];

export function paymentAmounts() {
  return Object.values(PLANS).map((p) => p.priceUsd);
}

// USDT contract addresses on the accepted networks.
export const USDT_CONTRACTS = {
  'TRC-20': 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  'BEP-20': '0x55d398326f99059ff775485246999027b3197955',
};
