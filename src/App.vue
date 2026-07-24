<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BaseWallet, Config, HDWallet, NetworkType, TestNetHDWallet, TestNetWallet, TokenSendRequest, Wallet, convert } from 'mainnet-js';
import { IndexedDBProvider } from '@mainnet-cash/indexeddb-storage';
import type { IWalletKit, WalletKitTypes } from '@reown/walletkit';
import { binToHex, encodeLockingBytecodeP2pkh, secp256k1, sha256 } from '@bitauth/libauth';
import type { WcSignMessageRequest, WcSignTransactionRequest } from '@bch-wc2/interfaces';
import { DERIVATION_PATHS, type DerivationPathType, resolveDerivationPaths } from './lib/derivation';
import UiSelect from './components/UiSelect.vue';

type WalletKind = 'single' | 'hd';
type SessionMap = Record<string, { peerName: string; accounts: string[] }>;

type ManagedWallet = {
  name: string;
  type: WalletKind;
  source?: 'created' | 'imported';
};

type ActiveWallet = Wallet | HDWallet | TestNetWallet | TestNetHDWallet;

type TokenSummary = {
  category: string;
  displayName: string;
  decimals: number;
  symbol?: string;
  fungibleAmount: bigint;
  nftCount: number;
};

type ManageWalletDetails = {
  name: string;
  type: WalletKind;
  source?: 'created' | 'imported';
  isActive: boolean;
  address?: string;
  tokenAddress?: string;
  derivation?: string;
  error?: string;
};

type SelectOption = {
  value: string;
  label: string;
};

const WALLETCONNECT_PROJECT_ID = '3fd234b8e2cd0e1da4bc08a0011bbf64';

const status = ref('Ready');
const toastMessage = ref('');
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const wallets = ref<ManagedWallet[]>([]);
const activeWalletName = ref('');
const activeWalletType = ref<WalletKind>('single');
const activeWallet = ref<ActiveWallet | null>(null);

const newWalletName = ref('');
const mode = ref<'create' | 'import'>('create');
const importSeed = ref('');
const importWalletType = ref<WalletKind>('single');
const derivationPathType = ref<DerivationPathType>('standard');
const customDerivationPath = ref('');
const showSeedPhrase = ref(false);
const derivationUpdateType = ref<DerivationPathType>('standard');
const customDerivationPathUpdate = ref('');
const isUpdatingDerivation = ref(false);
const actionSheetWalletName = ref<string | null>(null);
const manageWalletDetails = ref<ManageWalletDetails | null>(null);
const loadingManageWalletDetails = ref(false);
const manageModalMode = ref<'overview' | 'derivation' | 'backup'>('overview');
const createImportModalOpen = ref(false);
const aboutModalOpen = ref(false);
const receiveModalOpen = ref(false);
const receiveAddressType = ref<'bch' | 'token'>('bch');
const receiveQrDataUrl = ref('');
const isGeneratingReceiveQr = ref(false);
const managerMode = ref<'none' | 'backup' | 'derivation'>('none');

const bchBalance = ref<bigint>(0n);
const usdBalance = ref<number | null>(null);
const walletAddress = ref('');
const tokenWalletAddress = ref('');
const tokenList = ref<TokenSummary[]>([]);
const tokenNameCache = ref<Record<string, { name: string; symbol?: string; decimals: number }>>({});
const sendMode = ref<'bch' | 'token'>('bch');
const sendToAddress = ref('');
const sendBchAmount = ref('');
const sendTokenCategory = ref('');
const sendTokenAmount = ref('');
const isSendingFunds = ref(false);
const sendCollapsed = ref(true);
const walletConnectCollapsed = ref(true);
const tokenListCollapsed = ref(true);
const isMobileView = ref(false);
const walletManagerCollapsed = ref(true);
const walletManagerSectionEl = ref<HTMLElement | null>(null);
const copiedTokenId = ref<string | null>(null);
let copiedTokenTimer: ReturnType<typeof setTimeout> | null = null;

const wcUri = ref('');
const walletKit = ref<IWalletKit | null>(null);
const wcSessions = ref<SessionMap>({});

Config.UseIndexedDBCache = true;
BaseWallet.StorageProvider = IndexedDBProvider;
Config.DefaultParentDerivationPath = DERIVATION_PATHS.standard.parent;

const walletNames = computed(() => wallets.value.map((w) => w.name));
const resolvedDerivation = computed(() => resolveDerivationPaths(derivationPathType.value, customDerivationPath.value));
const activeWalletOptions = computed<SelectOption[]>(() => wallets.value.map((w) => ({ value: w.name, label: `${w.name} (${w.type})` })));
const sendModeOptions: SelectOption[] = [
  { value: 'bch', label: 'Send BCH' },
  { value: 'token', label: 'Send CashToken' },
];
const receiveAddressTypeOptions: SelectOption[] = [
  { value: 'bch', label: 'BCH Address' },
  { value: 'token', label: 'CashToken Address' },
];
const modeOptions: SelectOption[] = [
  { value: 'create', label: 'Create' },
  { value: 'import', label: 'Import' },
] ;
const walletTypeOptions: SelectOption[] = [
  { value: 'single', label: 'Single Address' },
  { value: 'hd', label: 'HD' },
] ;
const derivationOptions = computed<SelectOption[]>(() => [
  { value: 'standard', label: `${DERIVATION_PATHS.standard.parent} (standard)` },
  { value: 'bitcoindotcom', label: `${DERIVATION_PATHS.bitcoindotcom.parent} (bitcoin.com)` },
  { value: 'zapit', label: `${DERIVATION_PATHS.zapit.parent} (zapit)` },
  { value: 'custom', label: 'Custom' },
]);
const activeDerivationPath = computed(() => {
  const w = activeWallet.value;
  if (!w) return 'Not available';
  if ('derivationPath' in w) return (w as { derivationPath: string }).derivationPath;
  if ('derivation' in w) return (w as { derivation: string }).derivation;
  return 'Not available';
});
const activeSeedPhrase = computed(() => {
  const w = activeWallet.value as (ActiveWallet & { mnemonic?: string }) | null;
  return w?.mnemonic ?? null;
});
const sendableTokens = computed(() => tokenList.value.filter((token) => token.fungibleAmount > 0n));
const selectedSendToken = computed(() => sendableTokens.value.find((token) => token.category === sendTokenCategory.value) ?? null);
const selectedReceiveAddress = computed(() => (receiveAddressType.value === 'token' ? tokenWalletAddress.value : walletAddress.value));
const sendTokenOptions = computed<SelectOption[]>(() =>
  sendableTokens.value.map((token) => ({
    value: token.category,
    label: `${token.displayName}${token.symbol ? ` (${token.symbol})` : ''} - ${formatTokenAmount(token.fungibleAmount, token.decimals)}`,
  })),
);

function onSendModeChange(value: string) {
  sendMode.value = value === 'token' ? 'token' : 'bch';
  if (sendMode.value === 'token' && !sendTokenCategory.value) {
    sendTokenCategory.value = sendableTokens.value[0]?.category ?? '';
  }
}

function onSendTokenCategoryChange(value: string) {
  sendTokenCategory.value = value;
}

function onReceiveAddressTypeChange(value: string) {
  receiveAddressType.value = value === 'token' ? 'token' : 'bch';
}

function updateViewportState() {
  isMobileView.value = window.innerWidth < 860;
  if (!isMobileView.value) {
    sendCollapsed.value = false;
    walletConnectCollapsed.value = false;
    tokenListCollapsed.value = false;
  }
}

function toggleSendCollapsed() {
  if (!isMobileView.value) return;
  sendCollapsed.value = !sendCollapsed.value;
}

function toggleWalletConnectCollapsed() {
  if (!isMobileView.value) return;
  walletConnectCollapsed.value = !walletConnectCollapsed.value;
}

function toggleTokenListCollapsed() {
  if (!isMobileView.value) return;
  tokenListCollapsed.value = !tokenListCollapsed.value;
}

function parseBchToSats(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(trimmed)) return null;
  const [wholePart, fractionPart = ''] = trimmed.split('.');
  const paddedFraction = (fractionPart + '00000000').slice(0, 8);
  const whole = BigInt(wholePart || '0');
  const fraction = BigInt(paddedFraction || '0');
  return whole * 100_000_000n + fraction;
}

function parseTokenAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const [wholePart, fractionPart = ''] = trimmed.split('.');
  if (fractionPart.length > decimals) return null;

  const paddedFraction = (fractionPart + '0'.repeat(decimals)).slice(0, decimals);
  const whole = BigInt(wholePart || '0');
  const fraction = paddedFraction ? BigInt(paddedFraction) : 0n;
  return whole * (10n ** BigInt(decimals)) + fraction;
}

function resetSendForm() {
  sendToAddress.value = '';
  sendBchAmount.value = '';
  sendTokenAmount.value = '';
}

async function sendBch() {
  if (!activeWallet.value) {
    status.value = 'No active wallet selected';
    return;
  }

  const cashaddr = sendToAddress.value.trim();
  const sats = parseBchToSats(sendBchAmount.value);
  if (!cashaddr) {
    status.value = 'Destination address is required';
    return;
  }
  if (sats === null || sats <= 0n) {
    status.value = 'Enter a valid BCH amount';
    return;
  }

  isSendingFunds.value = true;
  try {
    const { txId } = await activeWallet.value.send([{ cashaddr, value: sats }]);
    status.value = txId ? `BCH sent. TxId: ${txId}` : 'BCH sent';
    resetSendForm();
    await refreshBalancesAndTokens();
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Failed to send BCH';
  } finally {
    isSendingFunds.value = false;
  }
}

