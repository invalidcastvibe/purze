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
    parent: "m/44'/145'/1'",
    full: "m/44'/145'/1'/0/0",
  },
};

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
