import { BITCOIN, LITECOIN, SCRIPT_TYPES, utxoAdapter } from "./bitcoin.js";
import { EVM_CHAINS, evmAdapter } from "./evm.js";
import { solanaAdapter } from "./solana.js";
import { tronAdapter } from "./tron.js";
import type { ChainAdapter } from "./types.js";
import { xrpAdapter } from "./xrp.js";

/**
 * Supported chains. To add one, implement ChainAdapter (see types.ts): validate/normalise an
 * address, and fetch per-transaction movements, fees paid and current balances. Netting, token
 * lookup, import, transfer matching and reconciliation are shared (see service.ts).
 */
export function buildChains(): Record<string, ChainAdapter> {
  const list: ChainAdapter[] = [
    utxoAdapter(BITCOIN),
    ...EVM_CHAINS.map(evmAdapter),
    solanaAdapter(),
    utxoAdapter(LITECOIN),
    xrpAdapter(),
    tronAdapter(),
  ];
  return Object.fromEntries(list.map((c) => [c.id, c]));
}

export { SCRIPT_TYPES };