async function sendCashToken() {
  if (!activeWallet.value) {
    status.value = 'No active wallet selected';
    return;
  }

  const cashaddr = sendToAddress.value.trim();
  const category = sendTokenCategory.value;
  const selectedToken = sendableTokens.value.find((token) => token.category === category);
  const amount = parseTokenAmount(sendTokenAmount.value, selectedToken?.decimals ?? 0);
  if (!cashaddr) {
    status.value = 'Destination token address is required';
    return;
  }
  if (!category) {
    status.value = 'Select a token category';
    return;
  }
  if (amount === null || amount <= 0n) {
    status.value = `Enter a valid token amount (max ${selectedToken?.decimals ?? 0} decimals)`;
    return;
  }

  if (!selectedToken || amount > selectedToken.fungibleAmount) {
    status.value = 'Insufficient token balance';
    return;
  }

  isSendingFunds.value = true;
  try {
    const { txId } = await activeWallet.value.send([
      new TokenSendRequest({
        cashaddr,
        category,
        amount,
      }),
    ]);
    status.value = txId ? `CashToken sent. TxId: ${txId}` : 'CashToken sent';
    resetSendForm();
    await refreshBalancesAndTokens();
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Failed to send CashToken';
  } finally {
    isSendingFunds.value = false;
  }
}

async function sendFunds() {
  if (isSendingFunds.value) return;
  if (sendMode.value === 'token') {
    await sendCashToken();
    return;
  }
  await sendBch();
}

function fallbackTokenName(category: string): string {
  return `Token ${category.slice(0, 8)}`;
}

function truncateTokenId(category: string): string {
  if (category.length <= 12) return category;
  return `${category.slice(0, 4)}...${category.slice(-4)}`;
}

async function copyTokenId(category: string) {
  if (!navigator.clipboard?.writeText) {
    status.value = 'Clipboard is unavailable on this browser';
    return;
  }
  try {
    await navigator.clipboard.writeText(category);
    copiedTokenId.value = category;
    if (copiedTokenTimer) {
      clearTimeout(copiedTokenTimer);
    }
    copiedTokenTimer = setTimeout(() => {
      if (copiedTokenId.value === category) {
        copiedTokenId.value = null;
      }
    }, 900);
    status.value = 'Token ID copied';
  } catch {
    status.value = 'Failed to copy token ID';
  }
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals <= 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  if (fraction === 0n) return whole.toString();

  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionText}`;
}

async function fetchTokenName(category: string): Promise<{ name: string; symbol?: string; decimals: number }> {
  const cached = tokenNameCache.value[category];
  if (cached) return cached;

  const fallback = { name: fallbackTokenName(category), decimals: 0 };
  try {
    const res = await fetch(`https://bcmr.paytaca.com/api/tokens/${category}/`);
    if (!res.ok) return fallback;

    const data = (await res.json()) as {
      error?: string;
      name?: string;
      token?: { symbol?: string; decimals?: number };
    };
    if (data.error) return fallback;

    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallback.name;
    const symbol = typeof data.token?.symbol === 'string' && data.token.symbol.trim() ? data.token.symbol.trim() : '';
    const decimals = typeof data.token?.decimals === 'number' && data.token.decimals >= 0
      ? Math.floor(data.token.decimals)
      : 0;
    const result = symbol ? { name, symbol, decimals } : { name, decimals };
    tokenNameCache.value[category] = result;
    return result;
  } catch {
    return fallback;
  }
}

async function hydrateTokenNames(list: TokenSummary[]) {
  const names = await Promise.all(list.map((token) => fetchTokenName(token.category)));
  tokenList.value = list.map((token, i) => {
    const nextName = names[i];
    const nextSymbol = nextName?.symbol;
    return nextSymbol
      ? { ...token, displayName: nextName.name, symbol: nextSymbol, decimals: nextName.decimals }
      : { ...token, displayName: nextName?.name ?? token.displayName, decimals: nextName?.decimals ?? token.decimals };
  });
}

function formatBchFromSats(sats: bigint): string {
  const bch = Number(sats) / 100_000_000;
  return bch.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function formatUsd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'Not available';
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function saveWallets() {
  localStorage.setItem('slim.wallets', JSON.stringify(wallets.value));
  localStorage.setItem('slim.activeWalletName', activeWalletName.value);
}

function loadWallets() {
  const raw = localStorage.getItem('slim.wallets');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as ManagedWallet[];
    if (Array.isArray(parsed)) {
      wallets.value = parsed.filter(
        (w) =>
          typeof w?.name === 'string' &&
          (w.type === 'single' || w.type === 'hd') &&
          (w.source === undefined || w.source === 'created' || w.source === 'imported'),
      );
    }
  } catch {
    wallets.value = [];
  }
  const active = localStorage.getItem('slim.activeWalletName');
  if (active && wallets.value.some((w) => w.name === active)) {
    activeWalletName.value = active;
    activeWalletType.value = wallets.value.find((w) => w.name === active)?.type ?? 'single';
  }
}

function getWalletMeta(name: string) {
  return wallets.value.find((w) => w.name === name) ?? null;
}

async function onActiveWalletChange(value: string) {
  activeWalletName.value = value;
  await loadActiveWallet(value);
  status.value = `Active wallet switched to ${value}. Balances and tokens refreshed.`;
}

function onModeChange(value: string) {
  mode.value = value === 'import' ? 'import' : 'create';
}

function onWalletTypeChange(value: string) {
  importWalletType.value = value === 'hd' ? 'hd' : 'single';
}

function onDerivationPathTypeChange(value: string) {
  if (value === 'bitcoindotcom' || value === 'zapit' || value === 'custom') {
    derivationPathType.value = value;
    return;
  }
  derivationPathType.value = 'standard';
}

function inferDerivationSelection(path: string): { type: DerivationPathType; customPath: string } {
  if (path === DERIVATION_PATHS.standard.parent || path === DERIVATION_PATHS.standard.full) {
    return { type: 'standard', customPath: '' };
  }
  if (path === DERIVATION_PATHS.bitcoindotcom.parent || path === DERIVATION_PATHS.bitcoindotcom.full) {
    return { type: 'bitcoindotcom', customPath: '' };
  }
  if (path === DERIVATION_PATHS.zapit.parent || path === DERIVATION_PATHS.zapit.full) {
    return { type: 'zapit', customPath: '' };
  }
  return { type: 'custom', customPath: path };
}

function syncDerivationEditorFromActiveWallet() {
  const currentPath = activeDerivationPath.value;
  if (!currentPath || currentPath === 'Not available') {
    derivationUpdateType.value = 'standard';
    customDerivationPathUpdate.value = '';
    return;
  }
  const inferred = inferDerivationSelection(currentPath);
  derivationUpdateType.value = inferred.type;
  customDerivationPathUpdate.value = inferred.customPath;
}

function syncDerivationEditorFromPath(path: string) {
  if (!path || path === 'Not available') {
    derivationUpdateType.value = 'standard';
    customDerivationPathUpdate.value = '';
    return;
  }
  const inferred = inferDerivationSelection(path);
  derivationUpdateType.value = inferred.type;
  customDerivationPathUpdate.value = inferred.customPath;
}

function onDerivationUpdateTypeChange(value: string) {
  if (value === 'bitcoindotcom' || value === 'zapit' || value === 'custom') {
    derivationUpdateType.value = value;
    return;
  }
  derivationUpdateType.value = 'standard';
}

function getWalletDerivationString(wallet: ActiveWallet): string {
  if ('derivationPath' in wallet) return (wallet as { derivationPath: string }).derivationPath;
  if ('derivation' in wallet) return (wallet as { derivation: string }).derivation;
  return 'Not available';
}

async function loadActiveWallet(name: string) {
  const meta = getWalletMeta(name);
  if (!meta) {
    throw new Error('Unknown wallet');
  }

  activeWalletType.value = meta.type;
  activeWalletName.value = name;

  let wallet: ActiveWallet;
  if (meta.type === 'hd') {
    wallet = await HDWallet.named(name);
  } else {
    wallet = await Wallet.named(name);
  }

  activeWallet.value = wallet;
  walletAddress.value = wallet.getDepositAddress();
  tokenWalletAddress.value = wallet.getTokenDepositAddress();
  showSeedPhrase.value = false;
  managerMode.value = 'none';
  syncDerivationEditorFromActiveWallet();
  await refreshBalancesAndTokens();
  await syncSessionAddresses();
  saveWallets();

  if (actionSheetWalletName.value) {
    void loadManageWalletDetails(actionSheetWalletName.value);
  }
}

async function loadManageWalletDetails(walletName: string) {
  const meta = getWalletMeta(walletName);
  if (!meta) {
    manageWalletDetails.value = null;
    return;
  }

  const base: ManageWalletDetails = {
    name: walletName,
    type: meta.type,
    source: meta.source,
    isActive: walletName === activeWalletName.value,
  };

  loadingManageWalletDetails.value = true;
  manageWalletDetails.value = base;
  try {
    const wallet = meta.type === 'hd' ? await HDWallet.named(walletName) : await Wallet.named(walletName);
    manageWalletDetails.value = {
      ...base,
      address: wallet.getDepositAddress(),
      tokenAddress: wallet.getTokenDepositAddress(),
      derivation: getWalletDerivationString(wallet),
    };
    syncDerivationEditorFromPath(manageWalletDetails.value.derivation ?? 'Not available');
  } catch (error) {
    manageWalletDetails.value = {
      ...base,
      error: error instanceof Error ? error.message : 'Failed to load wallet details',
    };
  } finally {
    loadingManageWalletDetails.value = false;
  }
}

