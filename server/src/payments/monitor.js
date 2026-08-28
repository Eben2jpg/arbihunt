import { config } from '../config.js';
import { USDT_CONTRACTS } from '../constants.js';

const USDT_TRC20 = USDT_CONTRACTS['TRC-20'];
const USDT_BEP20 = USDT_CONTRACTS['BEP-20'];

export async function fetchTronTransfers(address) {
  const url = `${config.usdt.tronGridUrl}/v1/accounts/${address}/transactions/trc20?contract_address=${USDT_TRC20}&limit=50&only_to=true&order_by=block_timestamp,desc`;
  const headers = config.usdt.tronGridApiKey ? { 'TRON-PRO-API-KEY': config.usdt.tronGridApiKey } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map((t) => ({
    tx_hash: t.transaction_id,
    from: t.from,
    to: t.to,
    amount: parseInt(t.value, 10) / 1e6,
    block_timestamp: t.block_timestamp,
    token: t.token_symbol,
    blockNumber: t.block_number,
  }));
}

export async function fetchBscTransfers(address) {
  const base = 'https://api.bscscan.com/api';
  const params = new URLSearchParams({
    module: 'account',
    action: 'tokentx',
    contractaddress: USDT_BEP20,
    address,
    page: '1',
    offset: '50',
    sort: 'desc',
  });
  if (config.usdt.bscscanApiKey) params.set('apikey', config.usdt.bscscanApiKey);
  const res = await fetch(`${base}?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.status !== '1' || !Array.isArray(data.result)) return [];
  return data.result.map((t) => ({
    tx_hash: t.hash,
    from: t.from,
    to: t.to,
    amount: parseFloat(t.value) / 1e18,
    block_timestamp: Number(t.timeStamp) * 1000,
    token: t.tokenSymbol,
    blockNumber: t.blockNumber != null ? Number(t.blockNumber) : undefined,
  }));
}

export function formatAddress(network) {
  if (network === 'TRC-20') return config.usdt.tronAddress;
  if (network === 'BEP-20') return config.usdt.bscAddress;
  return null;
}

// Latest finalized block number on the given network (for computing confirmations).
export async function getLatestBlockNumber(network) {
  try {
    if (network === 'TRC-20') {
      const res = await fetch(`${config.usdt.tronGridUrl}/wallet/getnowblock`);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.block_header?.raw_data?.number ?? null;
    }
    if (network === 'BEP-20') {
      const params = new URLSearchParams({ module: 'proxy', action: 'eth_blockNumber' });
      if (config.usdt.bscscanApiKey) params.set('apikey', config.usdt.bscscanApiKey);
      const res = await fetch(`https://api.bscscan.com/api?${params.toString()}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.result ? parseInt(data.result, 16) : null;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

// Confirmations once a transaction is included in a block: tip - txBlock + 1.
export function getConfirmations(tipBlock, txBlock) {
  if (tipBlock == null || txBlock == null) return 1;
  return Math.max(Number(tipBlock) - Number(txBlock) + 1, 0);
}
