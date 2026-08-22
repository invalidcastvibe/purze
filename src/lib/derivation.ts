import { type CoinTypeId, SLIP44_REGISTRY, findCoinEntryByType, getCoinType } from './coins';

export type PresetDerivationPathType = 'standard' | 'bitcoindotcom' | 'zapit';
export type DerivationPathType = PresetDerivationPathType | 'custom';

function buildPreset(coinId: CoinTypeId, account = 0): { parent: string; full: string } {
  const parent = `m/44'/${getCoinType(coinId)}'/${account}'`;
  return { parent, full: `${parent}/0/0` };
}

// Presets are derived from the SLIP-44 registry (src/lib/coins.ts) instead
// of hardcoding coin-type numbers here. To add/change a preset's coin type,
// edit coins.ts - this map should never contain a raw number.
export const DERIVATION_PATHS: Record<PresetDerivationPathType, { parent: string; full: string }> = {
  standard: buildPreset('BCH'),
  bitcoindotcom: buildPreset('BTC'),
  zapit: buildPreset('BCH_ZAPIT_LEGACY'),
};

export type DerivationCandidate = {
  /** Human-readable name shown in the scan results list. */
  label: string;
  /** Account-level path, e.g. m/44'/145'/0' */
  parent: string;
  /** Full path including chain and address index, e.g. m/44'/145'/0'/0/0 */
  full: string;
  /** BIP44 chain index (0 = receiving, 1 = change). Non-BIP44 "purpose" branches use other values. */
  chain: number;
  /** Address index within the chain. */
  index: number;
  /**
   * Whether "switching" the active wallet onto this exact path makes sense.
   * Standard receiving-chain candidates (chain 0) are switchable: the app
   * can safely start deriving addresses from account/0/0 onward. Single,
   * non-repeating purpose keys (identity, paycode, etc.) are scan/detect
   * only - switching a whole wallet onto one of those paths wouldn't behave
   * like a normal receive chain, so those are flagged non-switchable.
   */
  switchable: boolean;
};

// Coin types that a "missing funds" scan checks. Sourced from the SLIP-44
// registry - see coins.ts for why each of these is relevant to BCH.
const SCAN_COIN_IDS: CoinTypeId[] = ['BCH', 'BTC', 'BCH_ZAPIT_LEGACY'];

// How many account indexes (the third path level, e.g. .../0', .../1', ...)
// to check per coin type. Covers the common case of a wallet having been
// re-created at a non-zero account index (e.g. Electron Cash's "additional
// wallet" feature, which historically lands on account 5/6 for BCH).
const ACCOUNT_INDEXES_TO_SCAN = [0, 1, 2, 3, 4, 5, 6];

function buildAccountCandidate(coinId: CoinTypeId, account: number): DerivationCandidate {
  const entry = SLIP44_REGISTRY[coinId];
  const parent = `m/44'/${entry.coinType}'/${account}'`;
  return {
    label: `${entry.scanLabel} · account ${account}`,
    parent,
    full: `${parent}/0/0`,
    chain: 0,
    index: 0,
    switchable: true,
  };
}

// Draft/proposed "purpose" branches from the community CHIP-Paths proposal:
// https://bitcoincashcode.org/BitcoinCash/CHIP-Paths
// (discussed at https://bitcoincashresearch.org/t/new-chip-2026-paths-the-derivation-type/1831)
//
// This CHIP is an active, non-finalized draft - it is NOT part of BIP44 and
// is not guaranteed to be adopted as-is. It proposes reserving extra chain
// indexes (alongside the standard 0=receive/1=change chains) under a
// wallet's account path for specific, non-repeating purposes:
//   2 - "identity"/login key, one key used to represent the wallet itself
//   3 - RPA (Reusable Payment Address / paycode) keys
//   7 - already in informal use by the WizardConnect wallet-connect protocol
//       (and reportedly by Cauldron for LP pool keys) for DeFi interactions
// These are included here only so a scan can flag funds mistakenly sent to
// one of these keys - not as a "wallet-wide" derivation to switch onto.
type ChipPathPurpose = { chain: number; index: number; label: string };

const CHIP_PATHS_DRAFT_PURPOSES: ChipPathPurpose[] = [
  { chain: 2, index: 0, label: "Identity/login key (CHIP-Paths draft, .../2/0)" },
  { chain: 3, index: 0, label: "RPA paycode key #1 (CHIP-Paths draft, .../3/0)" },
  { chain: 3, index: 1, label: "RPA paycode key #2 (CHIP-Paths draft, .../3/1)" },
  { chain: 7, index: 0, label: "WizardConnect/DeFi key (CHIP-Paths draft, .../7/0)" },
];