function openWalletActionSheet(walletName: string) {
  actionSheetWalletName.value = walletName;
  manageModalMode.value = 'overview';
  void loadManageWalletDetails(walletName);
}

function closeWalletActionSheet() {
  actionSheetWalletName.value = null;
  manageWalletDetails.value = null;
  loadingManageWalletDetails.value = false;
  manageModalMode.value = 'overview';
}

function openCreateImportModal() {
  createImportModalOpen.value = true;
}

function closeCreateImportModal() {
  createImportModalOpen.value = false;
}

function openAboutModal() {
  aboutModalOpen.value = true;
}

function closeAboutModal() {
  aboutModalOpen.value = false;
}

async function renderReceiveQr() {
  const address = selectedReceiveAddress.value.trim();
  if (!address) {
    receiveQrDataUrl.value = '';
    return;
  }

  isGeneratingReceiveQr.value = true;
  try {
    const qrcode = await import('qrcode');
    receiveQrDataUrl.value = await qrcode.toDataURL(address, {
      margin: 1,
      width: 280,
      color: {
        dark: '#e2e8f0',
        light: '#0f172a',
      },
    });
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Failed to generate QR';
    receiveQrDataUrl.value = '';
  } finally {
    isGeneratingReceiveQr.value = false;
  }
}

async function openReceiveModal() {
  receiveAddressType.value = 'bch';
  receiveModalOpen.value = true;
  await renderReceiveQr();
}

function closeReceiveModal() {
  receiveModalOpen.value = false;
}

async function copyText(text: string, label: string) {
  if (!text) return;
  if (!navigator.clipboard?.writeText) {
    status.value = 'Clipboard is unavailable on this browser';
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    status.value = `${label} copied`;
  } catch {
    status.value = `Failed to copy ${label.toLowerCase()}`;
  }
}

async function ensureManagedWalletActive() {
  const walletName = actionSheetWalletName.value;
  if (!walletName) return false;
  if (activeWalletName.value !== walletName) {
    await loadActiveWallet(walletName);
  }
  return true;
}

async function openManageDerivation() {
  const ok = await ensureManagedWalletActive();
  if (!ok) return;
  syncDerivationEditorFromActiveWallet();
  manageModalMode.value = 'derivation';
}

async function openManageBackup() {
  const ok = await ensureManagedWalletActive();
  if (!ok) return;
  showSeedPhrase.value = false;
  manageModalMode.value = 'backup';
}

async function deleteWalletFromDb(name: string, dbName: 'bitcoincash' | 'bchtest') {
  if (!name) throw new Error('Wallet name must be non-empty');

  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onerror = () => reject(new Error(`Failed to open database: ${dbName}`));

    request.onsuccess = () => {
      const db = request.result;
      const storeName = 'wallet';
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve();
        return;
      }

      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const delRequest = store.delete(name);

      delRequest.onsuccess = () => {
        db.close();
        resolve();
      };

      delRequest.onerror = () => {
        db.close();
        reject(new Error(`Failed to delete wallet: ${name}`));
      };
    };
  });
}

async function deleteManagedWallet() {
  const walletName = actionSheetWalletName.value;
  if (!walletName) return;

  if (walletName === activeWalletName.value) {
    status.value = 'Cannot delete the active wallet. Switch first.';
    return;
  }

  const confirmed = window.confirm(`Delete wallet "${walletName}" from this device?`);
  if (!confirmed) return;

  try {
    await Promise.all([
      deleteWalletFromDb(walletName, 'bitcoincash'),
      deleteWalletFromDb(walletName, 'bchtest'),
    ]);

    wallets.value = wallets.value.filter((wallet) => wallet.name !== walletName);
    saveWallets();
    closeWalletActionSheet();
    status.value = `Wallet ${walletName} deleted`;
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Failed to delete wallet';
  }
}

async function openWalletManagerAction(walletName: string, action: 'backup' | 'derivation') {
  closeWalletActionSheet();
  if (activeWalletName.value !== walletName) {
    await loadActiveWallet(walletName);
  }

  walletManagerCollapsed.value = false;
  managerMode.value = action;
  showSeedPhrase.value = action === 'backup';
  if (action === 'derivation') {
    syncDerivationEditorFromActiveWallet();
  }

  requestAnimationFrame(() => {
    walletManagerSectionEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function updateActiveWalletDerivationPath() {
  if (!activeWallet.value || !activeWalletName.value) {
    status.value = 'No active wallet selected';
    return;
  }
  if (!activeSeedPhrase.value) {
    status.value = 'Seed phrase unavailable for this wallet';
    return;
  }

  const resolved = resolveDerivationPaths(derivationUpdateType.value, customDerivationPathUpdate.value);
  if (!resolved) {
    status.value = 'Invalid derivation path';
    return;
  }

  const name = activeWalletName.value;
  const seed = activeSeedPhrase.value.trim().replace(/\s+/g, ' ');
  isUpdatingDerivation.value = true;
  try {
    if (activeWalletType.value === 'hd') {
      const walletId = `hd:mainnet:${seed}:${resolved.parent}:0:0`;
      await HDWallet.replaceNamed(name, walletId);
      await TestNetHDWallet.replaceNamed(name, walletId.replace('mainnet', 'testnet'));
    } else {
      const walletId = `seed:mainnet:${seed}:${resolved.full}`;
      await Wallet.replaceNamed(name, walletId);
      await TestNetWallet.replaceNamed(name, walletId.replace('mainnet', 'testnet'));
    }

    await loadActiveWallet(name);
    await refreshBalancesAndTokens();
    closeWalletActionSheet();
    status.value = 'Derivation path updated and wallet reloaded';
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Failed to update derivation path';
  } finally {
    isUpdatingDerivation.value = false;
  }
}

async function createOrImportWallet() {
  const name = newWalletName.value.trim();
  if (!name) {
    status.value = 'Wallet name is required';
    return;
  }
  if (walletNames.value.includes(name)) {
    status.value = 'Wallet name already exists';
    return;
  }

  const walletType = importWalletType.value;

  try {
    if (mode.value === 'create') {
      const parent = DERIVATION_PATHS.standard.parent;
      Config.DefaultParentDerivationPath = parent;
      if (walletType === 'hd') {
        const w = await HDWallet.named(name);
        const walletId = w.toDbString().replace('mainnet', 'testnet');
        await TestNetHDWallet.replaceNamed(name, walletId);
      } else {
        const w = await Wallet.named(name);
        const walletId = w.toDbString().replace('mainnet', 'testnet');
        await TestNetWallet.replaceNamed(name, walletId);
      }
    } else {
      const seed = importSeed.value.trim().replace(/\s+/g, ' ');
      if (!seed) {
        status.value = 'Seed phrase is required';
        return;
      }

      const resolved = resolvedDerivation.value;
      if (!resolved) {
        status.value = 'Invalid derivation path';
        return;
      }

      if (walletType === 'hd') {
        const walletId = `hd:mainnet:${seed}:${resolved.parent}:0:0`;
        await HDWallet.replaceNamed(name, walletId);
        await TestNetHDWallet.replaceNamed(name, walletId.replace('mainnet', 'testnet'));
      } else {
        const walletId = `seed:mainnet:${seed}:${resolved.full}`;
        await Wallet.replaceNamed(name, walletId);
        await TestNetWallet.replaceNamed(name, walletId.replace('mainnet', 'testnet'));
      }
    }

    wallets.value.push({ name, type: walletType, source: mode.value === 'create' ? 'created' : 'imported' });
    await loadActiveWallet(name);
    newWalletName.value = '';
    importSeed.value = '';
    closeCreateImportModal();
    status.value = `Wallet ${name} ready`;
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Failed to create/import wallet';
  }
}

async function refreshBalancesAndTokens() {
  if (!activeWallet.value) return;
  const utxos = await activeWallet.value.getUtxos();
  bchBalance.value = utxos
    .filter((u) => u.token === undefined)
    .reduce((sum, u) => sum + u.satoshis, 0n);

  try {
    const oneBchInUsd = await convert(1, 'bch', 'usd');
    const balanceBch = Number(bchBalance.value) / 100_000_000;
    usdBalance.value = balanceBch * oneBchInUsd;
  } catch {
    usdBalance.value = null;
  }

  const tokenMap = new Map<string, TokenSummary>();
  for (const utxo of utxos) {
    const category = utxo.token?.category;
    if (!category) continue;
    const existing = tokenMap.get(category) ?? {
      category,
      displayName: fallbackTokenName(category),
      decimals: 0,
      fungibleAmount: 0n,
      nftCount: 0,
    };
    if (utxo.token?.amount) {
      existing.fungibleAmount += utxo.token.amount;
    }
    if (utxo.token?.nft) {
      existing.nftCount += 1;
    }
    tokenMap.set(category, existing);
  }
  const nextTokenList = [...tokenMap.values()];
  tokenList.value = nextTokenList;
  if (!sendableTokens.value.some((token) => token.category === sendTokenCategory.value)) {
    sendTokenCategory.value = sendableTokens.value[0]?.category ?? '';
  }
  void hydrateTokenNames(nextTokenList);
}

function getSessionAddress(topic: string) {
  const sessions = walletKit.value?.getActiveSessions();
  const accounts = sessions?.[topic]?.namespaces?.bch?.accounts;
  if (!accounts || accounts.length === 0) return undefined;
  return accounts[0]?.substring(4);
}

function getSigningInfo(topic: string) {
  if (!activeWallet.value) throw new Error('No active wallet');

  if (activeWallet.value instanceof HDWallet) {
    const address = getSessionAddress(topic) ?? activeWallet.value.getDepositAddress();
    const cacheEntry = activeWallet.value.walletCache.get(address);
    if (!cacheEntry?.privateKey) {
      throw new Error('Address private key not found in HD wallet cache');
    }
    const pubkeyCompressed = secp256k1.compressPublicKey(cacheEntry.publicKey);
    if (typeof pubkeyCompressed === 'string') {
      throw new Error('Failed to compress pubkey');
    }
    return {
      privateKey: cacheEntry.privateKey,
      pubkeyCompressed,
      publicKeyHash: cacheEntry.publicKeyHash,
    };
  }

  if (!(activeWallet.value instanceof Wallet || activeWallet.value instanceof TestNetWallet)) {
    throw new Error('Unsupported wallet type for single-address signing');
  }

  if (!activeWallet.value.privateKey || !activeWallet.value.publicKeyCompressed) {
    throw new Error('No private key available');
  }

  return {
    privateKey: activeWallet.value.privateKey,
    pubkeyCompressed: activeWallet.value.publicKeyCompressed,
    publicKeyHash: activeWallet.value.publicKeyHash,
  };
}

async function handleSessionRequest(event: WalletKitTypes.SessionRequest) {
  if (!walletKit.value || !activeWallet.value) return;

  const { topic, id, params } = event;
  const method = params.request.method;

  try {
    switch (method) {
      case 'bch_getAddresses':
      case 'bch_getAccounts': {
        const result = [walletAddress.value];
        await walletKit.value.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } });
        break;
      }
      case 'bch_signMessage':
      case 'personal_sign': {
        const req = params.request.params as WcSignMessageRequest;
        const signingInfo = getSigningInfo(topic);
        const signed = activeWallet.value.sign(req.message, signingInfo.privateKey);
        await walletKit.value.respondSessionRequest({
          topic,
          response: { id, jsonrpc: '2.0', result: signed.signature },
        });
        break;
      }
      case 'bch_signTransaction': {
        const [{ parseExtendedJson }, { createSignedWcTransaction }] = await Promise.all([
          import('./lib/extendedJson'),
          import('./lib/wcSigning'),
        ]);
        const parsed = parseExtendedJson(JSON.stringify(params.request.params)) as WcSignTransactionRequest;
        const signingInfo = getSigningInfo(topic);
        const walletLockingBytecodeHex = binToHex(encodeLockingBytecodeP2pkh(signingInfo.publicKeyHash));
        const encodedTransaction = createSignedWcTransaction(parsed, signingInfo, walletLockingBytecodeHex);
        const txHash = binToHex(sha256.hash(sha256.hash(encodedTransaction)).reverse());
        const result = {
          signedTransaction: binToHex(encodedTransaction),
          signedTransactionHash: txHash,
        };

        if (parsed.broadcast) {
          await activeWallet.value.submitTransaction(encodedTransaction);
        }

        await walletKit.value.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } });
        break;
      }
      default: {
        await walletKit.value.respondSessionRequest({
          topic,
          response: {
            id,
            jsonrpc: '2.0',
            error: { code: 1001, message: `Unsupported method ${method}` },
          },
        });
      }
    }
    status.value = `Handled WalletConnect request: ${method}`;
  } catch (error) {
    await walletKit.value.respondSessionRequest({
      topic,
      response: {
        id,
        jsonrpc: '2.0',
        error: { code: 7, message: error instanceof Error ? error.message : 'Request failed' },
      },
    });
    status.value = `WalletConnect error on ${method}`;
  }
}

