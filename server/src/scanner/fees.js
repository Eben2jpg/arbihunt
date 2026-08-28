// Withdrawal (transfer) fee registry defaulted by asset + network.
// These are the fixed base-amount fees charged to move a coin between venues.
// Values are curated defaults; when an exchange provides live fee data we
// prefer that, otherwise we fall back to this table.
//
// Network keys used throughout the app:
//   'BTC','ETH','TRC-20','BEP-20','ERC-20','SOL','XRP','ADA','DOGE','AVAX',
//   'MATIC','ARB','OP','TON','APT','SUI','INJ','TIA','NEAR','ATOM','DOT','LTC',
//   plus asset-native chains ('ALGO','DASH','EOS','XLM','XTZ','ZEC','SC','NEO').

const WITHDRAW_FEES = {
  // --- Major / liquidity-critical ---
  BTC:   { 'BTC': 0.00005, 'BEP-20': 0.000004 },
  ETH:   { 'ERC-20': 0.0015, 'BEP-20': 0.0003 },
  USDT:  { 'TRC-20': 1.0, 'BEP-20': 0.25, 'ERC-20': 5.0 },
  USDC:  { 'ERC-20': 2.0, 'BEP-20': 0.4, 'SOL': 0.5, 'TRC-20': 1.0 },
  BNB:   { 'BEP-20': 0.0002 },
  SOL:   { 'SOL': 0.005, 'BEP-20': 0.01 },
  XRP:   { 'XRP': 0.1, 'BEP-20': 0.5 },
  ADA:   { 'ADA': 0.5, 'BEP-20': 0.6 },
  DOGE:  { 'DOGE': 1.0, 'BEP-20': 5 },
  AVAX:  { 'AVAX': 0.005, 'BEP-20': 0.01 },
  TRX:   { 'TRX': 1.5, 'BEP-20': 0.5 },
  LINK:  { 'ERC-20': 0.1, 'BEP-20': 0.05 },
  MATIC: { 'MATIC': 0.02, 'ERC-20': 0.5, 'BEP-20': 0.02 },
  DOT:   { 'DOT': 0.05, 'BEP-20': 0.1 },
  ATOM:  { 'ATOM': 0.05, 'BEP-20': 0.1 },
  LTC:   { 'LTC': 0.001, 'BEP-20': 0.01 },
  TON:   { 'TON': 0.05, 'BEP-20': 0.1 },
  SUI:   { 'SUI': 0.02, 'BEP-20': 0.05 },
  APT:   { 'APT': 0.01, 'BEP-20': 0.05 },
  NEAR:  { 'NEAR': 0.01, 'BEP-20': 0.05 },
  ARB:   { 'ARB': 0.5, 'ERC-20': 1.0, 'BEP-20': 0.5 },
  OP:    { 'OP': 0.2, 'ERC-20': 0.5, 'BEP-20': 0.2 },
  INJ:   { 'INJ': 0.05, 'BEP-20': 0.1 },
  TIA:   { 'TIA': 0.1, 'BEP-20': 0.2 },
  FET:   { 'FET': 0.5, 'BEP-20': 1 },
  WLD:   { 'ERC-20': 0.1, 'BEP-20': 0.2 },
  ENA:   { 'ERC-20': 0.5, 'BEP-20': 0.5 },

  // --- Stablecoins ---
  TUSD:  { 'ERC-20': 2, 'BEP-20': 1 },
  FDUSD: { 'BEP-20': 0.5, 'ERC-20': 1 },
  DAI:   { 'ERC-20': 1, 'BEP-20': 0.5 },
  USDE:  { 'ERC-20': 1, 'BEP-20': 0.5 },

  // --- L1 / L2 natives ---
  ALGO:  { 'ALGO': 0.5 },
  BCH:   { 'BCH': 0.0001, 'BEP-20': 0.0005 },
  DASH:  { 'DASH': 0.002 },
  EOS:   { 'EOS': 0.1 },
  ETC:   { 'ETC': 0.02, 'BEP-20': 0.1 },
  FIL:   { 'FIL': 0.005, 'BEP-20': 0.05 },
  NEO:   { 'NEO': 0.05 },
  SC:    { 'SC': 50 },
  XLM:   { 'XLM': 0.05 },
  XTZ:   { 'XTZ': 0.05 },
  ZEC:   { 'ZEC': 0.005 },
  VET:   { 'VET': 100 },
  WAVES: { 'WAVES': 0.002 },
  ICP:   { 'ICP': 0.01 },
  KAS:   { 'KAS': 1 },
  KAVA:  { 'KAVA': 0.1 },
  MNT:   { 'MNT': 5 },
  ROSE:  { 'ROSE': 1 },
  SEI:   { 'SEI': 0.1 },
  STX:   { 'STX': 0.5 },
  ZK:    { 'ERC-20': 0.1, 'BEP-20': 0.1 },
  ZRO:   { 'ERC-20': 0.5 },
  STRK:  { 'STRK': 0.5 },
  WIF:   { 'SOL': 0.05 },
  JUP:   { 'SOL': 0.05 },
  PYTH:  { 'SOL': 0.05 },
  JTO:   { 'SOL': 0.05 },
  RON:   { 'RON': 0.5 },
  BEAM:  { 'BEAM': 0.5 },
  FLR:   { 'FLR': 1 },
  EGLD:  { 'EGLD': 0.05 },
  FLOW:  { 'FLOW': 0.05 },
  CHZ:   { 'ERC-20': 30, 'BEP-20': 20 },
  SFP:   { 'BEP-20': 0.5 },
  CFX:   { 'CFX': 0.1 },
  KSM:   { 'KSM': 0.05 },
  HNT:   { 'HNT': 0.1 },
  IOST:  { 'IOST': 1 },
  ICX:   { 'ICX': 1 },
  ZIL:   { 'ERC-20': 200, 'BEP-20': 200 },
  QTUM:  { 'QTUM': 0.5 },
  OMG:   { 'ERC-20': 0.5, 'BEP-20': 0.5 },
  ZRX:   { 'ERC-20': 5, 'BEP-20': 3 },
  BAT:   { 'ERC-20': 10, 'BEP-20': 10 },
  KNC:   { 'ERC-20': 1, 'BEP-20': 0.5 },
  REN:   { 'ERC-20': 5 },
  SNX:   { 'ERC-20': 1, 'BEP-20': 0.5 },
  YFI:   { 'ERC-20': 0.0002, 'BEP-20': 0.0002 },
  COMP:  { 'ERC-20': 0.02, 'BEP-20': 0.05 },
  AAVE:  { 'ERC-20': 0.02, 'BEP-20': 0.01 },
  MKR:   { 'ERC-20': 0.005, 'BEP-20': 0.01 },
  CRV:   { 'ERC-20': 2, 'BEP-20': 1 },
  BAL:   { 'ERC-20': 0.5, 'BEP-20': 0.3 },
  SUSHI: { 'ERC-20': 1, 'BEP-20': 1 },
  UNI:   { 'ERC-20': 0.2, 'BEP-20': 0.1 },
  LDO:   { 'ERC-20': 0.1, 'BEP-20': 0.1 },
  RPL:   { 'ERC-20': 0.05 },
  GRT:   { 'ERC-20': 10, 'BEP-20': 10 },
  IMX:   { 'ERC-20': 0.5, 'BEP-20': 0.5 },
  RNDR:  { 'RENDER': 0.05, 'BEP-20': 0.1 },
  PEPE:  { 'ERC-20': 100000, 'BEP-20': 100000 },
  SHIB:  { 'ERC-20': 50000, 'BEP-20': 50000 },
  FLOKI: { 'ERC-20': 50000, 'BEP-20': 50000 },
  WBTC:  { 'ERC-20': 0.0002, 'BEP-20': 0.0002 },
  MANA:  { 'ERC-20': 20, 'BEP-20': 20 },
  SAND:  { 'ERC-20': 20, 'BEP-20': 20 },
  AXS:   { 'ERC-20': 1, 'BEP-20': 0.5 },
  GALA:  { 'ERC-20': 200, 'BEP-20': 200 },
  ENJ:   { 'ERC-20': 20, 'BEP-20': 20 },
  CHR:   { 'BEP-20': 5 },
  ALICE: { 'BEP-20': 1 },
  ANKR:  { 'BEP-20': 50 },
  COTI:  { 'BEP-20': 5 },
  CELO:  { 'CELO': 0.5 },
  RUNE:  { 'ERC-20': 0.2, 'BEP-20': 0.5 },
  ILV:   { 'ERC-20': 0.005, 'BEP-20': 0.01 },
  DENT:  { 'ERC-20': 5000, 'BEP-20': 5000 },
  ONE:   { 'ERC-20': 200, 'BEP-20': 200 },
  NKN:   { 'ERC-20': 50, 'BEP-20': 50 },
  JUV:   { 'ERC-20': 0.5, 'BEP-20': 0.5 },
  PSG:   { 'BEP-20': 0.5 },
  ATM:   { 'BEP-20': 0.5 },
  ASR:   { 'BEP-20': 0.5 },
  OG:    { 'BEP-20': 0.5 },
  LAZIO: { 'BEP-20': 0.5 },
  TRB:   { 'ERC-20': 0.05, 'BEP-20': 0.05 },
  REQ:   { 'ERC-20': 5, 'BEP-20': 5 },
  GLM:   { 'GLM': 0.3, 'ERC-20': 5, 'BEP-20': 5 },
  IOTX:  { 'BEP-20': 5 },
  MTL:   { 'ERC-20': 1, 'BEP-20': 1 },
  KCS:   { 'ERC-20': 0.5, 'BEP-20': 0.5 },
  GT:    { 'ERC-20': 0.5, 'BEP-20': 0.5 },
  LEO:   { 'ERC-20': 5, 'BEP-20': 5 },
  OKB:   { 'ERC-20': 0.5, 'BEP-20': 0.5 },
  HT:    { 'ERC-20': 0.5, 'BEP-20': 0.5 },
  CRO:   { 'CRO': 5, 'ERC-20': 5, 'BEP-20': 5 },
  LUNA:  { 'BEP-20': 0.5 },
  LUNC:  { 'BEP-20': 1000 },
  USTC:  { 'BEP-20': 5 },
  STETH: { 'ERC-20': 0.0015 },
  FRAX:  { 'ERC-20': 1, 'BEP-20': 0.5 },
  BUSD:  { 'BEP-20': 0.5, 'ERC-20': 1 },
  ETHW:  { 'ETHW': 0.001 },
  ETCM:  { 'ETCM': 0.01 },
  NMR:   { 'ERC-20': 0.1 },
  DIA:   { 'ERC-20': 1, 'BEP-20': 1 },
  ENS:   { 'ERC-20': 0.1, 'BEP-20': 0.2 },
  BLUR:  { 'ERC-20': 1, 'BEP-20': 1 },
  LRC:   { 'ERC-20': 5, 'BEP-20': 5 },
  AR:    { 'AR': 0.1 },
  GLMR:  { 'GLMR': 0.5 },
  MOVR:  { 'MOVR': 0.05 },
  CELR:  { 'ERC-20': 50, 'BEP-20': 50 },
  AUDIO: { 'ERC-20': 5, 'BEP-20': 5 },
  APE:   { 'ERC-20': 1, 'BEP-20': 0.5 },
  MAGIC: { 'ERC-20': 1, 'BEP-20': 1 },
  GMX:   { 'ARB': 0.1, 'ERC-20': 0.5 },
  RDNT:  { 'ARB': 0.5 },
  PENDLE: { 'ERC-20': 0.5, 'BEP-20': 0.5 },
  ATH:   { 'BEP-20': 5 },
  BOME:  { 'SOL': 0.05 },
  BNBX:  { 'BEP-20': 0.001 },
};

