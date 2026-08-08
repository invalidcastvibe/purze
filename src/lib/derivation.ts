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
  label: string;
  parent: string;
  full: string;
};

export const DERIVATION_SCAN_CANDIDATES: DerivationCandidate[] = [
  {
    label: "Bitcoin.com / BIP44 m/44'/0'/0'",
    parent: "m/44'/0'/0'",
    full: "m/44'/0'/0'/0/0",
  },
  {
    label: "Bitcoin.com / BIP44 m/44'/0'/1'",
    parent: "m/44'/0'/1'",
    full: "m/44'/0'/1'/0/0",
  },
  {
    label: "Bitcoin.com / BIP44 m/44'/0'/2'",
    parent: "m/44'/0'/2'",
    full: "m/44'/0'/2'/0/0",
  },
  {
    label: "Bitcoin.com / BIP44 m/44'/0'/3'",
    parent: "m/44'/0'/3'",
    full: "m/44'/0'/3'/0/0",
  },
  {
    label: "Bitcoin.com / BIP44 m/44'/0'/4'",
    parent: "m/44'/0'/4'",
    full: "m/44'/0'/4'/0/0",
  },
  {
    label: "BCH standard / BIP44 m/44'/145'/0'",
    parent: "m/44'/145'/0'",
    full: "m/44'/145'/0'/0/0",
  },
  {
    label: "BCH standard / BIP44 m/44'/145'/1'",
    parent: "m/44'/145'/1'",
    full: "m/44'/145'/1'/0/0",
  },
  {
    label: "BCH standard / BIP44 m/44'/145'/2'",
    parent: "m/44'/145'/2'",
    full: "m/44'/145'/2'/0/0",
  },
  {
    label: "BCH standard / BIP44 m/44'/145'/3'",
    parent: "m/44'/145'/3'",
    full: "m/44'/145'/3'/0/0",
  },
  {
    label: "BCH standard / BIP44 m/44'/145'/4'",
    parent: "m/44'/145'/4'",
    full: "m/44'/145'/4'/0/0",
  },
  {
    label: "Zapit / BIP44 m/44'/245'/0'",
    parent: "m/44'/245'/0'",
    full: "m/44'/245'/0'/0/0",
  },
  {
    label: "Zapit / BIP44 m/44'/245'/1'",
    parent: "m/44'/245'/1'",
    full: "m/44'/245'/1'/0/0",
  },
  {
    label: "Zapit / BIP44 m/44'/245'/2'",
    parent: "m/44'/245'/2'",
    full: "m/44'/245'/2'/0/0",
  },
  {
    label: "Zapit / BIP44 m/44'/245'/3'",
    parent: "m/44'/245'/3'",
    full: "m/44'/245'/3'/0/0",
  },
  {
    label: "Zapit / BIP44 m/44'/245'/4'",
    parent: "m/44'/245'/4'",
    full: "m/44'/245'/4'/0/0",
  },
  {
    label: "Electron Cash / BIP44 m/44'/145'/5'",
    parent: "m/44'/145'/5'",
    full: "m/44'/145'/5'/0/0",
  },
  {
    label: "Electron Cash / BIP44 m/44'/145'/6'",
    parent: "m/44'/145'/6'",
    full: "m/44'/145'/6'/0/0",
  },
  {
    label: "Bitcoin.com / BIP44 m/44'/0'/5'",
    parent: "m/44'/0'/5'",
    full: "m/44'/0'/5'/0/0",
  },
  {
    label: "Zapit / BIP44 m/44'/245'/5'",
    parent: "m/44'/245'/5'",
    full: "m/44'/245'/5'/0/0",
  },
  {
    label: "Zapit / BIP44 m/44'/245'/6'",
    parent: "m/44'/245'/6'",
    full: "m/44'/245'/6'/0/0",
  },
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