function refreshSessionMap() {
  if (!walletKit.value) {
    wcSessions.value = {};
    return;
  }
  const sessions = walletKit.value.getActiveSessions();
  const result: SessionMap = {};

  for (const [topic, session] of Object.entries(sessions)) {
    result[topic] = {
      peerName: session.peer.metadata.name,
      accounts: session.namespaces.bch?.accounts ?? [],
    };
  }

  wcSessions.value = result;
}

async function syncSessionAddresses() {
  if (!walletKit.value || !walletAddress.value) return;
  const sessions = walletKit.value.getActiveSessions();

  for (const [topic, session] of Object.entries(sessions)) {
    const chain = activeWallet.value?.network === NetworkType.Mainnet ? 'bch:bitcoincash' : 'bch:bchtest';
    const namespaces = {
      ...session.namespaces,
      bch: {
        methods: ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage', 'bch_cancelPendingRequests'],
        events: ['addressesChanged'],
        chains: [chain],
        accounts: [`bch:${walletAddress.value}`],
      },
    };

    await walletKit.value.updateSession({ topic, namespaces });
  }

  refreshSessionMap();
}

async function initWalletConnect() {
  if (walletKit.value) return;

  const [{ Core }, walletKitModule] = await Promise.all([
    import('@walletconnect/core'),
    import('@reown/walletkit'),
  ]);
  const { WalletKit } = walletKitModule;
  const core = new Core({ projectId: WALLETCONNECT_PROJECT_ID });
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
  const instance = await WalletKit.init({
    // @ts-expect-error WalletKit expects a stricter ICore relayUrl typing than Core runtime provides.
    core,
    metadata: {
      name: 'Purze BCH Wallet',
      description: 'Slim BCH wallet',
      url: appOrigin,
      icons: [`${appOrigin}/favicon.svg`],
    },
  });

  instance.on('session_proposal', async (proposal) => {
    const chain = activeWallet.value?.network === NetworkType.Mainnet ? 'bch:bitcoincash' : 'bch:bchtest';
    const namespaces = {
      bch: {
        methods: ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage', 'bch_cancelPendingRequests'],
        chains: [chain],
        events: ['addressesChanged'],
        accounts: [`bch:${walletAddress.value}`],
      },
    };
    await instance.approveSession({ id: proposal.id, namespaces });
    refreshSessionMap();
    status.value = `WalletConnect approved for ${proposal.params.proposer.metadata.name}`;
  });

  instance.on('session_request', (event) => {
    void handleSessionRequest(event);
  });

  instance.on('session_delete', () => {
    refreshSessionMap();
  });

  walletKit.value = instance;
  refreshSessionMap();
}

async function pairWalletConnect() {
  if (!walletKit.value) {
    await initWalletConnect();
  }
  if (!wcUri.value.trim()) {
    status.value = 'WalletConnect URI required';
    return;
  }

  await walletKit.value?.pair({ uri: wcUri.value.trim() });
  wcUri.value = '';
  status.value = 'WalletConnect pairing started';
}

async function disconnectSession(topic: string) {
  if (!walletKit.value) return;
  await walletKit.value.disconnectSession({
    topic,
    reason: { code: 6000, message: 'User disconnected.' },
  });
  refreshSessionMap();
}

onMounted(async () => {
  updateViewportState();
  window.addEventListener('resize', updateViewportState);
  loadWallets();
  if (activeWalletName.value) {
    try {
      await loadActiveWallet(activeWalletName.value);
    } catch {
      status.value = 'Failed to load previously active wallet';
    }
  }
});

watch(status, (value) => {
  if (!value || value === 'Ready') return;
  toastMessage.value = value;
  toastVisible.value = true;
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 3200);
});

watch([actionSheetWalletName, createImportModalOpen, aboutModalOpen, receiveModalOpen], ([manageModal, createModal, aboutModal, receiveModal]) => {
  const lockScroll = Boolean(manageModal) || Boolean(createModal) || Boolean(aboutModal) || Boolean(receiveModal);
  document.body.style.overflow = lockScroll ? 'hidden' : '';
  document.documentElement.style.overflow = lockScroll ? 'hidden' : '';
});

watch([receiveModalOpen, receiveAddressType, walletAddress, tokenWalletAddress], ([open]) => {
  if (!open) return;
  void renderReceiveQr();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportState);
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
});
</script>