const DEFAULT_NETWORK = {};
for (const base of Object.keys(WITHDRAW_FEES)) {
  const networks = Object.keys(WITHDRAW_FEES[base]);
  DEFAULT_NETWORK[base] = networks[0];
}
// Curated preferred defaults for the highest-traffic assets.
const PREFERRED_DEFAULTS = {
  BTC: 'BTC', ETH: 'ERC-20', USDT: 'TRC-20', USDC: 'ERC-20', BNB: 'BEP-20',
  SOL: 'SOL', XRP: 'XRP', ADA: 'ADA', DOGE: 'DOGE', AVAX: 'AVAX',
  TRX: 'TRX', LINK: 'ERC-20', MATIC: 'MATIC', DOT: 'DOT', ATOM: 'ATOM',
  LTC: 'LTC', ARB: 'ARB', OP: 'OP', TIA: 'TIA', INJ: 'INJ', FET: 'FET',
  SUI: 'SUI', APT: 'APT', NEAR: 'NEAR', TON: 'TON', PEPE: 'ERC-20',
  WLD: 'ERC-20', ENA: 'ERC-20', WBTC: 'ERC-20', RNDR: 'RENDER',
  GLM: 'GLM', CRO: 'CRO', STETH: 'ERC-20', GMX: 'ARB',
};
for (const [k, v] of Object.entries(PREFERRED_DEFAULTS)) {
  if (WITHDRAW_FEES[k] && WITHDRAW_FEES[k][v] != null) DEFAULT_NETWORK[k] = v;
}

export function getDefaultNetwork(base) {
  return DEFAULT_NETWORK[base] || null;
}

export function getWithdrawFee(base, network) {
  const fees = WITHDRAW_FEES[base];
  if (!fees) return null;
  if (network && fees[network] != null) return fees[network];
  const keys = Object.keys(fees);
  return keys.length ? fees[keys[0]] : null;
}

// Networks commonly supported across most venues for a given asset.
export function getCandidateNetworks(base) {
  return Object.keys(WITHDRAW_FEES[base] || {});
}

export function getWithdrawFeeTable() {
  return WITHDRAW_FEES;
}

export const WITHDRAW_FEE_COVERAGE = Object.keys(WITHDRAW_FEES).length;
