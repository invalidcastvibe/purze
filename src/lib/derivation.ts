export type PresetDerivationPathType = 'standard' | 'bitcoindotcom' | 'zapit';
export type DerivationPathType = PresetDerivationPathType | 'custom';

export const DERIVATION_PATHS: Record<PresetDerivationPathType, { parent: string; full: string }> = {
  standard: {
    parent: "m/44'/145'/0'",
    full: "m/44'/145'/0'/0/0",
  },
  bitcoindotcom: {
    parent: "m/44'/0'/0'",
    full: "m/44'/0'/0'/0/0",
  },
  zapit: {
    parent: "m/44'/245'/0'",
    full: "m/44'/245'/0'/0/0",
  },
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

type CoinTypeBase = {
  /** Wallet(s)/ecosystem known to use this BIP44 coin type for BCH. */
  label: string;
  /** SLIP-44 coin type registered/used for this derivation scheme. */
  coinType: number;
};

// Known BIP44 coin types that BCH wallets have derived from historically.
// 145' is the official SLIP-44 registration for Bitcoin Cash. 0' and 245'
// are legacy/alternate coin types some wallets used (either by reusing the
// Bitcoin path, or via the older SLP/CashAddr-era Zapit convention), so a
// "missing funds" scan needs to check all three.
const KNOWN_COIN_TYPE_BASES: CoinTypeBase[] = [
  { label: "Bitcoin Cash standard (SLIP-44 145')", coinType: 145 },
  { label: "Bitcoin.com Wallet legacy (coin type 0')", coinType: 0 },
  { label: "Zapit / SLP-era wallets (coin type 245')", coinType: 245 },
];

// How many account indexes (the third path level, e.g. .../0', .../1', ...)
// to check per coin type. Covers the common case of a wallet having been
// re-created at a non-zero account index (e.g. Electron Cash's "additional
// wallet" feature, which historically lands on account 5/6 for BCH).
const ACCOUNT_INDEXES_TO_SCAN = [0, 1, 2, 3, 4, 5, 6];

function buildAccountCandidate(base: CoinTypeBase, account: number): DerivationCandidate {
  const parent = `m/44'/${base.coinType}'/${account}'`;
  return {
    label: `${base.label} · account ${account}`,
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

function buildChipPathCandidate(base: CoinTypeBase, account: number, purpose: ChipPathPurpose): DerivationCandidate {
  const parent = `m/44'/${base.coinType}'/${account}'`;
  return {
    label: `${base.label} · account ${account} · ${purpose.label}`,
    parent,
    full: `${parent}/${purpose.chain}/${purpose.index}`,
    chain: purpose.chain,
    index: purpose.index,
    switchable: false,
  };
}

export const DERIVATION_SCAN_CANDIDATES: DerivationCandidate[] = [
  ...KNOWN_COIN_TYPE_BASES.flatMap((base) =>
    ACCOUNT_INDEXES_TO_SCAN.map((account) => buildAccountCandidate(base, account)),
  ),
  // CHIP-Paths draft purpose branches, checked against the default account
  // (account 0) of the standard BCH coin type - the only combination any
  // known implementation currently derives them from.
  ...CHIP_PATHS_DRAFT_PURPOSES.map((purpose) => buildChipPathCandidate(KNOWN_COIN_TYPE_BASES[0], 0, purpose)),
];

const PARENT_DERIVATION_PATH_REGEX = /^m(\/\d+'?){3}$/;
const FULL_DERIVATION_PATH_REGEX = /^m(\/\d+'?){3}\/0\/0$/;

export function resolveDerivationPaths(derivationPath: DerivationPathType, customDerivationPath?: string) {
  if (derivationPath !== 'custom') {
    return DERIVATION_PATHS[derivationPath];
  }

  const trimmedCustomPath = customDerivationPath?.trim();
  if (!trimmedCustomPath) return null;

  if (PARENT_DERIVATION_PATH_REGEX.test(trimmedCustomPath)) {
    return {
      parent: trimmedCustomPath,
      full: `${trimmedCustomPath}/0/0`,
    };
  }

  if (FULL_DERIVATION_PATH_REGEX.test(trimmedCustomPath)) {
    return {
      parent: trimmedCustomPath.replace(/\/0\/0$/, ''),
      full: trimmedCustomPath,
    };
  }

  return null;
}