<template>
  <main class="app-shell">
    <div class="topbar">
      <h1>
        <button class="header-brand-btn" @click="openAboutModal" title="About Purze BCH Wallet">
          <FontAwesomeIcon :icon="['fas', 'cube']" class="icon-head" />Purze BCH Wallet
        </button>
      </h1>
    </div>

    <div class="panel-grid">
    <section class="panel panel-active">
      <h2><FontAwesomeIcon :icon="['fas', 'wallet']" class="icon-title" />Active Wallet</h2>

      <div class="row">
        <label for="active-wallet-select">Wallet</label>
        <UiSelect
          id="active-wallet-select"
          :model-value="activeWalletName"
          :options="activeWalletOptions"
          placeholder="Select wallet"
          @update:modelValue="onActiveWalletChange"
        />
      </div>

      <div class="meta" v-if="activeWallet">
        <div>
          <div class="meta-head-inline">
            <strong>BCH wallet address:</strong>
            <button class="tiny-btn inline-copy-btn" @click="copyText(walletAddress, 'BCH address')" title="Copy BCH address" aria-label="Copy BCH address">
              <span class="inline-copy-icon" aria-hidden="true">⧉</span>
            </button>
          </div>
          <div class="mono">{{ walletAddress }}</div>
        </div>
        <div>
          <div class="meta-head-inline">
            <strong>CashToken wallet address:</strong>
            <button class="tiny-btn inline-copy-btn" @click="copyText(tokenWalletAddress, 'CashToken address')" title="Copy CashToken address" aria-label="Copy CashToken address">
              <span class="inline-copy-icon" aria-hidden="true">⧉</span>
            </button>
          </div>
          <div class="mono">{{ tokenWalletAddress }}</div>
        </div>
        <div><strong>Derivation:</strong> {{ activeDerivationPath }}</div>
        <div><strong>BCH balance:</strong> {{ bchBalance.toString() }} sats ({{ formatBchFromSats(bchBalance) }} BCH)</div>
        <div><strong>USD equivalent:</strong> {{ formatUsd(usdBalance) }}</div>
        <div class="active-wallet-actions">
          <button @click="openReceiveModal"><FontAwesomeIcon :icon="['fas', 'wallet']" class="icon-btn" />Receive</button>
          <button @click="refreshBalancesAndTokens"><FontAwesomeIcon :icon="['fas', 'rotate']" class="icon-btn" />Refresh balances/tokens</button>
        </div>

        <div class="send-box">
          <button
            v-if="isMobileView"
            class="collapse-toggle sub-collapse"
            @click="toggleSendCollapsed"
            :aria-expanded="(!sendCollapsed).toString()"
          >
            <span><FontAwesomeIcon :icon="['fas', 'paper-plane']" class="icon-btn" />Send</span>
            <FontAwesomeIcon :icon="sendCollapsed ? ['fas', 'plus'] : ['fas', 'xmark']" class="icon-btn" />
          </button>
          <h3 v-else><FontAwesomeIcon :icon="['fas', 'paper-plane']" class="icon-title" />Send</h3>

          <div v-if="!isMobileView || !sendCollapsed" class="send-box-body">
          <div class="row">
            <label for="send-asset-select">Asset</label>
            <UiSelect
              id="send-asset-select"
              :model-value="sendMode"
              :options="sendModeOptions"
              @update:modelValue="onSendModeChange"
            />
          </div>

          <div class="row" v-if="sendMode === 'token'">
            <label for="send-token-select">Token</label>
            <UiSelect
              id="send-token-select"
              :model-value="sendTokenCategory"
              :options="sendTokenOptions"
              placeholder="Select token"
              @update:modelValue="onSendTokenCategoryChange"
            />
          </div>

          <div class="row">
            <label for="send-to-address-input">{{ sendMode === 'token' ? 'To Token Address' : 'To BCH Address' }}</label>
            <input
              id="send-to-address-input"
              v-model="sendToAddress"
              :placeholder="sendMode === 'token' ? 'bitcoincash:... token address' : 'bitcoincash:... BCH address'"
            />
          </div>

          <div class="row" v-if="sendMode === 'bch'">
            <label for="send-bch-amount-input">Amount (BCH)</label>
            <input id="send-bch-amount-input" v-model="sendBchAmount" placeholder="0.00001" />
          </div>

          <div class="row" v-else>
            <label for="send-token-amount-input">Amount{{ selectedSendToken ? ` (${selectedSendToken.decimals} decimals)` : '' }}</label>
            <input id="send-token-amount-input" v-model="sendTokenAmount" :placeholder="selectedSendToken?.decimals ? '1.0' : '1'" />
          </div>

          <button @click="sendFunds" :disabled="isSendingFunds || (sendMode === 'token' && sendableTokens.length === 0)">
            <FontAwesomeIcon :icon="['fas', isSendingFunds ? 'rotate' : 'paper-plane']" class="icon-btn" />
            {{ isSendingFunds ? 'Sending...' : (sendMode === 'token' ? 'Send CashToken' : 'Send BCH') }}
          </button>
          <p class="hint" v-if="sendMode === 'token' && selectedSendToken">
            Available: {{ formatTokenAmount(selectedSendToken.fungibleAmount, selectedSendToken.decimals) }}{{ selectedSendToken.symbol ? ` ${selectedSendToken.symbol}` : '' }}
          </p>
          <p class="hint" v-if="sendMode === 'token' && sendableTokens.length === 0">No fungible CashToken balance available to send.</p>
          </div>
        </div>
      </div>
      <div v-else>
        Create or import a wallet to see details.
      </div>
    </section>

    <section class="panel panel-tokens">
      <button
        v-if="isMobileView"
        class="collapse-toggle"
        @click="toggleTokenListCollapsed"
        :aria-expanded="(!tokenListCollapsed).toString()"
      >
        <span><FontAwesomeIcon :icon="['fas', 'coins']" class="icon-btn" />Tokens</span>
        <FontAwesomeIcon :icon="tokenListCollapsed ? ['fas', 'plus'] : ['fas', 'xmark']" class="icon-btn" />
      </button>
      <h2 v-else><FontAwesomeIcon :icon="['fas', 'coins']" class="icon-title" />Tokens</h2>

      <div v-if="!isMobileView || !tokenListCollapsed" class="section-body">
      <div v-if="tokenList.length === 0">No tokens found.</div>
      <div class="token-cards" v-else>
        <article class="token-card" v-for="token in tokenList" :key="`card-${token.category}`">
          <div class="token-main-line">
            <div class="token-card-title">{{ token.displayName }}<span v-if="token.symbol"> ({{ token.symbol }})</span></div>
            <div class="token-quick-stats">
              <strong>{{ formatTokenAmount(token.fungibleAmount, token.decimals) }}</strong>
              <span class="token-nft-mini">NFT {{ token.nftCount }}</span>
            </div>
          </div>
          <button class="token-id-btn" :class="{ copied: copiedTokenId === token.category }" @click="copyTokenId(token.category)" :title="token.category">
            <span class="token-id mono">{{ truncateTokenId(token.category) }}</span>
            <span class="token-id-copy">{{ copiedTokenId === token.category ? 'Copied' : 'Copy' }}</span>
            <span class="copy-check" :class="{ show: copiedTokenId === token.category }" aria-hidden="true"></span>
          </button>
        </article>
      </div>
      <div class="table-wrap desktop-table" v-if="tokenList.length > 0">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Fungible Amount</th>
            <th>NFT Count</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="token in tokenList" :key="token.category">
            <td>{{ token.displayName }}<span v-if="token.symbol"> ({{ token.symbol }})</span></td>
            <td>
              <button class="token-id-btn" :class="{ copied: copiedTokenId === token.category }" @click="copyTokenId(token.category)" :title="token.category">
                <span class="token-id mono">{{ truncateTokenId(token.category) }}</span>
                <span class="token-id-copy">{{ copiedTokenId === token.category ? 'Copied' : 'Copy' }}</span>
                <span class="copy-check" :class="{ show: copiedTokenId === token.category }" aria-hidden="true"></span>
              </button>
            </td>
            <td>{{ formatTokenAmount(token.fungibleAmount, token.decimals) }}</td>
            <td>{{ token.nftCount }}</td>
          </tr>
        </tbody>
      </table>
      </div>
      </div>
    </section>

    <section ref="walletManagerSectionEl" class="panel panel-wallet">
      <button class="collapse-toggle" @click="walletManagerCollapsed = !walletManagerCollapsed">
        <span><FontAwesomeIcon :icon="['fas', 'wallet']" class="icon-btn" />Wallet Manager</span>
        <FontAwesomeIcon :icon="walletManagerCollapsed ? ['fas', 'plus'] : ['fas', 'xmark']" class="icon-btn" />
      </button>
      <div v-if="!walletManagerCollapsed" class="manager-body">
      <div class="manager-subpanel">
        <h3>Wallets</h3>
        <div v-if="wallets.length === 0" class="hint">No wallets yet.</div>
        <ul v-else class="wallet-list">
          <li v-for="wallet in wallets" :key="wallet.name" class="wallet-item">
            <div class="wallet-item-main">
              <div :title="`Type: ${wallet.type}${wallet.source ? `, Source: ${wallet.source}` : ''}`">
                <strong>{{ wallet.name }}</strong>
                <span v-if="wallet.name === activeWalletName" class="wallet-tag active">active</span>
              </div>
              <div class="wallet-item-actions">
                <button class="tiny-btn wallet-row-btn" @click="onActiveWalletChange(wallet.name)">Use</button>
                <button class="tiny-btn wallet-row-btn" @click="openWalletActionSheet(wallet.name)">
                  <FontAwesomeIcon :icon="['fas', 'sliders']" class="icon-btn" />Manage
                </button>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <div class="manager-subpanel manager-create-import">
        <h3>Create / Import Wallet</h3>
        <p class="hint">Open the wallet setup modal to create a new wallet or import from seed phrase.</p>
        <button @click="openCreateImportModal"><FontAwesomeIcon :icon="['fas', 'plus']" class="icon-btn" />Open Create / Import</button>
      </div>

      <div class="manager-subpanel" v-if="activeWallet && managerMode === 'backup'">
        <h3>Backup</h3>
        <p class="hint">Reveal and save this seed phrase securely offline.</p>
        <button @click="showSeedPhrase = !showSeedPhrase">
          <FontAwesomeIcon :icon="['fas', showSeedPhrase ? 'xmark' : 'plus']" class="icon-btn" />
          {{ showSeedPhrase ? 'Hide Seed Phrase' : 'Show Seed Phrase' }}
        </button>
        <p v-if="showSeedPhrase && activeSeedPhrase" class="seed-phrase mono">{{ activeSeedPhrase }}</p>
        <p v-if="showSeedPhrase && !activeSeedPhrase" class="hint">Seed phrase is not available for this wallet.</p>
      </div>

      <div class="manager-subpanel" v-if="activeWallet && managerMode === 'derivation'">
        <h3>Derivation Path Reload</h3>
        <p class="hint">If needed, switch derivation path and reload this wallet using its current seed phrase.</p>
        <div class="row">
          <label for="manager-derivation-select">New Derivation Path</label>
          <UiSelect
            id="manager-derivation-select"
            :model-value="derivationUpdateType"
            :options="derivationOptions"
            @update:modelValue="onDerivationUpdateTypeChange"
          />
        </div>
        <div class="row" v-if="derivationUpdateType === 'custom'">
          <label for="manager-custom-derivation-input">Custom Path</label>
          <input id="manager-custom-derivation-input" v-model="customDerivationPathUpdate" placeholder="m/44'/145'/0' or m/44'/145'/0'/0/0" />
        </div>
        <button @click="updateActiveWalletDerivationPath" :disabled="isUpdatingDerivation || !activeSeedPhrase">
          <FontAwesomeIcon :icon="['fas', 'rotate']" class="icon-btn" />
          {{ isUpdatingDerivation ? 'Updating...' : 'Update Derivation & Reload' }}
        </button>
      </div>
      </div>
    </section>

    <section class="panel panel-wc">
      <button
        v-if="isMobileView"
        class="collapse-toggle"
        @click="toggleWalletConnectCollapsed"
        :aria-expanded="(!walletConnectCollapsed).toString()"
      >
        <span><FontAwesomeIcon :icon="['fas', 'link']" class="icon-btn" />WalletConnect</span>
        <FontAwesomeIcon :icon="walletConnectCollapsed ? ['fas', 'plus'] : ['fas', 'xmark']" class="icon-btn" />
      </button>
      <h2 v-else><FontAwesomeIcon :icon="['fas', 'link']" class="icon-title" />WalletConnect</h2>

      <div v-if="!isMobileView || !walletConnectCollapsed" class="section-body">
      <div class="row">
        <label for="wc-uri-input">WC URI</label>
        <input id="wc-uri-input" v-model="wcUri" placeholder="wc:..." />
      </div>
      <button @click="pairWalletConnect" :disabled="!activeWallet"><FontAwesomeIcon :icon="['fas', 'plug']" class="icon-btn" />Pair</button>

      <p class="hint">WalletConnect initializes on first use to reduce startup data usage.</p>

      <h3>Sessions</h3>
      <div v-if="Object.keys(wcSessions).length === 0">No active sessions.</div>
      <ul v-else>
        <li v-for="session in Object.entries(wcSessions)" :key="session[0]">
          <div><strong>{{ session[1].peerName }}</strong></div>
          <div class="mono">{{ session[0] }}</div>
          <div class="mono" v-for="account in session[1].accounts" :key="account">{{ account }}</div>
          <button @click="disconnectSession(session[0])"><FontAwesomeIcon :icon="['fas', 'xmark']" class="icon-btn" />Disconnect</button>
        </li>
      </ul>
      <p class="hint">
        Note: this slim wallet auto-approves WalletConnect proposals and request signing for simplicity.
      </p>
      </div>
    </section>
    </div>

    <div
      v-if="actionSheetWalletName"
      class="action-sheet-overlay"
      @click.self="closeWalletActionSheet"
    >
      <dialog class="action-sheet" open aria-label="Wallet actions">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">Manage Wallet</strong>
            <span class="action-sheet-subtitle">{{ actionSheetWalletName }}</span>
          </div>
          <button class="icon-close" @click="closeWalletActionSheet" aria-label="Close wallet actions">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="manage-view-tabs" v-if="actionSheetWalletName">
          <button class="tab-btn" :class="{ active: manageModalMode === 'overview' }" @click="manageModalMode = 'overview'">Overview</button>
          <button class="tab-btn" :class="{ active: manageModalMode === 'derivation' }" @click="openManageDerivation">Derivation</button>
          <button class="tab-btn" :class="{ active: manageModalMode === 'backup' }" @click="openManageBackup">Backup</button>
        </div>

        <template v-if="manageModalMode === 'overview'">
        <div class="manage-wallet-info" v-if="manageWalletDetails">
          <div class="hint" v-if="loadingManageWalletDetails">Loading wallet details...</div>
          <template v-else>
            <div class="manage-wallet-badges">
              <span class="wallet-tag">{{ manageWalletDetails.type }}</span>
              <span class="wallet-tag source">{{ manageWalletDetails.source ?? 'unknown' }}</span>
              <span class="wallet-tag" :class="manageWalletDetails.isActive ? 'active' : ''">{{ manageWalletDetails.isActive ? 'active' : 'inactive' }}</span>
            </div>
            <div class="manage-field"><span class="manage-label">Name</span><span>{{ manageWalletDetails.name }}</span></div>
            <div class="manage-field"><span class="manage-label">BCH Address</span><span class="mono">{{ manageWalletDetails.address ?? 'Not available' }}</span></div>
            <div class="manage-field"><span class="manage-label">Token Address</span><span class="mono">{{ manageWalletDetails.tokenAddress ?? 'Not available' }}</span></div>
            <div class="manage-field"><span class="manage-label">Derivation</span><span>{{ manageWalletDetails.derivation ?? 'Not available' }}</span></div>
            <div class="hint" v-if="manageWalletDetails.error">{{ manageWalletDetails.error }}</div>
          </template>
        </div>

        <div class="manage-actions">
          <button class="action-sheet-btn" @click="openManageDerivation">
            <FontAwesomeIcon :icon="['fas', 'rotate']" class="icon-btn" />Change derivation
          </button>
          <button class="action-sheet-btn" @click="openManageBackup">
            <FontAwesomeIcon :icon="['fas', 'key']" class="icon-btn" />Backup seed phrase
          </button>
        </div>

        <div class="manage-danger-zone">
          <div class="manage-danger-title">Danger Zone</div>
          <div class="hint">Deleting removes this wallet from local device storage.</div>
          <button class="action-sheet-btn delete-wallet-btn" :disabled="manageWalletDetails?.isActive" @click="deleteManagedWallet">
            <FontAwesomeIcon :icon="['fas', 'xmark']" class="icon-btn" />Delete wallet
          </button>
          <div class="hint" v-if="manageWalletDetails?.isActive">Switch to another wallet before deleting this one.</div>
        </div>
        </template>

        <template v-else-if="manageModalMode === 'derivation'">
          <div class="manage-wallet-info">
            <div class="manage-field">
              <span class="manage-label">Current Derivation</span>
              <span>{{ manageWalletDetails?.derivation ?? activeDerivationPath }}</span>
            </div>
            <div class="row">
              <label for="modal-derivation-select">New Derivation Path</label>
              <UiSelect
                id="modal-derivation-select"
                :model-value="derivationUpdateType"
                :options="derivationOptions"
                @update:modelValue="onDerivationUpdateTypeChange"
              />
            </div>
            <div class="row" v-if="derivationUpdateType === 'custom'">
              <label for="modal-custom-derivation-input">Custom Path</label>
              <input id="modal-custom-derivation-input" v-model="customDerivationPathUpdate" placeholder="m/44'/145'/0' or m/44'/145'/0'/0/0" />
            </div>
            <button @click="updateActiveWalletDerivationPath" :disabled="isUpdatingDerivation || !activeSeedPhrase">
              <FontAwesomeIcon :icon="['fas', 'rotate']" class="icon-btn" />
              {{ isUpdatingDerivation ? 'Updating...' : 'Update Derivation & Reload' }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="manage-wallet-info">
            <p class="hint">Reveal and save this seed phrase securely offline.</p>
            <button @click="showSeedPhrase = !showSeedPhrase">
              <FontAwesomeIcon :icon="['fas', showSeedPhrase ? 'xmark' : 'plus']" class="icon-btn" />
              {{ showSeedPhrase ? 'Hide Seed Phrase' : 'Show Seed Phrase' }}
            </button>
            <p v-if="showSeedPhrase && activeSeedPhrase" class="seed-phrase mono">{{ activeSeedPhrase }}</p>
            <p v-if="showSeedPhrase && !activeSeedPhrase" class="hint">Seed phrase is not available for this wallet.</p>
          </div>
        </template>
      </dialog>
    </div>

    <div
      v-if="createImportModalOpen"
      class="action-sheet-overlay"
      @click.self="closeCreateImportModal"
    >
      <dialog class="action-sheet create-import-modal" open aria-label="Create or import wallet">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">Create / Import Wallet</strong>
            <span class="action-sheet-subtitle">Wallet setup</span>
          </div>
          <button class="icon-close" @click="closeCreateImportModal" aria-label="Close create/import wallet modal">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="manage-wallet-info">
          <div class="row">
            <label for="wallet-name-input">Wallet Name</label>
            <input id="wallet-name-input" v-model="newWalletName" placeholder="mywallet" />
          </div>
          <div class="row">
            <label for="wallet-mode-select">Mode</label>
            <UiSelect
              id="wallet-mode-select"
              :model-value="mode"
              :options="modeOptions"
              @update:modelValue="onModeChange"
            />
          </div>
          <div class="row">
            <label for="wallet-type-select">Type</label>
            <UiSelect
              id="wallet-type-select"
              :model-value="importWalletType"
              :options="walletTypeOptions"
              @update:modelValue="onWalletTypeChange"
            />
          </div>
          <template v-if="mode === 'import'">
          <div class="row">
            <label for="wallet-seed-input">Seed Phrase</label>
            <textarea id="wallet-seed-input" v-model="importSeed" rows="3" placeholder="abandon ..."></textarea>
          </div>
          <div class="row">
            <label for="wallet-derivation-select">Derivation Path</label>
            <UiSelect
              id="wallet-derivation-select"
              :model-value="derivationPathType"
              :options="derivationOptions"
              @update:modelValue="onDerivationPathTypeChange"
            />
          </div>
          <div class="row" v-if="derivationPathType === 'custom'">
            <label for="wallet-custom-derivation-input">Custom Path</label>
            <input id="wallet-custom-derivation-input" v-model="customDerivationPath" placeholder="m/44'/145'/0' or m/44'/145'/0'/0/0" />
          </div>
          </template>
        </div>

        <button class="action-sheet-btn" @click="createOrImportWallet"><FontAwesomeIcon :icon="['fas', 'plus']" class="icon-btn" />Create / Import Wallet</button>
      </dialog>
    </div>

    <div
      v-if="aboutModalOpen"
      class="action-sheet-overlay"
      @click.self="closeAboutModal"
    >
      <dialog class="action-sheet about-modal" open aria-label="About Purze BCH Wallet">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">About Purze BCH Wallet</strong>
            <span class="action-sheet-subtitle">Lightweight BCH + CashToken wallet</span>
          </div>
          <button class="icon-close" @click="closeAboutModal" aria-label="Close about modal">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="manage-wallet-info">
          <p>
            Purze BCH Wallet is a streamlined wallet focused on fast day-to-day BCH and CashToken usage.
          </p>
          <div class="manage-field">
            <span class="manage-label">Capabilities</span>
            <span>Multi-wallet support, custom derivation paths, BCH and CashToken sending, token metadata, and WalletConnect pairing.</span>
          </div>
          <div class="manage-field">
            <span class="manage-label">Local Control</span>
            <span>Wallet records are kept on your device storage. Back up your seed phrase and verify recipient addresses before sending.</span>
          </div>
          <div class="manage-field">
            <span class="manage-label">Design Focus</span>
            <span>Minimal mobile-first interface with collapsible sections and clear wallet actions.</span>
          </div>
        </div>
      </dialog>
    </div>

    <div
      v-if="receiveModalOpen"
      class="action-sheet-overlay"
      @click.self="closeReceiveModal"
    >
      <dialog class="action-sheet receive-modal" open aria-label="Receive BCH or CashToken">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">Receive</strong>
            <span class="action-sheet-subtitle">Share address or QR</span>
          </div>
          <button class="icon-close" @click="closeReceiveModal" aria-label="Close receive modal">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="manage-wallet-info">
          <div class="row">
            <label for="receive-address-type-select">Address Type</label>
            <UiSelect
              id="receive-address-type-select"
              :model-value="receiveAddressType"
              :options="receiveAddressTypeOptions"
              @update:modelValue="onReceiveAddressTypeChange"
            />
          </div>

          <div class="meta-head-inline">
            <strong>{{ receiveAddressType === 'token' ? 'CashToken Address' : 'BCH Address' }}</strong>
            <button class="tiny-btn inline-copy-btn" @click="copyText(selectedReceiveAddress, receiveAddressType === 'token' ? 'CashToken address' : 'BCH address')" :title="receiveAddressType === 'token' ? 'Copy CashToken address' : 'Copy BCH address'" :aria-label="receiveAddressType === 'token' ? 'Copy CashToken address' : 'Copy BCH address'">
              <span class="inline-copy-icon" aria-hidden="true">⧉</span>
            </button>
          </div>
          <div class="mono">{{ selectedReceiveAddress }}</div>

          <div class="receive-qr-wrap">
            <div v-if="isGeneratingReceiveQr" class="hint">Generating QR...</div>
            <img v-else-if="receiveQrDataUrl" class="receive-qr" :src="receiveQrDataUrl" :alt="`${receiveAddressType} receive QR`" />
            <div v-else class="hint">QR unavailable</div>
          </div>
        </div>
      </dialog>
    </div>

    <output v-if="toastVisible" class="status-toast" aria-live="polite">{{ toastMessage }}</output>
  </main>
</template>

<style scoped>
.app-shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 14px 14px calc(18px + env(safe-area-inset-bottom));
  font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 14px;
  color: #e6eefc;
  -webkit-text-size-adjust: 100%;
  overflow-x: clip;
}
.app-shell,
.app-shell * {
  box-sizing: border-box;
  min-width: 0;
}
.app-shell::before {
  content: '';
  position: fixed;
  inset: 0;
  background:
    linear-gradient(155deg, #0b1020, #111827 46%, #090f1d);
  z-index: -3;
  pointer-events: none;
}

.app-shell::after {
  content: '';
  position: fixed;
  inset: -28vmax;
  background:
    radial-gradient(circle at 12% 20%, rgba(255, 77, 109, 0.33), transparent 36%),
    radial-gradient(circle at 24% 78%, rgba(255, 159, 28, 0.28), transparent 34%),
    radial-gradient(circle at 52% 24%, rgba(255, 230, 109, 0.23), transparent 32%),
    radial-gradient(circle at 72% 76%, rgba(46, 196, 182, 0.27), transparent 35%),
    radial-gradient(circle at 90% 40%, rgba(58, 134, 255, 0.32), transparent 36%),
    radial-gradient(circle at 58% 54%, rgba(131, 56, 236, 0.24), transparent 34%);
  filter: blur(52px) saturate(120%);
  transform: translateZ(0);
  z-index: -2;
  pointer-events: none;
}
h1 {
  margin-top: 0;
  font-size: 1.2rem;
  line-height: 1.2;
}
.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.header-brand-btn {
  width: auto;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  box-shadow: none;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.header-brand-btn:hover {
  color: #c4e2ff;
}
.status-toast {
  position: fixed;
  right: 12px;
  top: calc(10px + env(safe-area-inset-top));
  z-index: 70;
  max-width: min(84vw, 420px);
  padding: 8px 10px;
  border: 1px solid rgba(191, 219, 254, 0.4);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.92);
  color: #e2e8f0;
  font-size: 0.75rem;
  line-height: 1.25;
  box-shadow: 0 10px 24px rgba(2, 6, 23, 0.34);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  overflow-wrap: anywhere;
}
.panel-grid {
  display: grid;
  gap: 12px;
}
.panel {
  width: 100%;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 10px 28px rgba(2, 6, 23, 0.22);
  overflow: visible;
}
.panel h2,
.panel h3 {
  margin: 0 0 10px;
}
.section-body {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(191, 219, 254, 0.14);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(7px);
  -webkit-backdrop-filter: blur(7px);
}
.collapse-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  border: 1px solid rgba(191, 219, 254, 0.32);
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(125, 211, 252, 0.18), rgba(59, 130, 246, 0.16));
  backdrop-filter: blur(10px) saturate(125%);
  -webkit-backdrop-filter: blur(10px) saturate(125%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 10px 24px rgba(2, 6, 23, 0.24);
}
.manager-body {
  display: grid;
  gap: 2px;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(191, 219, 254, 0.14);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(7px);
  -webkit-backdrop-filter: blur(7px);
}
.manager-subpanel {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.22);
}
.manager-create-import {
  margin-top: 14px;
  padding-top: 12px;
  padding-bottom: 8px;
  border-top: 1px solid rgba(191, 219, 254, 0.35);
  background: rgba(15, 23, 42, 0.14);
  border-radius: 10px;
  padding-left: 8px;
  padding-right: 8px;
}
.wallet-list {
  list-style: none;
  padding-left: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}