function buildChipPathCandidate(coinId: CoinTypeId, account: number, purpose: ChipPathPurpose): DerivationCandidate {
  const entry = SLIP44_REGISTRY[coinId];
  const parent = `m/44'/${entry.coinType}'/${account}'`;
  return {
    label: `${entry.scanLabel} · account ${account} · ${purpose.label}`,
    parent,
    full: `${parent}/${purpose.chain}/${purpose.index}`,
    chain: purpose.chain,
    index: purpose.index,
    switchable: false,
  };
}

export const DERIVATION_SCAN_CANDIDATES: DerivationCandidate[] = [
  ...SCAN_COIN_IDS.flatMap((coinId) =>
    ACCOUNT_INDEXES_TO_SCAN.map((account) => buildAccountCandidate(coinId, account)),
  ),
  // CHIP-Paths draft purpose branches, checked against the default account
  // (account 0) of the standard BCH coin type - the only combination any
  // known implementation currently derives them from.
  ...CHIP_PATHS_DRAFT_PURPOSES.map((purpose) => buildChipPathCandidate('BCH', 0, purpose)),
];

// --- Parsing & validation ------------------------------------------------

export type DerivationParseErrorCode = 'MALFORMED_PATH' | 'UNKNOWN_COIN_TYPE' | 'ACCOUNT_NOT_HARDENED';

export class DerivationParseError extends Error {
  code: DerivationParseErrorCode;
  constructor(code: DerivationParseErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'DerivationParseError';
  }
}

export interface ParsedDerivationPath {
  purpose: number;
  coinType: number;
  account: number;
  /** Present only when the input was a full path (includes chain/index). */
  chain?: number;
  index?: number;
  isFull: boolean;
}

// m / purpose' / coinType' / account'  (levels 1-3 must be hardened per BIP44)
const PARENT_PATTERN = /^m\/(\d+)'\/(\d+)'\/(\d+)'$/;
// m / purpose' / coinType' / account' / chain / index  (chain/index NOT hardened)
const FULL_PATTERN = /^m\/(\d+)'\/(\d+)'\/(\d+)'\/(\d+)\/(\d+)$/;

/**
 * Parse and validate a BIP44-style derivation path.
 *
 * Accepts either a parent (account-level) path or a full path with
 * chain/index. Requires purpose/coin/account to be hardened, matching BIP44 -
 * this is intentionally stricter than the old ad-hoc regexes, which accepted
 * unhardened levels 1-3.
 *
 * Pass `knownCoinTypesOnly: true` to additionally reject coin types that
 * aren't in the SLIP-44 registry (coins.ts). Off by default so power users
 * can still enter a custom path for a coin type Purze doesn't have a preset
 * for.
 */
export function parseDerivationPath(
  path: string,
  options: { knownCoinTypesOnly?: boolean } = {},
): { ok: true; value: ParsedDerivationPath } | { ok: false; error: DerivationParseError } {
  const trimmed = path.trim();

  const fullMatch = trimmed.match(FULL_PATTERN);
  const parentMatch = fullMatch ? null : trimmed.match(PARENT_PATTERN);
  const match = fullMatch ?? parentMatch;

  if (!match) {
    return {
      ok: false,
      error: new DerivationParseError(
        'MALFORMED_PATH',
        `"${trimmed}" isn't a valid derivation path. Expected m/44'/<coin>'/<account>' or m/44'/<coin>'/<account>'/<chain>/<index>, with purpose/coin/account hardened (').`,
      ),
    };
  }

  const [, purposeStr, coinTypeStr, accountStr, chainStr, indexStr] = match;
  const coinType = Number(coinTypeStr);

  if (options.knownCoinTypesOnly && !findCoinEntryByType(coinType)) {
    return {
      ok: false,
      error: new DerivationParseError('UNKNOWN_COIN_TYPE', `Coin type ${coinType}' isn't a recognized BCH derivation (see src/lib/coins.ts).`),
    };
  }

  return {
    ok: true,
    value: {
      purpose: Number(purposeStr),
      coinType,
      account: Number(accountStr),
      chain: chainStr !== undefined ? Number(chainStr) : undefined,
      index: indexStr !== undefined ? Number(indexStr) : undefined,
      isFull: Boolean(fullMatch),
    },
  };
}

export function resolveDerivationPaths(derivationPath: DerivationPathType, customDerivationPath?: string) {
  if (derivationPath !== 'custom') {
    return DERIVATION_PATHS[derivationPath];
  }

  const trimmedCustomPath = customDerivationPath?.trim();
  if (!trimmedCustomPath) return null;

  const parsed = parseDerivationPath(trimmedCustomPath);
  if (!parsed.ok) return null;

  const parent = `m/${parsed.value.purpose}'/${parsed.value.coinType}'/${parsed.value.account}'`;
  return {
    parent,
    full: parsed.value.isFull ? trimmedCustomPath : `${parent}/0/0`,
  };
}
