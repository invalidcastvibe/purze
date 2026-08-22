/**
 * Single source of truth for BIP44 "coin type" constants used anywhere in
 * Purze (derivation presets, the missing-funds scanner, and any future path
 * validation). Nothing else in the app should hardcode a coin-type number -
 * import it from here instead.
 *
 * Values are taken from the SLIP-0044 registry maintained by SatoshiLabs:
 * https://github.com/satoshilabs/slips/blob/master/slip-0044.md
 *
 * This is intentionally a small, hand-picked subset of that registry (just
 * the coin types Purze actually derives against), not a full copy of the
 * ~600-entry SLIP-44 list. If a project needs the entire list, the
 * `slip44` npm package (or generating this file from the SLIP-44 markdown
 * table in CI) is a reasonable upgrade path - see the note at the bottom of
 * this file.
 */

export type CoinTypeId = 'BCH' | 'BTC' | 'BCH_ZAPIT_LEGACY';

export interface CoinTypeEntry {
  /** Internal identifier used to reference this entry from code. */
  id: CoinTypeId;
  /** SLIP-0044 coin type index - the hardened value at BIP44 path level 2 (m/44'/<coinType>'/...). */
  coinType: number;
  /** Official SLIP-0044 name (or closest match) for this coin type. */
  name: string;
  /** Label used in the derivation-path scanner's results list. */
  scanLabel: string;
  /** Why this coin type matters to a BCH wallet. */
  note: string;
}

export const SLIP44_REGISTRY: Record<CoinTypeId, CoinTypeEntry> = {
  BCH: {
    id: 'BCH',
    coinType: 145,
    name: 'Bitcoin Cash',
    scanLabel: "Bitcoin Cash standard (SLIP-44 145')",
    note: "Canonical SLIP-0044 registration for BCH. Used by Purze's 'standard' preset.",
  },
  BTC: {
    id: 'BTC',
    coinType: 0,
    name: 'Bitcoin',
    scanLabel: "Bitcoin.com Wallet legacy (coin type 0')",
    note: "Bitcoin's SLIP-0044 coin type, reused for BCH by Bitcoin.com Wallet. Used by Purze's 'bitcoindotcom' preset.",
  },
  BCH_ZAPIT_LEGACY: {
    id: 'BCH_ZAPIT_LEGACY',
    coinType: 245,
    name: 'Zapit / SLP-era wallets',
    scanLabel: "Zapit / SLP-era wallets (coin type 245')",
    note: "Non-standard coin type used historically by Zapit and SLP-era wallets. Used by Purze's 'zapit' preset.",
  },
};

export const ALL_COIN_TYPES: CoinTypeEntry[] = Object.values(SLIP44_REGISTRY);

/** Look up a registry entry by its internal id. Throws if the id isn't registered - this indicates a coding error, not user input. */
export function getCoinEntry(id: CoinTypeId): CoinTypeEntry {
  const entry = SLIP44_REGISTRY[id];
  if (!entry) throw new Error(`Unknown internal coin id: ${id}`);
  return entry;
}

/** Convenience accessor for just the numeric coin type. */
export function getCoinType(id: CoinTypeId): number {
  return getCoinEntry(id).coinType;
}

/** Look up a registry entry by its numeric SLIP-44 coin type, e.g. for validating a parsed/custom path. Returns undefined for coin types Purze doesn't know about. */
export function findCoinEntryByType(coinType: number): CoinTypeEntry | undefined {
  return ALL_COIN_TYPES.find((entry) => entry.coinType === coinType);
}

// --- Upgrade path -----------------------------------------------------
// If Purze ever needs the full SLIP-44 list (e.g. to let users pick an
// arbitrary coin type by name), prefer a maintained source over copying
// numbers by hand:
//   - npm package `slip44` (thin, regularly updated wrapper around the
//     official table), or
//   - a small build-time script that fetches slip-0044.md from the SLIPs
//     repo and generates a TS map.
// Either way, this file should stay the *only* place the app reads coin
// types from - swap the data source here, not at each call site.