.wallet-item {
  margin: 0;
  padding: 6px 7px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.3);
}
.wallet-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wallet-item-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.wallet-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #dbeafe;
}
.wallet-tag.source {
  border-color: rgba(46, 196, 182, 0.5);
}
.wallet-tag.active {
  border-color: rgba(59, 130, 246, 0.7);
}
.tiny-btn {
  width: auto;
  min-width: 0;
  min-height: 30px;
  padding: 5px 9px;
  font-size: 12px;
}
.wallet-row-btn {
  min-height: 27px;
  padding: 4px 7px;
  font-size: 11px;
}
.action-sheet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
  padding: 12px;
}
.action-sheet {
  width: min(520px, 100%);
  border-radius: 16px;
  border: 1px solid rgba(191, 219, 254, 0.4);
  background: linear-gradient(160deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.92));
  backdrop-filter: blur(10px) saturate(125%);
  -webkit-backdrop-filter: blur(10px) saturate(125%);
  padding: 12px;
  display: grid;
  gap: 10px;
  box-shadow: 0 18px 40px rgba(2, 6, 23, 0.52), inset 0 1px 0 rgba(255, 255, 255, 0.16);
  color: #fff;
  animation: modal-pop 180ms ease-out;
}
.action-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 8px;
  border-bottom: 1px solid rgba(191, 219, 254, 0.2);
}
.action-sheet-title-wrap {
  display: grid;
  gap: 2px;
}
.action-sheet-title {
  font-size: 1rem;
}
.action-sheet-subtitle {
  font-size: 0.78rem;
  opacity: 0.86;
}
.manage-view-tabs {
  display: flex;
  gap: 6px;
}
.tab-btn {
  min-width: 0;
  width: auto;
  min-height: 30px;
  padding: 4px 9px;
  font-size: 0.78rem;
  border: 1px solid rgba(191, 219, 254, 0.3);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.38);
}
.tab-btn.active {
  border-color: rgba(125, 211, 252, 0.65);
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.62), rgba(37, 99, 235, 0.56));
}
.action-sheet-btn {
  width: 100%;
  text-align: left;
  min-height: 42px;
  font-size: 0.95rem;
  color: #fff;
}
.manage-wallet-info {
  padding: 10px;
  border: 1px solid rgba(191, 219, 254, 0.28);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.42);
  display: grid;
  gap: 7px;
  font-size: 0.86rem;
}
.create-import-modal {
  width: min(620px, 100%);
}
.about-modal {
  width: min(640px, 100%);
}
.receive-modal {
  width: min(560px, 100%);
}
.manage-wallet-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.manage-field {
  display: grid;
  gap: 2px;
}
.manage-label {
  font-size: 0.72rem;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.manage-actions {
  display: grid;
  gap: 7px;
}
.manage-danger-zone {
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 10px;
  padding: 9px;
  background: rgba(127, 29, 29, 0.16);
  display: grid;
  gap: 7px;
}
.manage-danger-title {
  font-weight: 700;
  color: #fecaca;
}
.delete-wallet-btn {
  border-color: rgba(248, 113, 113, 0.65);
  background: linear-gradient(180deg, rgba(220, 38, 38, 0.74), rgba(185, 28, 28, 0.7));
}
@keyframes modal-pop {
  0% {
    opacity: 0;
    transform: translateY(8px) scale(0.985);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
.icon-close {
  min-width: 38px;
  width: 38px;
  min-height: 38px;
  padding: 0;
}
.seed-phrase {
  margin-top: 8px;
  padding: 8px;
  border-radius: 8px;
  border: 1px dashed rgba(147, 197, 253, 0.55);
  background: rgba(15, 23, 42, 0.35);
}
.row {
  display: grid;
  gap: 6px;
  margin-bottom: 10px;
}
label {
  font-weight: 600;
  font-size: 0.9rem;
}
input,
textarea,
select,
button {
  font: inherit;
}
input,
textarea,
select {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 8px;
  font-size: 15px;
  min-height: 40px;
  background: rgba(15, 23, 42, 0.45);
  color: #e2e8f0;
}
select {
  min-height: 42px;
  font-size: 16px;
  line-height: 1.2;
  padding-right: 30px;
}
button {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid rgba(147, 197, 253, 0.55);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.72), rgba(37, 99, 235, 0.62));
  color: #fff;
  cursor: pointer;
  min-height: 36px;
  font-weight: 600;
  font-size: 0.92rem;
}
button:disabled {
  background: rgba(148, 163, 184, 0.4);
  border-color: rgba(148, 163, 184, 0.5);
  cursor: not-allowed;
}
.meta {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}
.meta-head-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.inline-copy-btn {
  min-height: 22px;
  width: 22px;
  min-width: 22px;
  padding: 0;
  display: inline-grid;
  place-items: center;
}
.inline-copy-icon {
  font-size: 0.75rem;
  margin-right: 0;
}
.active-wallet-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.receive-qr-wrap {
  margin-top: 6px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.48);
  min-height: 170px;
  display: grid;
  place-items: center;
  padding: 10px;
}
.receive-qr {
  width: min(250px, 72vw);
  height: auto;
  border-radius: 8px;
}
.send-box {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.22);
  display: grid;
  gap: 4px;
}
.send-box h3 {
  margin: 0 0 8px;
}
.send-box-body {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(191, 219, 254, 0.14);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(7px);
  -webkit-backdrop-filter: blur(7px);
}
table {
  width: 100%;
  border-collapse: collapse;
  min-width: 540px;
}
th,
td {
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  text-align: left;
  padding: 5px 6px;
  font-size: 0.82rem;
  line-height: 1.2;
}
.desktop-table table {
  min-width: 500px;
}
.desktop-table thead th {
  font-size: 0.76rem;
  opacity: 0.85;
  letter-spacing: 0.01em;
}
.table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.desktop-table {
  display: none;
}
.token-cards {
  display: grid;
  gap: 0;
}
.token-card {
  border: 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  background: transparent;
  border-radius: 0;
  padding: 5px 0;
}
.token-main-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.token-card-title {
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.token-quick-stats {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.78rem;
  white-space: nowrap;
}
.token-nft-mini {
  opacity: 0.72;
  font-size: 0.68rem;
}
.token-id {
  font-size: 0.68rem;
  opacity: 0.7;
  margin-top: 0;
  margin-bottom: 0;
}
.token-id-btn {
  width: auto;
  min-width: 0;
  min-height: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 0;
  border: 0;
  background: transparent;
  margin-bottom: 0;
  min-width: auto;
  color: #dbeafe;
}
.token-id-copy {
  font-size: 0.62rem;
  opacity: 0.62;
}
.copy-check {
  width: 8px;
  height: 4px;
  border-left: 2px solid #7dd3fc;
  border-bottom: 2px solid #7dd3fc;
  transform: rotate(-45deg) scale(0.6);
  transform-origin: center;
  opacity: 0;
}
.copy-check.show {
  animation: copy-check-pop 420ms ease-out;
  opacity: 1;
}
.token-id-btn.copied .token-id-copy {
  color: #7dd3fc;
  opacity: 0.95;
}
.token-card-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 0.82rem;
}
@keyframes copy-check-pop {
  0% {
    opacity: 0;
    transform: rotate(-45deg) scale(0.4);
  }
  55% {
    opacity: 1;
    transform: rotate(-45deg) scale(1.15);
  }
  100% {
    opacity: 1;
    transform: rotate(-45deg) scale(1);
  }
}
ul {
  list-style: none;
  padding-left: 0;
}
li {
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.3);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: anywhere;
  word-break: break-word;
  display: block;
  max-width: 100%;
  color: #dbeafe;
}
.hint {
  color: #cbd5e1;
  font-size: 13px;
}

.icon-head {
  margin-right: 8px;
  color: #93c5fd;
}

.icon-title {
  margin-right: 8px;
  color: #7dd3fc;
  font-size: 0.95em;
}

.icon-btn {
  margin-right: 7px;
  font-size: 0.92em;
}

hr {
  border: 0;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
  margin: 12px 0;
}

@media (max-width: 460px) {
  .app-shell {
    padding: 12px 10px calc(16px + env(safe-area-inset-bottom));
    font-size: 13px;
  }
  .panel {
    padding: 10px;
  }
  h1 {
    font-size: 1rem;
  }
  .topbar {
    align-items: center;
    margin-bottom: 8px;
  }
  .status-toast {
    right: 8px;
    top: calc(8px + env(safe-area-inset-top));
    max-width: min(92vw, 360px);
    font-size: 0.68rem;
    padding: 7px 8px;
  }
  .panel h2 {
    font-size: 1rem;
  }
  .panel h3 {
    font-size: 0.95rem;
  }
  button {
    min-height: 34px;
    padding: 6px 9px;
    font-size: 0.88rem;
  }
  input,
  textarea,
  select {
    min-height: 36px;
    padding: 6px 8px;
    font-size: 14px;
  }
  select {
    min-height: 40px;
    font-size: 16px;
    padding: 8px 10px;
    padding-right: 30px;
  }
  .mono {
    font-size: 0.74rem;
  }
  .token-card-title {
    font-size: 0.84rem;
  }
  .token-quick-stats {
    font-size: 0.72rem;
  }
  .token-nft-mini {
    font-size: 0.64rem;
  }
  .token-id {
    font-size: 0.64rem;
  }
  .token-id-copy {
    font-size: 0.58rem;
  }
  .sub-collapse,
  .section-body,
  .manager-body,
  .send-box-body,
  .collapse-toggle {
    border-radius: 10px;
  }
  .action-sheet-overlay {
    padding: 8px;
  }
  .action-sheet {
    border-radius: 12px;
    padding: 8px;
  }
  .action-sheet-btn {
    min-height: 40px;
    font-size: 0.9rem;
  }
}

@supports not ((backdrop-filter: blur(2px))) {
  .panel {
    background: rgba(15, 23, 42, 0.88);
  }
}

@media (min-width: 860px) {
  .app-shell {
    padding: 22px 24px 28px;
    font-size: 15px;
  }
  .panel-grid {
    grid-template-columns: 1.05fr 1fr;
    gap: 16px;
  }
  .panel-wallet {
    grid-column: 1;
    grid-row: 2;
  }
  .panel-active {
    grid-column: 1;
    grid-row: 1;
  }
  .panel-tokens {
    grid-column: 2;
    grid-row: 1;
  }
  .panel-wc {
    grid-column: 2;
    grid-row: 2;
  }
  button {
    width: auto;
    min-width: 140px;
  }
  .token-cards {
    display: none;
  }
  .desktop-table {
    display: block;
  }
}
</style>
