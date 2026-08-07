<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BaseWallet, Config, HDWallet, NetworkType, TestNetHDWallet, TestNetWallet, TokenSendRequest, UnitEnum, Wallet, convert } from 'mainnet-js';
import { IndexedDBProvider } from '@mainnet-cash/indexeddb-storage';
import type { IWalletKit, WalletKitTypes } from '@reown/walletkit';
import { binToHex, encodeLockingBytecodeP2pkh, secp256k1, sha256 } from '@bitauth/libauth';
import type { WcSignMessageRequest, WcSignTransactionRequest } from '@bch-wc2/interfaces';
import { DERIVATION_PATHS, type DerivationPathType, resolveDerivationPaths } from './lib/derivation';
import UiSelect from './components/UiSelect.vue';

type WalletKind = 'single' | 'hd';
type SessionMap = Record<string, {
  peerName: string;
  peerUrl?: string;
  peerIcon?: string;
  accounts: string[];
}>;

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
  iconUri?: string;
  fungibleAmount: bigint;
  nftCount: number;
};

type TokenMetadata = {
  name: string;
  symbol?: string;
  decimals: number;
  iconUri?: string;
};

type UsdRateCache = {
  rate: number;
  updatedAt: number;
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

type PendingWcRequest = {
  topic: string;
  id: number;
  method: string;
  peerName: string;
  event: WalletKitTypes.SessionRequest;
};

type PendingWcConnectionProposal = {
  id: number;
  appName: string;
  appUrl?: string;
  appIcon?: string;
};

type TokenHistoryItem = {
  hash: string;
  timestamp?: number;
  blockHeight: number;
  valueChange: number;
  tokenAmountChanges: {
    category: string;
    amount: bigint;
    nftAmount: bigint;
  }[];
};

type TokenSendHistoryRow = {
  hash: string;
  timestamp?: number;
  blockHeight: number;
  amount: bigint;
  direction: 'sent' | 'received';
};

type BchSendHistoryRow = {
  hash: string;
  timestamp?: number;
  blockHeight: number;
  amountSats: bigint;
  direction: 'sent' | 'received';
};

type AssetItem = {
  key: string;
  kind: 'bch' | 'token';
  displayName: string;
  symbol?: string;
  iconUri?: string;
  usdValueText: string;
  cauldronPriceText: string;
  amountText: string;
  canSend: boolean;
  nftCount?: number;
  category?: string;
  decimals?: number;
  fungibleAmount?: bigint;
};

type MobilePanel = 'wallet' | 'tokens' | 'manager' | 'walletconnect';
type OverlayScreen = 'none' | 'wallet-list' | 'token-list' | 'send-asset' | 'wallet-connect' | 'manage-wallet' | 'create-import' | 'about' | 'receive';

const WALLETCONNECT_PROJECT_ID = '3fd234b8e2cd0e1da4bc08a0011bbf64';
const TOKEN_NAME_CACHE_STORAGE_KEY = 'slim.tokenNameCache.v2';
const USD_RATE_CACHE_STORAGE_KEY = 'slim.usdRateCache.v1';
const HIDDEN_TOKEN_CATEGORIES_STORAGE_KEY = 'slim.hiddenTokenCategories.v1';
const FAVORITE_TOKEN_CATEGORIES_STORAGE_KEY = 'slim.favoriteTokenCategories.v1';
const IPFS_GATEWAY = 'https://dweb.link/ipfs/';
const MAX_TOKEN_NAME_CACHE_ENTRIES = 350;
const USD_RATE_CACHE_TTL_DESKTOP_MS = 2 * 60 * 1000;
const USD_RATE_CACHE_TTL_MOBILE_MS = 6 * 60 * 1000;

const walletConnectRuntime = globalThis as typeof globalThis & {
  __purzeWalletConnectCore?: unknown;
  __purzeWalletConnectInitPromise?: Promise<IWalletKit>;
};

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
const showActiveDerivationEditor = ref(false);
const actionSheetWalletName = ref<string | null>(null);
const manageWalletDetails = ref<ManageWalletDetails | null>(null);
const loadingManageWalletDetails = ref(false);
const manageModalMode = ref<'overview' | 'derivation' | 'backup'>('overview');
const activeOverlayScreen = ref<OverlayScreen>('none');
const receiveAddressType = ref<'bch' | 'token'>('bch');
const receiveQrDataUrl = ref('');
const isGeneratingReceiveQr = ref(false);
const managerMode = ref<'none' | 'backup' | 'derivation'>('none');

const bchBalance = ref<bigint>(0n);
const usdBalance = ref<number | null>(null);
const bchUsdRate = ref<number | null>(null);
const walletAddress = ref('');
const tokenWalletAddress = ref('');
const tokenList = ref<TokenSummary[]>([]);
const tokenNameCache = ref<Record<string, TokenMetadata>>({});
const hiddenTokenCategories = ref<Record<string, true>>({});
const favoriteTokenCategories = ref<Record<string, true>>({});
const usdRateCache = ref<UsdRateCache | null>(null);
const sendMode = ref<'bch' | 'token'>('bch');
const sendToAddress = ref('');
const sendBchAmount = ref('');
const sendTokenCategory = ref('');
const sendTokenAmount = ref('');
const tokenSendHistory = ref<TokenHistoryItem[]>([]);
const isLoadingTokenSendHistory = ref(false);
const tokenSendHistoryError = ref('');
const isSendingFunds = ref(false);
const sendCollapsed = ref(true);
const walletConnectCollapsed = ref(true);
const tokenListCollapsed = ref(true);
const isMobileView = ref(false);
const mobileActivePanel = ref<MobilePanel>('wallet');
const mobileCompactMode = ref(false);
const showHiddenTokensInModal = ref(false);
const walletManagerCollapsed = ref(true);
const activeWalletSectionEl = ref<HTMLElement | null>(null);
const tokensSectionEl = ref<HTMLElement | null>(null);
const walletManagerSectionEl = ref<HTMLElement | null>(null);
const walletConnectSectionEl = ref<HTMLElement | null>(null);
const copiedTokenId = ref<string | null>(null);
const failedAssetIcons = ref<Record<string, true>>({});
const failedIconUris = ref<Record<string, true>>({});
let copiedTokenTimer: ReturnType<typeof setTimeout> | null = null;

const wcUri = ref('');
const walletKit = ref<IWalletKit | null>(null);
const wcSessions = ref<SessionMap>({});
const pendingWcRequests = ref<PendingWcRequest[]>([]);
const pendingWcConnectionProposal = ref<PendingWcConnectionProposal | null>(null);
const isHandlingWcConnectionProposal = ref(false);
const isHandlingWcApproval = ref(false);

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

function isTokenCategoryHidden(category?: string): boolean {
  return !!category && hiddenTokenCategories.value[category] === true;
}

function isTokenCategoryFavorite(category?: string): boolean {
  return !!category && favoriteTokenCategories.value[category] === true;
}

function sortTokensForDisplay(list: TokenSummary[]): TokenSummary[] {
  return [...list].sort((left, right) => {
    const leftFavorite = isTokenCategoryFavorite(left.category);
    const rightFavorite = isTokenCategoryFavorite(right.category);
    if (leftFavorite !== rightFavorite) {
      return leftFavorite ? -1 : 1;
    }
    return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
  });
}

function toTokenAssetItem(token: TokenSummary): AssetItem {
  return {
    key: `asset-token-${token.category}`,
    kind: 'token',
    displayName: token.displayName,
    symbol: token.symbol,
    iconUri: token.iconUri,
    usdValueText: '--',
    cauldronPriceText: 'Cauldron --',
    amountText: formatTokenAmount(token.fungibleAmount, token.decimals),
    canSend: token.fungibleAmount > 0n,
    nftCount: token.nftCount,
    category: token.category,
    decimals: token.decimals,
    fungibleAmount: token.fungibleAmount,
  };
}

const visibleTokenList = computed(() => sortTokensForDisplay(tokenList.value.filter((token) => !isTokenCategoryHidden(token.category))));
const hiddenTokenList = computed(() => sortTokensForDisplay(tokenList.value.filter((token) => isTokenCategoryHidden(token.category))));
const hiddenTokenCount = computed(() => hiddenTokenList.value.length);
const hiddenAssetItems = computed<AssetItem[]>(() => hiddenTokenList.value.map((token) => toTokenAssetItem(token)));
const sendableTokens = computed(() => visibleTokenList.value.filter((token) => token.fungibleAmount > 0n));
const selectedSendToken = computed(() => sendableTokens.value.find((token) => token.category === sendTokenCategory.value) ?? null);
const selectedReceiveAddress = computed(() => (receiveAddressType.value === 'token' ? tokenWalletAddress.value : walletAddress.value));
const sendTokenOptions = computed<SelectOption[]>(() =>
  sendableTokens.value.map((token) => ({
    value: token.category,
    label: `${token.displayName}${token.symbol ? ` (${token.symbol})` : ''} - ${formatTokenAmount(token.fungibleAmount, token.decimals)}`,
  })),
);
const assetItems = computed<AssetItem[]>(() => {
  if (!activeWallet.value) return [];

  const bchAsset: AssetItem = {
    key: 'asset-bch',
    kind: 'bch',
    displayName: 'Bitcoin Cash',
    symbol: 'BCH',
    usdValueText: formatUsdCompact(usdBalance.value),
    cauldronPriceText: `Cauldron ${formatUsdCompact(bchUsdRate.value)}`,
    amountText: `${formatBchFromSats(bchBalance.value)} BCH`,
    canSend: bchBalance.value > 0n,
  };

  const tokenAssets = visibleTokenList.value.map((token) => toTokenAssetItem(token));

  return [bchAsset, ...tokenAssets];
});
const previewAssets = computed(() => assetItems.value.slice(0, 4));
const currentWalletButtonLabel = computed(() => activeWalletName.value || 'Select Wallet');
const pendingWcApproval = computed(() => pendingWcRequests.value[0] ?? null);
const hasPendingWcConnectionProposal = computed(() => pendingWcConnectionProposal.value !== null);
const hasActiveWcSessions = computed(() => Object.keys(wcSessions.value).length > 0);
const wcSessionEntries = computed(() => Object.entries(wcSessions.value));
const wcSessionCount = computed(() => wcSessionEntries.value.length);
const activeSendAssetLabel = computed(() => {
  if (sendMode.value === 'bch') return 'Bitcoin Cash (BCH)';
  const token = selectedSendToken.value;
  if (!token) return 'CashToken';
  return `${token.displayName}${token.symbol ? ` (${token.symbol})` : ''}`;
});
const selectedTokenSendHistory = computed<TokenSendHistoryRow[]>(() => {
  const category = sendTokenCategory.value;
  if (!category) return [];

  return tokenSendHistory.value
    .map((item) => {
      const tokenChange = item.tokenAmountChanges.find((change) => change.category === category);
      if (!tokenChange || tokenChange.amount === 0n) return null;
      return {
        hash: item.hash,
        timestamp: item.timestamp,
        blockHeight: item.blockHeight,
        amount: tokenChange.amount,
        direction: tokenChange.amount < 0n ? 'sent' : 'received',
      };
    })
    .filter((item): item is TokenSendHistoryRow => item !== null)
    .slice(0, 10);
});
const selectedBchSendHistory = computed<BchSendHistoryRow[]>(() => tokenSendHistory.value
  .map((item) => {
    const rawValueChange = Math.trunc(item.valueChange ?? 0);
    if (!Number.isFinite(rawValueChange) || rawValueChange === 0) return null;
    const amountSats = BigInt(Math.abs(rawValueChange));
    return {
      hash: item.hash,
      timestamp: item.timestamp,
      blockHeight: item.blockHeight,
      amountSats,
      direction: rawValueChange < 0 ? 'sent' : 'received',
    };
  })
  .filter((item): item is BchSendHistoryRow => item !== null)
  .slice(0, 10));

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

function openWalletListModal() {
  activeOverlayScreen.value = 'wallet-list';
}

function closeWalletListModal() {
  if (activeOverlayScreen.value === 'wallet-list') {
    activeOverlayScreen.value = 'none';
  }
}

function openTokenListModal() {
  activeOverlayScreen.value = 'token-list';
  if (tokenList.value.length > 0) {
    void hydrateTokenNames(tokenList.value);
  }
}

function closeTokenListModal() {
  if (activeOverlayScreen.value === 'token-list') {
    activeOverlayScreen.value = 'none';
    showHiddenTokensInModal.value = false;
  }
}

function openWalletConnectModal() {
  activeOverlayScreen.value = 'wallet-connect';
}

function closeWalletConnectModal() {
  if (activeOverlayScreen.value === 'wallet-connect') {
    activeOverlayScreen.value = 'none';
  }
}

function openSendAssetModalForBch() {
  sendMode.value = 'bch';
  sendTokenCategory.value = '';
  sendToAddress.value = '';
  sendBchAmount.value = '';
  sendTokenAmount.value = '';
  tokenSendHistoryError.value = '';
  activeOverlayScreen.value = 'send-asset';
  void loadTokenSendHistory();
}

function openSendAssetModalForToken(category: string) {
  sendMode.value = 'token';
  sendTokenCategory.value = category;
  sendToAddress.value = '';
  sendBchAmount.value = '';
  sendTokenAmount.value = '';
  tokenSendHistoryError.value = '';
  activeOverlayScreen.value = 'send-asset';
  void loadTokenSendHistory();
}

function openSendAssetModal(asset: AssetItem) {
  if (asset.kind === 'bch') {
    openSendAssetModalForBch();
    return;
  }
  if (!asset.category) return;
  openSendAssetModalForToken(asset.category);
}

function closeSendAssetModal() {
  if (activeOverlayScreen.value === 'send-asset') {
    activeOverlayScreen.value = 'none';
  }
}

function updateViewportState() {
  isMobileView.value = window.innerWidth < 860;
  if (!isMobileView.value) {
    sendCollapsed.value = false;
    walletConnectCollapsed.value = false;
    tokenListCollapsed.value = false;
  } else {
    walletManagerCollapsed.value = true;
  }
}

async function setMobileActivePanel(panel: MobilePanel) {
  mobileActivePanel.value = panel;
  let targetEl: HTMLElement | null = activeWalletSectionEl.value;
  if (panel === 'tokens') {
    tokenListCollapsed.value = false;
    targetEl = tokensSectionEl.value;
  }
  if (panel === 'walletconnect') {
    walletConnectCollapsed.value = false;
    targetEl = walletConnectSectionEl.value;
  }
  if (panel === 'manager') {
    walletManagerCollapsed.value = false;
    targetEl = walletManagerSectionEl.value;
  }

  await nextTick();
  targetEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleWalletManagerCollapsed() {
  walletManagerCollapsed.value = !walletManagerCollapsed.value;
  if (!walletManagerCollapsed.value) {
    mobileActivePanel.value = 'manager';
  }
}

function toggleMobileCompactMode() {
  mobileCompactMode.value = !mobileCompactMode.value;
}

function mobilePanelLabel(panel: MobilePanel) {
  if (panel === 'tokens') return 'Tokens';
  if (panel === 'manager') return 'Wallet Manager';
  if (panel === 'walletconnect') return 'WalletConnect';
  return 'Active Wallet';
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

function formatHistoryTxHash(hash: string): string {
  if (!hash) return '';
  if (hash.length <= 22) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function formatHistoryTimestamp(timestamp?: number, blockHeight?: number): string {
  if (!timestamp) {
    return typeof blockHeight === 'number' && blockHeight <= 0 ? 'Pending confirmation' : 'Confirmed';
  }

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return typeof blockHeight === 'number' && blockHeight <= 0 ? 'Pending confirmation' : 'Confirmed';
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function openTokenHistoryTransaction(hash: string) {
  if (!hash) return;
  const url = `https://blockchair.com/bitcoin-cash/transaction/${hash}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function loadTokenSendHistory() {
  if (!activeWallet.value) {
    tokenSendHistory.value = [];
    tokenSendHistoryError.value = '';
    isLoadingTokenSendHistory.value = false;
    return;
  }

  if (sendMode.value === 'token' && !sendTokenCategory.value) {
    tokenSendHistory.value = [];
    tokenSendHistoryError.value = '';
    isLoadingTokenSendHistory.value = false;
    return;
  }

  isLoadingTokenSendHistory.value = true;
  tokenSendHistoryError.value = '';
  try {
    const history = await activeWallet.value.getHistory({ unit: UnitEnum.SAT, count: 80 });
    tokenSendHistory.value = (history ?? []) as TokenHistoryItem[];
  } catch (error) {
    tokenSendHistory.value = [];
    tokenSendHistoryError.value = error instanceof Error ? error.message : 'Unable to load token transaction history';
  } finally {
    isLoadingTokenSendHistory.value = false;
  }
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
    closeSendAssetModal();
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
    closeSendAssetModal();
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

function loadPersistedClientCaches() {
  try {
    const rawTokenCache = localStorage.getItem(TOKEN_NAME_CACHE_STORAGE_KEY);
    if (rawTokenCache) {
      const parsed = JSON.parse(rawTokenCache) as Record<string, TokenMetadata>;
      if (parsed && typeof parsed === 'object') {
        tokenNameCache.value = parsed;
      }
    }
  } catch {
    tokenNameCache.value = {};
  }

  try {
    const rawUsdRateCache = localStorage.getItem(USD_RATE_CACHE_STORAGE_KEY);
    if (rawUsdRateCache) {
      const parsed = JSON.parse(rawUsdRateCache) as UsdRateCache;
      if (typeof parsed?.rate === 'number' && typeof parsed?.updatedAt === 'number') {
        usdRateCache.value = parsed;
      }
    }
  } catch {
    usdRateCache.value = null;
  }

  try {
    const rawHiddenCategories = localStorage.getItem(HIDDEN_TOKEN_CATEGORIES_STORAGE_KEY);
    if (rawHiddenCategories) {
      const parsed = JSON.parse(rawHiddenCategories) as string[];
      if (Array.isArray(parsed)) {
        hiddenTokenCategories.value = Object.fromEntries(parsed.filter((value) => typeof value === 'string').map((value) => [value, true]));
      }
    }
  } catch {
    hiddenTokenCategories.value = {};
  }

  try {
    const rawFavoriteCategories = localStorage.getItem(FAVORITE_TOKEN_CATEGORIES_STORAGE_KEY);
    if (rawFavoriteCategories) {
      const parsed = JSON.parse(rawFavoriteCategories) as string[];
      if (Array.isArray(parsed)) {
        favoriteTokenCategories.value = Object.fromEntries(parsed.filter((value) => typeof value === 'string').map((value) => [value, true]));
      }
    }
  } catch {
    favoriteTokenCategories.value = {};
  }
}

function persistTokenNameCache() {
  const entries = Object.entries(tokenNameCache.value);
  const boundedEntries = entries.slice(-MAX_TOKEN_NAME_CACHE_ENTRIES);
  tokenNameCache.value = Object.fromEntries(boundedEntries);
  localStorage.setItem(TOKEN_NAME_CACHE_STORAGE_KEY, JSON.stringify(tokenNameCache.value));
}

function persistUsdRateCache() {
  if (!usdRateCache.value) return;
  localStorage.setItem(USD_RATE_CACHE_STORAGE_KEY, JSON.stringify(usdRateCache.value));
}

async function getBchUsdRateWithCache() {
  const now = Date.now();
  const ttl = isMobileView.value ? USD_RATE_CACHE_TTL_MOBILE_MS : USD_RATE_CACHE_TTL_DESKTOP_MS;
  if (usdRateCache.value && now - usdRateCache.value.updatedAt < ttl) {
    return usdRateCache.value.rate;
  }

  const nextRate = await convert(1, 'bch', 'usd');
  usdRateCache.value = { rate: nextRate, updatedAt: now };
  persistUsdRateCache();
  return nextRate;
}

function truncateTokenId(category: string): string {
  if (category.length <= 12) return category;
  return `${category.slice(0, 4)}...${category.slice(-4)}`;
}

function formatAddressSingleLine(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 40) return trimmed;
  return `${trimmed.slice(0, 24)}....${trimmed.slice(-8)}`;
}

function persistTokenPreferences() {
  const hiddenCategories = Object.keys(hiddenTokenCategories.value);
  const favoriteCategories = Object.keys(favoriteTokenCategories.value);
  localStorage.setItem(HIDDEN_TOKEN_CATEGORIES_STORAGE_KEY, JSON.stringify(hiddenCategories));
  localStorage.setItem(FAVORITE_TOKEN_CATEGORIES_STORAGE_KEY, JSON.stringify(favoriteCategories));
}

function toggleFavoriteToken(category: string) {
  if (!category) return;
  if (favoriteTokenCategories.value[category]) {
    const { [category]: _removed, ...rest } = favoriteTokenCategories.value;
    favoriteTokenCategories.value = rest;
    status.value = 'Token removed from favorites';
  } else {
    favoriteTokenCategories.value = {
      ...favoriteTokenCategories.value,
      [category]: true,
    };
    status.value = 'Token added to favorites';
  }
  persistTokenPreferences();
}

function hideToken(category: string) {
  if (!category || hiddenTokenCategories.value[category]) return;
  hiddenTokenCategories.value = {
    ...hiddenTokenCategories.value,
    [category]: true,
  };
  persistTokenPreferences();
  if (sendTokenCategory.value === category) {
    sendTokenCategory.value = sendableTokens.value[0]?.category ?? '';
  }
  status.value = 'Token hidden from your default list';
}

function unhideToken(category: string) {
  if (!category || !hiddenTokenCategories.value[category]) return;
  const { [category]: _removed, ...rest } = hiddenTokenCategories.value;
  hiddenTokenCategories.value = rest;
  persistTokenPreferences();
  status.value = 'Token restored to your list';
}

function toggleShowHiddenTokensInModal() {
  showHiddenTokensInModal.value = !showHiddenTokensInModal.value;
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

function resolveMetadataIconUri(candidate?: string): string | undefined {
  if (!candidate) return undefined;
  const value = candidate.trim();
  if (!value) return undefined;
  if (value.startsWith('//')) {
    return `https:${value}`;
  }
  if (value.startsWith('ipfs://')) {
    return `${IPFS_GATEWAY}${value.slice('ipfs://'.length)}`;
  }
  if (value.startsWith('/ipfs/')) {
    return `${IPFS_GATEWAY}${value.slice('/ipfs/'.length)}`;
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return undefined;
}

function isAssetIconVisible(asset: AssetItem): boolean {
  if (!asset.iconUri) return false;
  if (failedIconUris.value[asset.iconUri]) return false;
  return failedAssetIcons.value[asset.key] !== true;
}

function onAssetIconError(assetKey: string, assetIconUri?: string) {
  failedAssetIcons.value = {
    ...failedAssetIcons.value,
    [assetKey]: true,
  };
  if (assetIconUri) {
    failedIconUris.value = {
      ...failedIconUris.value,
      [assetIconUri]: true,
    };
  }
}

async function fetchTokenName(category: string): Promise<TokenMetadata> {
  const cached = tokenNameCache.value[category];
  if (cached) return cached;

  const fallback = { name: fallbackTokenName(category), decimals: 0 };
  try {
    const res = await fetch(`https://bcmr.paytaca.com/api/tokens/${category}/`);
    if (!res.ok) return fallback;

    const data = (await res.json()) as {
      error?: string;
      name?: string;
      uris?: Record<string, string | undefined>;
      identity?: { uris?: Record<string, string | undefined> };
      token?: { symbol?: string; decimals?: number };
    };
    if (data.error) return fallback;

    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallback.name;
    const symbol = typeof data.token?.symbol === 'string' && data.token.symbol.trim() ? data.token.symbol.trim() : '';
    const decimals = typeof data.token?.decimals === 'number' && data.token.decimals >= 0
      ? Math.floor(data.token.decimals)
      : 0;
    const rawIconUri = data.uris?.image
      ?? data.uris?.icon
      ?? data.identity?.uris?.image
      ?? data.identity?.uris?.icon;
    const iconUri = resolveMetadataIconUri(rawIconUri);
    const result = symbol
      ? { name, symbol, decimals, ...(iconUri ? { iconUri } : {}) }
      : { name, decimals, ...(iconUri ? { iconUri } : {}) };
    tokenNameCache.value[category] = result;
    return result;
  } catch {
    return fallback;
  }
}

function hasMissingTokenMetadata(list: TokenSummary[]) {
  return list.some((token) => !tokenNameCache.value[token.category]);
}

async function hydrateTokenNames(list: TokenSummary[]) {
  const missingCategories = list
    .map((token) => token.category)
    .filter((category) => !tokenNameCache.value[category]);

  if (missingCategories.length > 0) {
    await Promise.all(missingCategories.map((category) => fetchTokenName(category)));
    persistTokenNameCache();
  }

  tokenList.value = list.map((token) => {
    const nextName = tokenNameCache.value[token.category];
    const nextSymbol = nextName?.symbol;
    const nextIconUri = nextName?.iconUri;
    return nextSymbol
      ? { ...token, displayName: nextName.name, symbol: nextSymbol, iconUri: nextIconUri, decimals: nextName.decimals }
      : {
        ...token,
        displayName: nextName?.name ?? token.displayName,
        iconUri: nextIconUri,
        decimals: nextName?.decimals ?? token.decimals,
      };
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

function formatUsdCompact(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--';
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
  closeWalletListModal();
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

async function onDerivationUpdateTypeChangeAndApply(value: string) {
  onDerivationUpdateTypeChange(value);
  if (derivationUpdateType.value === 'custom' || isUpdatingDerivation.value) {
    return;
  }
  await updateActiveWalletDerivationPath();
}

async function applyCustomDerivationIfValid() {
  if (derivationUpdateType.value !== 'custom' || isUpdatingDerivation.value) {
    return;
  }
  if (!customDerivationPathUpdate.value.trim()) {
    return;
  }
  await updateActiveWalletDerivationPath();
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
  showActiveDerivationEditor.value = false;
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
  activeOverlayScreen.value = 'manage-wallet';
  void loadManageWalletDetails(walletName);
}

function closeWalletActionSheet() {
  actionSheetWalletName.value = null;
  manageWalletDetails.value = null;
  loadingManageWalletDetails.value = false;
  manageModalMode.value = 'overview';
  if (activeOverlayScreen.value === 'manage-wallet') {
    activeOverlayScreen.value = 'none';
  }
}

function openCreateImportModal() {
  activeOverlayScreen.value = 'create-import';
}

function closeCreateImportModal() {
  if (activeOverlayScreen.value === 'create-import') {
    activeOverlayScreen.value = 'none';
  }
}

function openAboutModal() {
  activeOverlayScreen.value = 'about';
}

function closeAboutModal() {
  if (activeOverlayScreen.value === 'about') {
    activeOverlayScreen.value = 'none';
  }
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
  activeOverlayScreen.value = 'receive';
  await renderReceiveQr();
}

function closeReceiveModal() {
  if (activeOverlayScreen.value === 'receive') {
    activeOverlayScreen.value = 'none';
  }
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

function toggleActiveWalletDerivationEditor() {
  if (!activeWalletName.value || !activeWallet.value) {
    status.value = 'No active wallet selected';
    return;
  }

  if (!showActiveDerivationEditor.value) {
    syncDerivationEditorFromActiveWallet();
  }

  showActiveDerivationEditor.value = !showActiveDerivationEditor.value;
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
  actionSheetWalletName.value = walletName;
  activeOverlayScreen.value = 'manage-wallet';
  managerMode.value = action;
  showSeedPhrase.value = action === 'backup';
  manageModalMode.value = action === 'backup' ? 'backup' : 'derivation';
  void loadManageWalletDetails(walletName);
  if (action === 'derivation') {
    syncDerivationEditorFromActiveWallet();
  }
}

function enqueueWcApproval(event: WalletKitTypes.SessionRequest) {
  const topic = event.topic;
  const sessions = walletKit.value?.getActiveSessions();
  const peerName = sessions?.[topic]?.peer?.metadata?.name ?? 'Unknown dApp';
  pendingWcRequests.value.push({
    topic,
    id: event.id,
    method: event.params.request.method,
    peerName,
    event,
  });
}

async function executeWalletConnectRequest(event: WalletKitTypes.SessionRequest) {
  if (!walletKit.value || !activeWallet.value) return;
  const { topic, id, params } = event;
  const method = params.request.method;

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
}

async function approvePendingWcRequest() {
  if (!walletKit.value || !pendingWcApproval.value || isHandlingWcApproval.value) return;
  isHandlingWcApproval.value = true;
  const current = pendingWcApproval.value;
  try {
    await executeWalletConnectRequest(current.event);
    pendingWcRequests.value = pendingWcRequests.value.filter((req) => !(req.topic === current.topic && req.id === current.id));
    status.value = `Approved WalletConnect request: ${current.method}`;
  } catch (error) {
    await walletKit.value.respondSessionRequest({
      topic: current.topic,
      response: {
        id: current.id,
        jsonrpc: '2.0',
        error: { code: 7, message: error instanceof Error ? error.message : 'Request failed' },
      },
    });
    pendingWcRequests.value = pendingWcRequests.value.filter((req) => !(req.topic === current.topic && req.id === current.id));
    status.value = `WalletConnect error on ${current.method}`;
  } finally {
    isHandlingWcApproval.value = false;
  }
}

async function rejectPendingWcRequest() {
  if (!walletKit.value || !pendingWcApproval.value || isHandlingWcApproval.value) return;
  isHandlingWcApproval.value = true;
  const current = pendingWcApproval.value;
  try {
    await walletKit.value.respondSessionRequest({
      topic: current.topic,
      response: {
        id: current.id,
        jsonrpc: '2.0',
        error: { code: 4001, message: 'User rejected the request' },
      },
    });
    pendingWcRequests.value = pendingWcRequests.value.filter((req) => !(req.topic === current.topic && req.id === current.id));
    status.value = `Rejected WalletConnect request: ${current.method}`;
  } finally {
    isHandlingWcApproval.value = false;
  }
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
    showActiveDerivationEditor.value = false;
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
    const oneBchInUsd = await getBchUsdRateWithCache();
    bchUsdRate.value = oneBchInUsd;
    const balanceBch = Number(bchBalance.value) / 100_000_000;
    usdBalance.value = balanceBch * oneBchInUsd;
  } catch {
    bchUsdRate.value = null;
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
  failedAssetIcons.value = {};
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

  const method = event.params.request.method;
  const requiresApproval = method === 'bch_signTransaction' || method === 'bch_signMessage' || method === 'personal_sign';

  if (requiresApproval) {
    enqueueWcApproval(event);
    status.value = `Approval required: ${method}`;
    return;
  }

  try {
    await executeWalletConnectRequest(event);
    status.value = `Handled WalletConnect request: ${method}`;
  } catch (error) {
    const { topic, id } = event;
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

function getWalletConnectNamespaces() {
  if (!activeWallet.value || !walletAddress.value) {
    throw new Error('No active wallet selected.');
  }
  const chain = activeWallet.value.network === NetworkType.Mainnet ? 'bch:bitcoincash' : 'bch:bchtest';
  return {
    bch: {
      methods: ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage', 'bch_cancelPendingRequests'],
      chains: [chain],
      events: ['addressesChanged'],
      accounts: [`bch:${walletAddress.value}`],
    },
  };
}

async function approvePendingWcConnectionProposal() {
  if (!walletKit.value || !pendingWcConnectionProposal.value || isHandlingWcConnectionProposal.value) return;
  isHandlingWcConnectionProposal.value = true;
  const proposal = pendingWcConnectionProposal.value;
  try {
    const namespaces = getWalletConnectNamespaces();
    await walletKit.value.approveSession({ id: proposal.id, namespaces });
    pendingWcConnectionProposal.value = null;
    refreshSessionMap();
    status.value = `WalletConnect approved for ${proposal.appName}`;
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Failed to approve WalletConnect connection';
  } finally {
    isHandlingWcConnectionProposal.value = false;
  }
}

async function rejectPendingWcConnectionProposal() {
  if (!walletKit.value || !pendingWcConnectionProposal.value || isHandlingWcConnectionProposal.value) return;
  isHandlingWcConnectionProposal.value = true;
  const proposal = pendingWcConnectionProposal.value;
  try {
    await walletKit.value.rejectSession({
      id: proposal.id,
      reason: { code: 5000, message: 'User rejected connection.' },
    });
    pendingWcConnectionProposal.value = null;
    status.value = `WalletConnect connection rejected for ${proposal.appName}`;
  } finally {
    isHandlingWcConnectionProposal.value = false;
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
    const metadata = session.peer?.metadata;
    result[topic] = {
      peerName: metadata?.name || 'Unknown dApp',
      peerUrl: metadata?.url,
      peerIcon: metadata?.icons?.[0],
      accounts: session.namespaces.bch?.accounts ?? [],
    };
  }

  wcSessions.value = result;
}

function getDisplayHost(url?: string): string {
  if (!url) return 'Unknown origin';
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

async function syncSessionAddresses() {
  if (!walletKit.value || !walletAddress.value) return;
  const sessions = walletKit.value.getActiveSessions();
  const chain = activeWallet.value?.network === NetworkType.Mainnet ? 'bch:bitcoincash' : 'bch:bchtest';
  const account = `bch:${walletAddress.value}`;

  for (const [topic, session] of Object.entries(sessions)) {
    const namespaces = {
      ...session.namespaces,
      bch: {
        methods: ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage', 'bch_cancelPendingRequests'],
        events: ['addressesChanged'],
        chains: [chain],
        accounts: [account],
      },
    };

    await walletKit.value.updateSession({ topic, namespaces });

    // Tell connected dApps to refresh their displayed account after a wallet switch.
    await walletKit.value.emitSessionEvent({
      topic,
      chainId: chain,
      event: {
        name: 'addressesChanged',
        data: [account],
      },
    });
  }

  refreshSessionMap();
}

async function initWalletConnect() {
  if (walletKit.value) return;

  if (walletConnectRuntime.__purzeWalletConnectInitPromise) {
    walletKit.value = await walletConnectRuntime.__purzeWalletConnectInitPromise;
    refreshSessionMap();
    return;
  }

  walletConnectRuntime.__purzeWalletConnectInitPromise = (async () => {
    const [{ Core }, walletKitModule] = await Promise.all([
      import('@walletconnect/core'),
      import('@reown/walletkit'),
    ]);
    const { WalletKit } = walletKitModule;
    const core = (walletConnectRuntime.__purzeWalletConnectCore as InstanceType<typeof Core> | undefined)
      ?? new Core({ projectId: WALLETCONNECT_PROJECT_ID });
    walletConnectRuntime.__purzeWalletConnectCore = core;
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
      const proposer = proposal.params.proposer.metadata;
      const appName = proposer?.name || 'Unknown dApp';
      const appUrl = proposer?.url || 'Unknown origin';
      const appIcon = proposer?.icons?.[0];

      if (!activeWallet.value || !walletAddress.value) {
        await instance.rejectSession({
          id: proposal.id,
          reason: { code: 5000, message: 'No active wallet selected.' },
        });
        status.value = `WalletConnect rejected for ${appName}: no active wallet selected`;
        return;
      }

      if (pendingWcConnectionProposal.value) {
        await instance.rejectSession({
          id: proposal.id,
          reason: { code: 5000, message: 'Another connection approval is pending.' },
        });
        status.value = `WalletConnect queued request from ${appName} was rejected: approval already pending`;
        return;
      }

      pendingWcConnectionProposal.value = {
        id: proposal.id,
        appName,
        appUrl,
        appIcon,
      };
      activeOverlayScreen.value = 'wallet-connect';
      status.value = `Connection approval required for ${appName}`;
    });

    instance.on('session_request', (event) => {
      void handleSessionRequest(event);
    });

    instance.on('session_delete', () => {
      refreshSessionMap();
    });

    return instance;
  })();

  try {
    walletKit.value = await walletConnectRuntime.__purzeWalletConnectInitPromise;
    refreshSessionMap();
  } finally {
    walletConnectRuntime.__purzeWalletConnectInitPromise = undefined;
  }
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
  loadPersistedClientCaches();
  updateViewportState();
  window.addEventListener('resize', updateViewportState);
  loadWallets();

  try {
    await initWalletConnect();
  } catch {
    status.value = 'Failed to initialize WalletConnect';
  }

  if (activeWalletName.value) {
    try {
      await loadActiveWallet(activeWalletName.value);
      await syncSessionAddresses();
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

watch(activeOverlayScreen, (screen) => {
  const lockScroll = screen !== 'none';
  document.body.style.overflow = lockScroll ? 'hidden' : '';
  document.documentElement.style.overflow = lockScroll ? 'hidden' : '';
});

watch([activeOverlayScreen, receiveAddressType, walletAddress, tokenWalletAddress], ([screen]) => {
  if (screen !== 'receive') return;
  void renderReceiveQr();
});

watch([activeOverlayScreen, sendMode, sendTokenCategory, activeWalletName], ([screen, mode]) => {
  if (screen !== 'send-asset') return;
  if (mode === 'token' && !sendTokenCategory.value) return;
  void loadTokenSendHistory();
});

watch([tokenListCollapsed, isMobileView, tokenList], ([collapsed, isMobile, list]) => {
  if (list.length === 0) return;
  const shouldHydrateNow = !isMobile || !collapsed;
  if (!shouldHydrateNow || !hasMissingTokenMetadata(list)) return;
  void hydrateTokenNames(list);
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
    <div class="topbar-simple">
      <div class="top-wallet-group" role="group" aria-label="Wallet actions">
        <button class="top-receive-btn" @click="openReceiveModal" title="Receive BCH" aria-label="Receive BCH">
          <FontAwesomeIcon :icon="['fas', 'wallet']" class="top-connect-icon" />
        </button>
        <button class="top-wallet-btn" @click="openWalletListModal" title="Select Wallet" aria-label="Select Wallet">
          <span class="top-wallet-text">
            <span class="top-wallet-caption">Select Wallet</span>
            <span class="top-wallet-current">{{ currentWalletButtonLabel }}</span>
          </span>
        </button>
      </div>
      <div class="top-quick-actions">
        <button class="top-connect-btn top-refresh-btn" @click="refreshBalancesAndTokens" title="Refresh balances" aria-label="Refresh balances">
          <FontAwesomeIcon :icon="['fas', 'rotate']" class="top-connect-icon" />
        </button>
        <button
          class="top-connect-btn"
          :class="{ 'wc-connected': hasActiveWcSessions }"
          @click="openWalletConnectModal"
          :title="hasActiveWcSessions ? 'WalletConnect connected' : 'WalletConnect'"
          :aria-label="hasActiveWcSessions ? 'WalletConnect connected' : 'WalletConnect'"
        >
          <FontAwesomeIcon :icon="['fas', 'link']" class="top-connect-icon" />
          <span v-if="hasActiveWcSessions" class="wc-connected-dot" aria-hidden="true"></span>
          <span v-if="pendingWcRequests.length > 0" class="wc-pending-badge">{{ pendingWcRequests.length }}</span>
        </button>
      </div>
    </div>

    <div class="home-stack">
      <section class="glass-card active-wallet-card" :class="{ 'dropdown-open': showActiveDerivationEditor }">
        <div v-if="activeWallet" class="meta">
          <div class="address-grid">
            <article class="address-card address-card-bch">
              <div class="address-head">
                <div class="address-title-wrap">
                  <span class="address-icon-wrap"><FontAwesomeIcon :icon="['fas', 'wallet']" /></span>
                  <div class="address-title-stack">
                    <strong class="address-title">BCH Wallet Address</strong>
                    <span class="address-subtitle">Primary send and receive</span>
                  </div>
                </div>
                <div class="address-head-actions">
                  <button class="tiny-btn inline-copy-btn address-copy-btn" @click="copyText(walletAddress, 'BCH address')" title="Copy BCH address" aria-label="Copy BCH address">
                    <FontAwesomeIcon :icon="['fas', 'copy']" class="inline-copy-icon" />
                  </button>
                </div>
              </div>
              <div class="mono address-value" :title="walletAddress">{{ formatAddressSingleLine(walletAddress) }}</div>
            </article>

            <article class="address-card address-card-token">
              <div class="address-head">
                <div class="address-title-wrap">
                  <span class="address-icon-wrap"><FontAwesomeIcon :icon="['fas', 'coins']" /></span>
                  <div class="address-title-stack">
                    <strong class="address-title">CashToken Wallet Address</strong>
                    <span class="address-subtitle">Token receive address</span>
                  </div>
                </div>
                <button class="tiny-btn inline-copy-btn address-copy-btn" @click="copyText(tokenWalletAddress, 'CashToken address')" title="Copy CashToken address" aria-label="Copy CashToken address">
                  <FontAwesomeIcon :icon="['fas', 'copy']" class="inline-copy-icon" />
                </button>
              </div>
              <div class="mono address-value" :title="tokenWalletAddress">{{ formatAddressSingleLine(tokenWalletAddress) }}</div>
            </article>
          </div>

          <div class="active-derivation-row">
            <div><strong>Derivation:</strong> {{ activeDerivationPath }}</div>
            <button class="tiny-btn active-derivation-btn" @click="toggleActiveWalletDerivationEditor" :disabled="!activeSeedPhrase">
              <FontAwesomeIcon :icon="['fas', showActiveDerivationEditor ? 'xmark' : 'rotate']" class="icon-btn" />{{ showActiveDerivationEditor ? 'Close' : 'Change' }}
            </button>
          </div>
          <div class="active-derivation-editor" v-if="showActiveDerivationEditor">
            <div class="row">
              <label for="active-derivation-select">New Derivation Path</label>
              <UiSelect
                id="active-derivation-select"
                :model-value="derivationUpdateType"
                :options="derivationOptions"
                @update:modelValue="onDerivationUpdateTypeChangeAndApply"
              />
            </div>
            <div class="row" v-if="derivationUpdateType === 'custom'">
              <label for="active-custom-derivation-input">Custom Path</label>
              <input
                id="active-custom-derivation-input"
                v-model="customDerivationPathUpdate"
                placeholder="m/44'/145'/0' or m/44'/145'/0'/0/0"
                @change="applyCustomDerivationIfValid"
                @keydown.enter.prevent="applyCustomDerivationIfValid"
              />
            </div>
            <p class="hint" v-if="derivationUpdateType === 'custom'">Press Enter after typing a custom path to apply and reload.</p>
            <p class="hint" v-if="isUpdatingDerivation">Updating derivation and reloading wallet...</p>
          </div>
        </div>
        <div v-else class="hint">Create or import a wallet to get started.</div>
      </section>

      <section class="glass-card tokens-preview-card">
        <div class="tokens-preview-head">
          <h3><FontAwesomeIcon :icon="['fas', 'coins']" class="icon-title" />Tokens</h3>
          <span class="tokens-preview-usd">{{ formatUsd(usdBalance) }}</span>
          <button class="tiny-btn" @click="openTokenListModal" :disabled="assetItems.length === 0">View all</button>
        </div>
        <div v-if="assetItems.length === 0" class="hint">No assets found.</div>
        <div class="token-cards" v-else>
          <article class="token-card" v-for="asset in previewAssets" :key="`preview-${asset.key}`">
            <button
              v-if="asset.kind === 'token' && asset.category"
              class="token-icon-slot token-icon-btn"
              :class="{ copied: copiedTokenId === asset.category }"
              @click="copyTokenId(asset.category)"
              :aria-label="`Copy token id for ${asset.displayName}`"
              :title="`Copy token id: ${asset.displayName}`"
            >
              <img
                v-if="isAssetIconVisible(asset)"
                class="token-icon-image"
                :src="asset.iconUri"
                :alt="`${asset.displayName} icon`"
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                @error="onAssetIconError(asset.key, asset.iconUri)"
              />
              <FontAwesomeIcon v-else :icon="['fas', 'coins']" />
            </button>
            <div v-else class="token-icon-slot" aria-hidden="true">
              <img
                v-if="isAssetIconVisible(asset)"
                class="token-icon-image"
                :src="asset.iconUri"
                :alt="`${asset.displayName} icon`"
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                @error="onAssetIconError(asset.key, asset.iconUri)"
              />
              <FontAwesomeIcon v-else :icon="['fas', 'coins']" />
            </div>
            <div class="token-info-grid">
              <div class="token-main-line">
                <div class="token-card-title">
                  <span v-if="asset.kind === 'token' && asset.category && isTokenCategoryFavorite(asset.category)" class="token-favorite-badge" title="Favorite token" aria-label="Favorite token">
                    <FontAwesomeIcon :icon="['fas', 'star']" />
                  </span>
                  {{ asset.displayName }}<span v-if="asset.symbol"> ({{ asset.symbol }})</span>
                </div>
                <strong class="token-usd-value">{{ asset.usdValueText }}</strong>
              </div>
              <div class="token-sub-line">
                <span class="token-price-source">{{ asset.cauldronPriceText }}</span>
                <span class="token-amount-main">{{ asset.amountText }}</span>
              </div>
            </div>
            <div class="token-actions-line">
              <button
                class="tiny-btn token-send-btn"
                @click="openSendAssetModal(asset)"
                :disabled="!asset.canSend"
                :aria-label="`Send ${asset.displayName}`"
                :title="`Send ${asset.displayName}`"
              >
                <FontAwesomeIcon :icon="['fas', 'paper-plane']" class="icon-btn" />
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div v-if="activeOverlayScreen === 'wallet-list'" class="action-sheet-overlay" @click.self="closeWalletListModal">
      <dialog class="action-sheet wallet-list-modal" open aria-label="Wallet list">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">Wallets</strong>
            <span class="action-sheet-subtitle">Select active wallet or manage one</span>
          </div>
          <button class="icon-close" @click="closeWalletListModal" aria-label="Close wallet list">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="manage-wallet-info wallet-list-panel">
          <div v-if="wallets.length === 0" class="hint">No wallets yet.</div>
          <ul v-else class="wallet-list">
            <li
              v-for="wallet in wallets"
              :key="`modal-${wallet.name}`"
              class="wallet-item"
              @click="onActiveWalletChange(wallet.name)"
            >
              <div class="wallet-item-main">
                <div>
                  <strong>{{ wallet.name }}</strong>
                  <span v-if="wallet.name === activeWalletName" class="wallet-tag active">active</span>
                </div>
                <div class="wallet-item-actions">
                  <button class="tiny-btn wallet-row-btn" @click.stop="closeWalletListModal(); openWalletActionSheet(wallet.name)" title="Manage wallet" aria-label="Manage wallet">
                    <FontAwesomeIcon :icon="['fas', 'bars']" class="icon-btn" />
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <button class="action-sheet-btn" @click="closeWalletListModal(); openCreateImportModal()">
          <FontAwesomeIcon :icon="['fas', 'plus']" class="icon-btn" />Add / Import Wallet
        </button>
      </dialog>
    </div>

    <div v-if="activeOverlayScreen === 'token-list'" class="action-sheet-overlay" @click.self="closeTokenListModal">
      <dialog class="action-sheet token-list-modal" open aria-label="All tokens">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">All Tokens</strong>
            <span class="action-sheet-subtitle">Complete token list</span>
          </div>
          <button class="icon-close" @click="closeTokenListModal" aria-label="Close token list">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="manage-wallet-info">
          <div v-if="assetItems.length === 0" class="hint">No assets found.</div>
          <div class="token-cards" v-else>
            <article class="token-card" v-for="asset in assetItems" :key="`all-${asset.key}`">
              <button
                v-if="asset.kind === 'token' && asset.category"
                class="token-icon-slot token-icon-btn"
                :class="{ copied: copiedTokenId === asset.category }"
                @click="copyTokenId(asset.category)"
                :aria-label="`Copy token id for ${asset.displayName}`"
                :title="`Copy token id: ${asset.displayName}`"
              >
                <img
                  v-if="isAssetIconVisible(asset)"
                  class="token-icon-image"
                  :src="asset.iconUri"
                  :alt="`${asset.displayName} icon`"
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
                  @error="onAssetIconError(asset.key, asset.iconUri)"
                />
                <FontAwesomeIcon v-else :icon="['fas', 'coins']" />
              </button>
              <div v-else class="token-icon-slot" aria-hidden="true">
                <img
                  v-if="isAssetIconVisible(asset)"
                  class="token-icon-image"
                  :src="asset.iconUri"
                  :alt="`${asset.displayName} icon`"
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
                  @error="onAssetIconError(asset.key, asset.iconUri)"
                />
                <FontAwesomeIcon v-else :icon="['fas', 'coins']" />
              </div>
              <div class="token-info-grid">
                <div class="token-main-line">
                  <div class="token-card-title">
                    <span v-if="asset.kind === 'token' && asset.category && isTokenCategoryFavorite(asset.category)" class="token-favorite-badge" title="Favorite token" aria-label="Favorite token">
                      <FontAwesomeIcon :icon="['fas', 'star']" />
                    </span>
                    {{ asset.displayName }}<span v-if="asset.symbol"> ({{ asset.symbol }})</span>
                  </div>
                  <strong class="token-usd-value">{{ asset.usdValueText }}</strong>
                </div>
                <div class="token-sub-line">
                  <span class="token-price-source">{{ asset.cauldronPriceText }}</span>
                  <span class="token-amount-main">{{ asset.amountText }}</span>
                </div>
              </div>
              <div class="token-actions-line">
                <button
                  v-if="asset.kind === 'token' && asset.category"
                  class="tiny-btn token-favorite-btn"
                  :class="{ active: isTokenCategoryFavorite(asset.category) }"
                  @click="toggleFavoriteToken(asset.category)"
                  :aria-label="isTokenCategoryFavorite(asset.category) ? `Remove ${asset.displayName} from favorites` : `Add ${asset.displayName} to favorites`"
                  :title="isTokenCategoryFavorite(asset.category) ? 'Remove from favorites' : 'Add to favorites'"
                >
                  <FontAwesomeIcon :icon="['fas', 'star']" class="icon-btn" />
                </button>
                <button
                  v-if="asset.kind === 'token' && asset.category"
                  class="tiny-btn token-hide-btn"
                  @click="hideToken(asset.category)"
                  :aria-label="`Hide ${asset.displayName}`"
                  :title="`Hide ${asset.displayName}`"
                >
                  <FontAwesomeIcon :icon="['fas', 'eye-slash']" class="icon-btn" />
                </button>
                <button
                  class="tiny-btn token-send-btn"
                  @click="openSendAssetModal(asset)"
                  :disabled="!asset.canSend"
                  :aria-label="`Send ${asset.displayName}`"
                  :title="`Send ${asset.displayName}`"
                >
                  <FontAwesomeIcon :icon="['fas', 'paper-plane']" class="icon-btn" />
                </button>
              </div>
            </article>
          </div>

          <div v-if="hiddenTokenCount > 0" class="hidden-token-panel">
            <div class="hidden-token-panel-head">
              <strong><FontAwesomeIcon :icon="['fas', 'eye-slash']" class="icon-btn" />Hidden tokens ({{ hiddenTokenCount }})</strong>
              <button class="tiny-btn" @click="toggleShowHiddenTokensInModal">
                <FontAwesomeIcon :icon="['fas', showHiddenTokensInModal ? 'xmark' : 'bars']" class="icon-btn" />
                {{ showHiddenTokensInModal ? 'Hide list' : 'Show list' }}
              </button>
            </div>
            <div class="token-cards" v-if="showHiddenTokensInModal">
              <article class="token-card" v-for="asset in hiddenAssetItems" :key="`hidden-${asset.key}`">
                <button
                  v-if="asset.kind === 'token' && asset.category"
                  class="token-icon-slot token-icon-btn"
                  :class="{ copied: copiedTokenId === asset.category }"
                  @click="copyTokenId(asset.category)"
                  :aria-label="`Copy token id for ${asset.displayName}`"
                  :title="`Copy token id: ${asset.displayName}`"
                >
                  <img
                    v-if="isAssetIconVisible(asset)"
                    class="token-icon-image"
                    :src="asset.iconUri"
                    :alt="`${asset.displayName} icon`"
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    @error="onAssetIconError(asset.key, asset.iconUri)"
                  />
                  <FontAwesomeIcon v-else :icon="['fas', 'coins']" />
                </button>
                <div v-else class="token-icon-slot" aria-hidden="true">
                  <img
                    v-if="isAssetIconVisible(asset)"
                    class="token-icon-image"
                    :src="asset.iconUri"
                    :alt="`${asset.displayName} icon`"
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    @error="onAssetIconError(asset.key, asset.iconUri)"
                  />
                  <FontAwesomeIcon v-else :icon="['fas', 'coins']" />
                </div>
                <div class="token-info-grid">
                  <div class="token-main-line">
                    <div class="token-card-title">
                      <span v-if="asset.kind === 'token' && asset.category && isTokenCategoryFavorite(asset.category)" class="token-favorite-badge" title="Favorite token" aria-label="Favorite token">
                        <FontAwesomeIcon :icon="['fas', 'star']" />
                      </span>
                      {{ asset.displayName }}<span v-if="asset.symbol"> ({{ asset.symbol }})</span>
                    </div>
                    <strong class="token-usd-value">{{ asset.usdValueText }}</strong>
                  </div>
                  <div class="token-sub-line">
                    <span class="token-price-source">{{ asset.cauldronPriceText }}</span>
                    <span class="token-amount-main">{{ asset.amountText }}</span>
                  </div>
                </div>
                <div class="token-actions-line">
                  <button
                    v-if="asset.kind === 'token' && asset.category"
                    class="tiny-btn token-favorite-btn"
                    :class="{ active: isTokenCategoryFavorite(asset.category) }"
                    @click="toggleFavoriteToken(asset.category)"
                    :aria-label="isTokenCategoryFavorite(asset.category) ? `Remove ${asset.displayName} from favorites` : `Add ${asset.displayName} to favorites`"
                    :title="isTokenCategoryFavorite(asset.category) ? 'Remove from favorites' : 'Add to favorites'"
                  >
                    <FontAwesomeIcon :icon="['fas', 'star']" class="icon-btn" />
                  </button>
                  <button
                    v-if="asset.kind === 'token' && asset.category"
                    class="tiny-btn token-unhide-btn"
                    @click="unhideToken(asset.category)"
                    :aria-label="`Show ${asset.displayName} again`"
                    :title="`Show ${asset.displayName} again`"
                  >
                    <FontAwesomeIcon :icon="['fas', 'eye']" class="icon-btn" />
                  </button>
                </div>
              </article>
            </div>
          </div>
        </div>
      </dialog>
    </div>

    <div v-if="activeOverlayScreen === 'send-asset'" class="action-sheet-overlay" @click.self="closeSendAssetModal">
      <dialog class="action-sheet send-asset-modal" :class="{ 'send-asset-modal-token': sendMode === 'token' || sendMode === 'bch' }" open aria-label="Send asset">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">Send {{ activeSendAssetLabel }}</strong>
            <span class="action-sheet-subtitle">Transfer from current wallet</span>
          </div>
          <button class="icon-close" @click="closeSendAssetModal" aria-label="Close send screen">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="manage-wallet-info">
          <div class="row">
            <label for="send-modal-to-address-input">{{ sendMode === 'token' ? 'To Token Address' : 'To BCH Address' }}</label>
            <input
              id="send-modal-to-address-input"
              v-model="sendToAddress"
              :placeholder="sendMode === 'token' ? 'bitcoincash:... token address' : 'bitcoincash:... BCH address'"
            />
          </div>

          <div class="row" v-if="sendMode === 'bch'">
            <label for="send-modal-bch-amount-input">Amount (BCH)</label>
            <input id="send-modal-bch-amount-input" v-model="sendBchAmount" placeholder="0.00001" />
          </div>

          <div class="row" v-else>
            <label for="send-modal-token-amount-input">Amount{{ selectedSendToken ? ` (${selectedSendToken.decimals} decimals)` : '' }}</label>
            <input id="send-modal-token-amount-input" v-model="sendTokenAmount" :placeholder="selectedSendToken?.decimals ? '1.0' : '1'" />
          </div>

          <button @click="sendFunds" :disabled="isSendingFunds || (sendMode === 'token' && sendableTokens.length === 0)">
            <FontAwesomeIcon :icon="['fas', isSendingFunds ? 'rotate' : 'paper-plane']" class="icon-btn" />
            {{ isSendingFunds ? 'Sending...' : (sendMode === 'token' ? 'Send CashToken' : 'Send BCH') }}
          </button>

          <p class="hint" v-if="sendMode === 'token' && selectedSendToken">
            Available: {{ formatTokenAmount(selectedSendToken.fungibleAmount, selectedSendToken.decimals) }}{{ selectedSendToken.symbol ? ` ${selectedSendToken.symbol}` : '' }}
          </p>

        </div>

        <div class="manage-wallet-info send-history-card" v-if="sendMode === 'token' || sendMode === 'bch'">
            <div class="send-history-head">
              <strong><FontAwesomeIcon :icon="['fas', 'rotate']" class="icon-btn" />Recent {{ sendMode === 'token' ? 'Token' : 'BCH' }} Transactions</strong>
              <button class="tiny-btn" @click="loadTokenSendHistory" :disabled="isLoadingTokenSendHistory" aria-label="Refresh transaction history" title="Refresh transaction history">
                <FontAwesomeIcon :icon="['fas', 'rotate']" class="icon-btn" />
              </button>
            </div>
            <div class="send-history-body">
              <p class="hint" v-if="isLoadingTokenSendHistory">Loading transaction history...</p>
              <p class="hint" v-else-if="tokenSendHistoryError">{{ tokenSendHistoryError }}</p>
              <p class="hint" v-else-if="sendMode === 'token' && selectedTokenSendHistory.length === 0">No recent transactions for this token yet.</p>
              <p class="hint" v-else-if="sendMode === 'bch' && selectedBchSendHistory.length === 0">No recent BCH transactions yet.</p>
              <ul v-else-if="sendMode === 'token'" class="send-history-list">
              <li
                v-for="entry in selectedTokenSendHistory"
                :key="`send-history-${entry.hash}`"
                class="send-history-item"
              >
                <div class="send-history-item-top">
                  <span class="send-history-direction" :class="entry.direction">{{ entry.direction === 'sent' ? 'Sent' : 'Received' }}</span>
                  <div class="send-history-top-right">
                    <strong>
                      {{ formatTokenAmount(entry.amount < 0n ? -entry.amount : entry.amount, selectedSendToken?.decimals ?? 0) }}
                      <span v-if="selectedSendToken?.symbol"> {{ selectedSendToken.symbol }}</span>
                    </strong>
                    <button
                      class="tiny-btn send-history-open-btn"
                      @click.stop="openTokenHistoryTransaction(entry.hash)"
                      :aria-label="`Open transaction ${entry.hash} in block explorer`"
                      :title="`Open transaction ${entry.hash} in block explorer`"
                    >
                      <FontAwesomeIcon :icon="['fas', 'link']" />
                    </button>
                  </div>
                </div>
                <div class="send-history-item-meta">
                  <span class="mono" :title="entry.hash">{{ formatHistoryTxHash(entry.hash) }}</span>
                  <span>{{ formatHistoryTimestamp(entry.timestamp, entry.blockHeight) }}</span>
                </div>
              </li>
              </ul>
              <ul v-else class="send-history-list">
                <li
                  v-for="entry in selectedBchSendHistory"
                  :key="`send-history-bch-${entry.hash}`"
                  class="send-history-item"
                >
                  <div class="send-history-item-top">
                    <span class="send-history-direction" :class="entry.direction">{{ entry.direction === 'sent' ? 'Sent' : 'Received' }}</span>
                    <div class="send-history-top-right">
                      <strong>{{ formatBchFromSats(entry.amountSats) }} BCH</strong>
                      <button
                        class="tiny-btn send-history-open-btn"
                        @click.stop="openTokenHistoryTransaction(entry.hash)"
                        :aria-label="`Open transaction ${entry.hash} in block explorer`"
                        :title="`Open transaction ${entry.hash} in block explorer`"
                      >
                        <FontAwesomeIcon :icon="['fas', 'link']" />
                      </button>
                    </div>
                  </div>
                  <div class="send-history-item-meta">
                    <span class="mono" :title="entry.hash">{{ formatHistoryTxHash(entry.hash) }}</span>
                    <span>{{ formatHistoryTimestamp(entry.timestamp, entry.blockHeight) }}</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
      </dialog>
    </div>

    <div v-if="activeOverlayScreen === 'wallet-connect'" class="action-sheet-overlay" @click.self="closeWalletConnectModal">
      <dialog class="action-sheet wallet-connect-modal" open aria-label="WalletConnect">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title wc-modal-title"><FontAwesomeIcon :icon="['fas', 'link']" class="wc-title-icon" />WalletConnect</strong>
            <span class="action-sheet-subtitle">Securely connect to dApps and manage sessions</span>
          </div>
          <button class="icon-close" @click="closeWalletConnectModal" aria-label="Close WalletConnect screen">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="manage-wallet-info wc-overview-card">
          <div class="wc-overview-grid">
            <div class="wc-overview-item" :class="hasActiveWcSessions ? 'active' : ''">
              <span class="manage-label">Connection</span>
              <strong>
                <FontAwesomeIcon :icon="['fas', hasActiveWcSessions ? 'plug' : 'link']" class="wc-overview-icon" />
                {{ hasActiveWcSessions ? 'Connected' : 'Not connected' }}
              </strong>
            </div>
            <div class="wc-overview-item">
              <span class="manage-label">Sessions</span>
              <strong><FontAwesomeIcon :icon="['fas', 'wallet']" class="wc-overview-icon" />{{ wcSessionCount }}</strong>
            </div>
            <div class="wc-overview-item" :class="pendingWcRequests.length > 0 ? 'pending' : ''">
              <span class="manage-label">Pending</span>
              <strong><FontAwesomeIcon :icon="['fas', 'triangle-exclamation']" class="wc-overview-icon" />{{ pendingWcRequests.length }}</strong>
            </div>
          </div>
          <p class="hint wc-overview-hint">Active wallet: <strong>{{ activeWalletName || 'No wallet selected' }}</strong></p>
        </div>

        <div class="manage-wallet-info wc-connection-proposal-card" v-if="pendingWcConnectionProposal">
          <div class="wc-section-head">
            <div class="wc-section-title-wrap">
              <strong class="wc-section-title"><FontAwesomeIcon :icon="['fas', 'triangle-exclamation']" class="wc-section-icon" />Connection Request</strong>
              <span class="hint">Review this webapp before connecting your wallet</span>
            </div>
          </div>
          <div class="wc-proposal-dapp">
            <div class="wc-dapp-avatar" aria-hidden="true">
              <img v-if="pendingWcConnectionProposal.appIcon" :src="pendingWcConnectionProposal.appIcon" :alt="`${pendingWcConnectionProposal.appName} icon`" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
              <span v-else>{{ (pendingWcConnectionProposal.appName || '?').charAt(0).toUpperCase() }}</span>
            </div>
            <div class="wc-dapp-meta">
              <strong>{{ pendingWcConnectionProposal.appName }}</strong>
              <span class="hint">{{ getDisplayHost(pendingWcConnectionProposal.appUrl) }}</span>
            </div>
          </div>
          <div class="manage-field">
            <span class="manage-label">Website</span>
            <span>{{ pendingWcConnectionProposal.appUrl || 'Unknown origin' }}</span>
          </div>
          <div class="active-wallet-actions wc-approval-actions">
            <button @click="approvePendingWcConnectionProposal" :disabled="isHandlingWcConnectionProposal">
              <FontAwesomeIcon :icon="['fas', 'plug']" class="icon-btn" />
              {{ isHandlingWcConnectionProposal ? 'Approving...' : 'Approve Connection' }}
            </button>
            <button class="delete-wallet-btn" @click="rejectPendingWcConnectionProposal" :disabled="isHandlingWcConnectionProposal">
              <FontAwesomeIcon :icon="['fas', 'xmark']" class="icon-btn" />
              {{ isHandlingWcConnectionProposal ? 'Rejecting...' : 'Reject Connection' }}
            </button>
          </div>
        </div>

        <div class="manage-wallet-info wc-pending-card" v-if="pendingWcApproval">
          <div class="wc-section-head">
            <div class="wc-section-title-wrap">
              <strong class="wc-section-title"><FontAwesomeIcon :icon="['fas', 'triangle-exclamation']" class="wc-section-icon" />Pending Approval</strong>
              <span class="hint">Review before the dApp can proceed</span>
            </div>
          </div>
          <div class="manage-field">
            <span class="manage-label">dApp</span>
            <span>{{ pendingWcApproval.peerName }}</span>
          </div>
          <div class="manage-field">
            <span class="manage-label">Requested Method</span>
            <span class="wc-method-pill">{{ pendingWcApproval.method }}</span>
          </div>
          <div class="manage-field">
            <span class="manage-label">Session Topic</span>
            <span class="mono">{{ pendingWcApproval.topic }}</span>
          </div>
          <div class="active-wallet-actions wc-approval-actions">
            <button @click="approvePendingWcRequest" :disabled="isHandlingWcApproval">
              <FontAwesomeIcon :icon="['fas', 'plug']" class="icon-btn" />
              {{ isHandlingWcApproval ? 'Approving...' : 'Approve Request' }}
            </button>
            <button class="delete-wallet-btn" @click="rejectPendingWcRequest" :disabled="isHandlingWcApproval">
              <FontAwesomeIcon :icon="['fas', 'xmark']" class="icon-btn" />
              {{ isHandlingWcApproval ? 'Rejecting...' : 'Reject Request' }}
            </button>
          </div>
        </div>

        <div class="manage-wallet-info" v-else>
          <div class="hint"><FontAwesomeIcon :icon="['fas', 'circle-info']" class="wc-inline-icon" />No pending approvals right now.</div>
        </div>

        <div class="manage-wallet-info wc-connect-card">
          <div class="wc-section-head">
            <div class="wc-section-title-wrap">
              <strong class="wc-section-title"><FontAwesomeIcon :icon="['fas', 'plug']" class="wc-section-icon" />Connect to a dApp</strong>
              <span class="hint">{{ wcSessionCount === 0 ? 'Paste a WalletConnect URI from the webapp' : 'Connected webapp details' }}</span>
            </div>
          </div>
          <div v-if="wcSessionCount === 0 && !hasPendingWcConnectionProposal">
            <div class="row wc-uri-row">
              <label for="wc-uri-input" class="wc-uri-label"><FontAwesomeIcon :icon="['fas', 'copy']" class="wc-inline-icon" />Paste WalletConnect URI Here</label>
              <input id="wc-uri-input" class="wc-uri-input" v-model="wcUri" placeholder="wc:..." />
            </div>
            <p class="hint wc-uri-hint">Tip: Copy the full URI from the webapp and paste it into the highlighted field above.</p>
            <button @click="pairWalletConnect" :disabled="!activeWallet || !wcUri.trim()"><FontAwesomeIcon :icon="['fas', 'plug']" class="icon-btn" />Pair and Connect</button>
            <p class="hint" v-if="!activeWallet">Select a wallet first before pairing.</p>
          </div>
          <div v-else-if="hasPendingWcConnectionProposal" class="wc-connected-summary">
            <p class="hint">A connection request is waiting above. Approve or reject it to continue.</p>
          </div>
          <div v-else class="wc-connected-summary">
            <div class="manage-field">
              <span class="manage-label">Connected dApp</span>
              <span>{{ wcSessionEntries[0]?.[1]?.peerName || 'Unknown dApp' }}</span>
            </div>
            <div class="manage-field">
              <span class="manage-label">Website</span>
              <span>{{ getDisplayHost(wcSessionEntries[0]?.[1]?.peerUrl || '') }}</span>
            </div>
            <div class="manage-field">
              <span class="manage-label">Accounts</span>
              <span>{{ wcSessionEntries[0]?.[1]?.accounts.length || 0 }}</span>
            </div>
            <p class="hint" v-if="wcSessionCount > 1">{{ wcSessionCount }} dApps are connected. Full session details are listed below.</p>
          </div>
        </div>

        <div class="manage-wallet-info wc-sessions-card">
          <div class="wc-section-head">
            <div class="wc-section-title-wrap">
              <strong class="wc-section-title"><FontAwesomeIcon :icon="['fas', 'link']" class="wc-section-icon" />Active Sessions</strong>
              <span class="hint">Tap disconnect to revoke access</span>
            </div>
            <span class="wallet-tag">{{ wcSessionCount }}</span>
          </div>
          <div v-if="wcSessionCount === 0" class="wc-empty-state">
            <FontAwesomeIcon :icon="['fas', 'link']" class="wc-empty-icon" />
            <div>
              <strong>No active sessions</strong>
              <p class="hint">After pairing, connected dApps will appear here.</p>
            </div>
          </div>
          <ul v-else class="wc-session-list">
            <li v-for="session in wcSessionEntries" :key="`wc-${session[0]}`" class="wc-session-item">
              <div class="wc-session-head">
                <div class="wc-dapp-avatar" aria-hidden="true">
                  <img v-if="session[1].peerIcon" :src="session[1].peerIcon" :alt="`${session[1].peerName} icon`" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
                  <span v-else>{{ (session[1].peerName || '?').charAt(0).toUpperCase() }}</span>
                </div>
                <div class="wc-dapp-meta">
                  <strong>{{ session[1].peerName }}</strong>
                  <span class="hint">{{ getDisplayHost(session[1].peerUrl) }}</span>
                </div>
                <button class="tiny-btn wc-disconnect-btn" @click="disconnectSession(session[0])" title="Disconnect session" aria-label="Disconnect session">
                  <FontAwesomeIcon :icon="['fas', 'xmark']" class="icon-btn" />Disconnect
                </button>
              </div>
              <div class="wc-session-stats">
                <span><FontAwesomeIcon :icon="['fas', 'wallet']" class="wc-stat-icon" />Accounts: {{ session[1].accounts.length }}</span>
                <span class="mono"><FontAwesomeIcon :icon="['fas', 'link']" class="wc-stat-icon" />Topic: {{ session[0] }}</span>
              </div>
              <div class="mono wc-account-line" v-for="account in session[1].accounts" :key="account">{{ account }}</div>
            </li>
          </ul>
        </div>
      </dialog>
    </div>

    <div
      v-if="activeOverlayScreen === 'manage-wallet' && actionSheetWalletName"
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
          <button class="tab-btn" :class="{ active: manageModalMode === 'overview' }" @click="manageModalMode = 'overview'"><FontAwesomeIcon :icon="['fas', 'address-card']" class="icon-btn" />Wallet Info</button>
          <button class="tab-btn" :class="{ active: manageModalMode === 'derivation' }" @click="openManageDerivation"><FontAwesomeIcon :icon="['fas', 'route']" class="icon-btn" />Derivation</button>
          <button class="tab-btn" :class="{ active: manageModalMode === 'backup' }" @click="openManageBackup"><FontAwesomeIcon :icon="['fas', 'key']" class="icon-btn" />Seed Backup</button>
        </div>

        <template v-if="manageModalMode === 'overview'">
        <div class="manage-wallet-info" v-if="manageWalletDetails">
          <div class="hint" v-if="loadingManageWalletDetails"><FontAwesomeIcon :icon="['fas', 'circle-info']" class="icon-btn" />Loading wallet details...</div>
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
            <div class="manage-quick-hint">
              <strong><FontAwesomeIcon :icon="['fas', 'circle-info']" class="icon-btn" />Quick navigation:</strong>
              <span>Use the Derivation tab to switch paths and the Seed Backup tab to reveal your seed phrase.</span>
            </div>
            <div class="hint" v-if="manageWalletDetails.error">{{ manageWalletDetails.error }}</div>
          </template>
        </div>

        <div class="manage-danger-zone">
          <div class="manage-danger-title"><FontAwesomeIcon :icon="['fas', 'triangle-exclamation']" class="icon-btn" />Danger Zone</div>
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
            <p class="hint"><FontAwesomeIcon :icon="['fas', 'route']" class="icon-btn" />Selecting a preset applies instantly and reloads this wallet.</p>
            <div class="row">
              <label for="modal-derivation-select">New Derivation Path</label>
              <UiSelect
                id="modal-derivation-select"
                :model-value="derivationUpdateType"
                :options="derivationOptions"
                @update:modelValue="onDerivationUpdateTypeChangeAndApply"
              />
            </div>
            <div class="row" v-if="derivationUpdateType === 'custom'">
              <label for="modal-custom-derivation-input">Custom Path</label>
              <input
                id="modal-custom-derivation-input"
                v-model="customDerivationPathUpdate"
                placeholder="m/44'/145'/0' or m/44'/145'/0'/0/0"
                @change="applyCustomDerivationIfValid"
                @keydown.enter.prevent="applyCustomDerivationIfValid"
              />
            </div>
            <p class="hint" v-if="derivationUpdateType === 'custom'">Press Enter after typing a custom path to apply and reload.</p>
            <p class="hint" v-if="isUpdatingDerivation">Updating derivation and reloading wallet...</p>
          </div>
        </template>

        <template v-else>
          <div class="manage-wallet-info">
            <p class="hint"><FontAwesomeIcon :icon="['fas', 'key']" class="icon-btn" />Reveal and save this seed phrase securely offline.</p>
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
      v-if="activeOverlayScreen === 'create-import'"
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
              class="compact-select"
              id="wallet-mode-select"
              :model-value="mode"
              :options="modeOptions"
              @update:modelValue="onModeChange"
            />
          </div>
          <div class="row">
            <label for="wallet-type-select">Type</label>
            <UiSelect
              class="compact-select"
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
              class="compact-select"
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
      v-if="activeOverlayScreen === 'about'"
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
      v-if="activeOverlayScreen === 'receive'"
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
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');

.app-shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 14px 14px calc(18px + env(safe-area-inset-bottom));
  font-family: 'Manrope', 'Source Sans 3', 'Noto Sans', ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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

.topbar-simple {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}

.top-wallet-group {
  display: inline-flex;
  align-items: stretch;
  min-width: 0;
}

.top-quick-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.top-wallet-btn,
.top-connect-btn {
  min-height: 42px;
  border-radius: 12px;
}

.top-wallet-btn {
  text-align: left;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  flex: 1 1 auto;
  border-radius: 0 12px 12px 0;
  border-left: 0;
}

.top-receive-btn {
  width: 42px;
  min-width: 42px;
  min-height: 42px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  border-radius: 12px 0 0 12px;
}

.top-wallet-text {
  display: grid;
  gap: 1px;
}

.top-wallet-caption {
  font-size: 0.68rem;
  opacity: 0.78;
  letter-spacing: 0.02em;
}

.top-wallet-current {
  font-size: 0.88rem;
  line-height: 1.1;
}

.top-connect-btn {
  width: 42px;
  min-width: 42px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  position: relative;
}

.top-refresh-btn {
  border-color: rgba(147, 197, 253, 0.5);
}

.top-connect-icon {
  font-size: 0.95rem;
  margin-right: 0;
}

.top-connect-btn.wc-connected {
  border-color: rgba(110, 231, 183, 0.9);
  background:
    radial-gradient(circle at 20% 20%, rgba(110, 231, 183, 0.36), transparent 65%),
    linear-gradient(155deg, rgba(6, 78, 59, 0.52), rgba(4, 47, 46, 0.5));
  box-shadow: 0 0 0 1px rgba(110, 231, 183, 0.28), 0 0 18px rgba(52, 211, 153, 0.34);
}

.top-connect-btn.wc-connected .top-connect-icon {
  color: #d1fae5;
}

.wc-connected-dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #34d399;
  box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.95), 0 0 8px rgba(52, 211, 153, 0.85);
  animation: wcConnectedPulse 1.8s ease-out infinite;
}

@keyframes wcConnectedPulse {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  70% {
    transform: scale(1.22);
    opacity: 0.55;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.wc-pending-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  margin-left: 8px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid rgba(134, 239, 172, 0.5);
  background: rgba(20, 83, 45, 0.65);
  color: #dcfce7;
  font-size: 0.7rem;
}

.home-stack {
  display: grid;
  gap: 12px;
}

.glass-card {
  width: 100%;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 10px 28px rgba(2, 6, 23, 0.22);
}

.active-wallet-card {
  position: relative;
  z-index: 2;
  overflow: visible;
}

.active-wallet-card.dropdown-open {
  z-index: 12;
}

.tokens-preview-card {
  position: relative;
  z-index: 1;
}

.tokens-preview-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.tokens-preview-head h3 {
  margin: 0;
}
.tokens-preview-usd {
  font-size: 0.78rem;
  color: #cbd5e1;
  white-space: nowrap;
}
.status-toast {
  position: fixed;
  right: 12px;
  top: calc(10px + env(safe-area-inset-top));
  z-index: 70;
  max-width: min(84vw, 420px);
  padding: 8px 10px;
  align-items: center;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.92);
  color: #e2e8f0;
  width: min(700px, 100%);
  max-height: min(88dvh, 760px);
  height: auto;
  backdrop-filter: blur(8px);
  border-radius: 16px;
  overflow-wrap: anywhere;
}
.panel-grid {
  display: grid;
  gap: 14px;
}
.panel {
  width: 100%;
  padding: 15px;
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
  margin-top: 10px;
  padding: 10px 12px;
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
  gap: 0;
}
.wallet-list-panel {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: 6px;
  max-height: min(56dvh, 460px);
}
.wallet-item {
  margin: 0;
  padding: 2px 4px;
  min-height: 34px;
  border: 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 0;
  background: transparent;
  cursor: pointer;
}
.wallet-item:hover {
  background: rgba(30, 41, 59, 0.28);
}
.wallet-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
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
  min-height: 24px;
  padding: 2px 6px;
  font-size: 11px;
}
.wallet-list-modal {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  overflow: auto;
}
.wallet-list-modal > .action-sheet-btn {
  margin-top: 6px;
}
.active-derivation-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.active-derivation-btn {
  width: auto;
  min-height: 28px;
  padding: 4px 8px;
  white-space: nowrap;
}
.active-derivation-editor {
  margin-top: 8px;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.28);
}
.action-sheet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
  padding: 12px;
}
.action-sheet {
  width: min(700px, 100%);
  max-height: min(88dvh, 760px);
  height: auto;
  margin: 0;
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
  overflow-y: auto;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
.action-sheet .manage-wallet-info {
  padding: 8px;
  gap: 6px;
  font-size: 0.82rem;
}
.action-sheet .row {
  gap: 4px;
  margin-bottom: 8px;
}
.action-sheet label {
  font-size: 0.76rem;
}
.action-sheet input,
.action-sheet textarea,
.action-sheet select {
  min-height: 32px;
  padding: 5px 7px;
  font-size: 13px;
}
.action-sheet select {
  min-height: 32px;
  font-size: 13px;
  padding-right: 24px;
}
.action-sheet button {
  min-height: 32px;
  padding: 5px 9px;
  font-size: 0.8rem;
}
.action-sheet .tiny-btn,
.action-sheet .wallet-row-btn,
.action-sheet .token-send-btn,
.action-sheet .token-copy-btn,
.action-sheet .inline-copy-btn {
  min-height: 22px;
  min-width: 22px;
  padding: 1px 5px;
}
.action-sheet .action-sheet-btn {
  min-height: 32px;
  font-size: 0.8rem;
}
.action-sheet .tab-btn {
  min-height: 26px;
  padding: 3px 8px;
  font-size: 0.74rem;
}
.create-import-modal {
  gap: 8px;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.create-import-modal .manage-wallet-info {
  padding: 6px 8px;
  gap: 4px;
}
.create-import-modal .row {
  gap: 3px;
  margin: 0 0 6px;
}
.create-import-modal .row:last-child {
  margin-bottom: 0;
}
.create-import-modal label {
  font-size: 0.72rem;
  line-height: 1.15;
}
.create-import-modal input,
.create-import-modal textarea,
.create-import-modal select {
  min-height: 30px;
  padding: 4px 6px;
  font-size: 12px;
}
.create-import-modal textarea {
  min-height: 64px;
}
.create-import-modal .action-sheet-btn {
  min-height: 30px;
  font-size: 0.78rem;
  padding: 5px 8px;
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
.manage-quick-hint {
  display: grid;
  gap: 2px;
  padding: 8px;
  border: 1px solid rgba(125, 211, 252, 0.28);
  border-radius: 8px;
  background: rgba(30, 64, 175, 0.14);
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
.action-sheet .icon-close {
  min-width: 32px;
  width: 32px;
  min-height: 32px;
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
  gap: 7px;
  margin-bottom: 12px;
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
  border: 1px solid rgba(125, 211, 252, 0.42);
  border-radius: 8px;
  background: linear-gradient(155deg, rgba(20, 83, 45, 0.36), rgba(6, 78, 59, 0.38));
  backdrop-filter: blur(6px) saturate(120%);
  -webkit-backdrop-filter: blur(6px) saturate(120%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 4px 14px rgba(2, 6, 23, 0.2);
  color: #fff;
  cursor: pointer;
  min-height: 36px;
  font-weight: 600;
  font-size: 0.92rem;
}
button:disabled {
  background: rgba(51, 65, 85, 0.45);
  border-color: rgba(148, 163, 184, 0.35);
  box-shadow: none;
  cursor: not-allowed;
}
.meta {
  margin-top: 12px;
  display: grid;
  gap: 10px;
}
.address-grid {
  display: grid;
  gap: 10px;
}
.address-card {
  border: 1px solid rgba(125, 211, 252, 0.26);
  border-radius: 12px;
  background: linear-gradient(155deg, rgba(14, 26, 48, 0.72), rgba(15, 23, 42, 0.42));
  padding: 10px;
}
.address-card-bch {
  border-color: rgba(56, 189, 248, 0.45);
  box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.2);
}
.address-card-token {
  border-color: rgba(45, 212, 191, 0.45);
  box-shadow: inset 0 0 0 1px rgba(94, 234, 212, 0.2);
}
.address-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.address-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.address-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.address-icon-wrap {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.35);
  display: inline-grid;
  place-items: center;
  color: #67e8f9;
  background: rgba(2, 6, 23, 0.48);
}
.address-title-stack {
  display: grid;
  gap: 1px;
}
.address-title {
  font-family: inherit;
  font-weight: 700;
  font-size: 0.76rem;
  letter-spacing: 0.03em;
  color: #e0f2fe;
}
.address-subtitle {
  font-size: 0.66rem;
  color: #93c5fd;
}
.address-copy-btn {
  border-color: rgba(147, 197, 253, 0.38);
  background: linear-gradient(180deg, rgba(30, 64, 175, 0.48), rgba(30, 58, 138, 0.42));
}
.address-value {
  margin-top: 8px;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.76rem;
  line-height: 1.35;
  color: #ccfbf1;
  text-shadow: 0 0 10px rgba(45, 212, 191, 0.16);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.send-asset-modal.send-asset-modal-token {
  overflow: hidden;
  grid-template-rows: auto auto minmax(0, 1fr);
}
.send-history-card {
  margin-top: 0;
  display: grid;
  gap: 7px;
}
.send-asset-modal-token .send-history-card {
  min-height: 0;
  overflow: hidden;
  grid-template-rows: auto minmax(0, 1fr);
}
.send-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.send-history-head strong {
  display: inline-flex;
  align-items: center;
  font-size: 0.8rem;
}
.send-history-body {
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}
.send-history-list {
  display: grid;
  gap: 6px;
}
.send-history-item {
  padding: 7px 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.32);
  display: grid;
  gap: 3px;
}
.send-history-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.78rem;
}
.send-history-top-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.send-history-open-btn {
  width: 22px;
  min-width: 22px;
  min-height: 22px;
  padding: 0;
  display: inline-grid;
  place-items: center;
}
.send-history-direction {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.88;
}
.send-history-direction.sent {
  color: #fca5a5;
}
.send-history-direction.received {
  color: #86efac;
}
.send-history-item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.66rem;
  color: #bfdbfe;
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
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  border: 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  background: transparent;
  border-radius: 0;
  height: 42px;
  padding: 3px 0;
  overflow: hidden;
}
.token-icon-slot {
  width: 24px;
  height: 24px;
  min-width: 24px;
  min-height: 24px;
  max-width: 24px;
  max-height: 24px;
  flex: 0 0 24px;
  border-radius: 8px;
  display: inline-grid;
  place-items: center;
  border: 1px solid rgba(191, 219, 254, 0.24);
  background: rgba(30, 41, 59, 0.38);
  color: #bae6fd;
  font-size: 0.78rem;
}
.token-icon-btn {
  padding: 0;
  cursor: pointer;
  width: 24px;
  height: 24px;
  min-width: 24px;
  min-height: 24px;
  max-width: 24px;
  max-height: 24px;
}
.token-icon-btn.copied {
  border-color: rgba(125, 211, 252, 0.7);
  box-shadow: 0 0 0 1px rgba(125, 211, 252, 0.4);
}
.token-icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 7px;
}
.token-info-grid {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.token-main-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}
.token-card-title {
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0;
  min-width: 0;
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.token-favorite-badge {
  display: inline-flex;
  align-items: center;
  margin-right: 5px;
  color: #facc15;
  font-size: 0.65rem;
  vertical-align: middle;
}
.token-quick-stats {
  display: none;
}
.token-usd-value {
  flex: 0 0 auto;
  font-size: 0.78rem;
  white-space: nowrap;
}
.token-sub-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.token-price-source {
  min-width: 0;
  font-size: 0.54rem;
  opacity: 0.72;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.token-amount-main {
  flex: 0 0 auto;
  font-size: 0.58rem;
  opacity: 0.86;
  white-space: nowrap;
}
.token-nft-mini {
  opacity: 0.72;
  font-size: 0.68rem;
}
.token-id {
  font-size: 0.64rem;
  opacity: 0.7;
  margin-top: 0;
  margin-bottom: 0;
  display: inline-block;
  max-width: 66px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.token-id-btn {
  width: auto;
  min-height: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  margin-bottom: 0;
  min-width: 0;
  max-width: 92px;
  overflow: hidden;
  color: #dbeafe;
}
.token-id-copy {
  font-size: 0.62rem;
  opacity: 0.62;
  display: none;
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
.token-actions-line {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex: 0 0 auto;
}
.token-send-btn {
  min-height: 20px;
  min-width: 20px;
  padding: 1px 4px;
}
.token-favorite-btn,
.token-hide-btn,
.token-unhide-btn {
  min-height: 20px;
  min-width: 20px;
  padding: 1px 4px;
}
.token-favorite-btn.active {
  border-color: rgba(250, 204, 21, 0.6);
  color: #facc15;
  background: linear-gradient(180deg, rgba(120, 53, 15, 0.5), rgba(92, 40, 11, 0.42));
}
.token-hide-btn {
  border-color: rgba(248, 113, 113, 0.5);
  color: #fecaca;
  background: linear-gradient(180deg, rgba(153, 27, 27, 0.44), rgba(127, 29, 29, 0.36));
}
.token-unhide-btn {
  border-color: rgba(110, 231, 183, 0.5);
  color: #a7f3d0;
  background: linear-gradient(180deg, rgba(6, 95, 70, 0.48), rgba(4, 78, 58, 0.4));
}
.token-copy-btn {
  min-height: 20px;
  min-width: 20px;
  padding: 1px 4px;
}
.token-copy-btn.copied {
  color: #7dd3fc;
  border-color: rgba(125, 211, 252, 0.5);
}
.token-card-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 0.82rem;
}
.hidden-token-panel {
  margin-top: 8px;
  border-top: 1px dashed rgba(148, 163, 184, 0.36);
  padding-top: 8px;
  display: grid;
  gap: 6px;
}
.hidden-token-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hidden-token-panel-head strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
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
.wallet-connect-modal {
  gap: 9px;
  font-family: inherit;
}
.wallet-connect-modal .manage-wallet-info {
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 10px 28px rgba(2, 6, 23, 0.22);
}
.wc-modal-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  letter-spacing: 0.03em;
}
.wc-title-icon {
  color: #7dd3fc;
  font-size: 1.02rem;
}
.wallet-connect-modal .manage-label {
  color: #bae6fd;
}
.wallet-connect-modal .hint {
  color: #dbeafe;
}
.wc-overview-card {
  background: rgba(15, 23, 42, 0.24);
}
.wc-overview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.wc-overview-item {
  border: 1px solid rgba(191, 219, 254, 0.14);
  border-radius: 9px;
  padding: 7px 8px;
  background: rgba(15, 23, 42, 0.2);
  display: grid;
  gap: 2px;
}
.wc-overview-item.active {
  border-color: rgba(110, 231, 183, 0.5);
  box-shadow: inset 3px 0 0 rgba(110, 231, 183, 0.55);
}
.wc-overview-item.pending {
  border-color: rgba(251, 191, 36, 0.5);
  box-shadow: inset 3px 0 0 rgba(251, 191, 36, 0.65);
}
.wc-overview-item strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: #f0f9ff;
}
.wc-overview-icon {
  color: #7dd3fc;
  font-size: 0.92rem;
}
.wc-overview-hint {
  margin: 0;
}
.wc-pending-card {
  background: rgba(15, 23, 42, 0.24);
}
.wc-connection-proposal-card {
  background: rgba(15, 23, 42, 0.24);
}
.wc-proposal-dapp {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wc-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wc-section-title-wrap {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.wc-section-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.85rem;
  color: #f0f9ff;
  letter-spacing: 0.02em;
}
.wc-section-icon {
  color: #67e8f9;
  font-size: 0.92rem;
}
.wc-method-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  padding: 2px 8px;
  border: 0;
  background: rgba(30, 64, 175, 0.28);
  font-size: 0.74rem;
}
.wc-approval-actions button {
  flex: 1 1 180px;
}
.wc-connect-card {
  background: rgba(15, 23, 42, 0.24);
}
.wc-uri-row {
  margin-bottom: 4px;
  padding: 9px;
  border: 1px solid rgba(125, 211, 252, 0.28);
  border-radius: 10px;
  background: rgba(30, 64, 175, 0.14);
  box-shadow: inset 2px 0 0 rgba(125, 211, 252, 0.48);
}
.wc-uri-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  color: #e0f2fe;
  letter-spacing: 0.02em;
}
.wc-uri-input {
  background: rgba(2, 6, 23, 0.72);
  border-color: rgba(125, 211, 252, 0.68);
  color: #f8fafc;
  min-height: 38px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.wc-uri-input::placeholder {
  color: rgba(191, 219, 254, 0.86);
}
.wc-uri-input:focus {
  outline: none;
  border-color: rgba(103, 232, 249, 0.9);
  box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
.wc-uri-hint {
  margin: -1px 0 0;
  color: #bfdbfe;
}
.wc-connected-summary {
  display: grid;
  gap: 7px;
  padding: 8px 9px;
  border: 1px solid rgba(191, 219, 254, 0.14);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.2);
}
.wc-inline-icon {
  color: #67e8f9;
  font-size: 0.9rem;
  margin-right: 5px;
}
.wc-sessions-card {
  background: rgba(15, 23, 42, 0.24);
}
.wc-empty-state {
  border: 1px solid rgba(191, 219, 254, 0.14);
  border-radius: 9px;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(15, 23, 42, 0.2);
}
.wc-empty-icon {
  color: #93c5fd;
  font-size: 1rem;
}
.wc-empty-state strong {
  display: block;
  font-size: 0.8rem;
}
.wc-empty-state .hint {
  margin: 2px 0 0;
}
.wc-session-list li {
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid rgba(191, 219, 254, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.2);
}
.wc-session-item {
  margin-bottom: 10px;
}
.wc-session-item:last-child {
  margin-bottom: 0;
}
.wc-session-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wc-dapp-avatar {
  width: 24px;
  height: 24px;
  min-width: 24px;
  border-radius: 6px;
  background: rgba(30, 41, 59, 0.55);
  display: inline-grid;
  place-items: center;
  overflow: hidden;
  font-size: 0.72rem;
  font-weight: 700;
  color: #cbd5e1;
}
.wc-dapp-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.wc-dapp-meta {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.wc-dapp-meta strong {
  font-size: 0.8rem;
  line-height: 1.1;
}
.wc-dapp-meta .hint {
  font-size: 0.68rem;
}
.wc-disconnect-btn {
  margin-left: auto;
  white-space: nowrap;
}
.wc-session-stats {
  margin-top: 5px;
  display: grid;
  gap: 2px;
  font-size: 0.7rem;
  opacity: 0.86;
}
.wc-stat-icon {
  color: #93c5fd;
  margin-right: 5px;
  font-size: 0.78rem;
}
.wc-account-line {
  margin-top: 4px;
  font-size: 0.68rem;
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
  .topbar-simple {
    grid-template-columns: minmax(0, 1fr) auto;
    margin-bottom: 10px;
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
    border-radius: 10px;
  }
  .compact-mobile .panel {
    padding: 9px;
  }
  .compact-mobile .row {
    margin-bottom: 7px;
  }
  .compact-mobile button {
    min-height: 38px;
  }
  .panel {
    border-radius: 14px;
  }
  .collapse-toggle {
    min-height: 44px;
    border-radius: 12px;
  }
  .section-body {
    padding: 10px;
  }
  .manager-body {
    padding: 10px;
  }
  .meta .mono {
    font-size: 0.78rem;
  }
  .token-nft-mini {
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
    width: min(640px, 100%);
    max-height: 92dvh;
    border-radius: 12px;
    padding: 10px;
    backdrop-filter: blur(10px) saturate(125%);
    -webkit-backdrop-filter: blur(10px) saturate(125%);
    background: linear-gradient(160deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.92));
    box-shadow: 0 18px 40px rgba(2, 6, 23, 0.52), inset 0 1px 0 rgba(255, 255, 255, 0.16);
  }
  .action-sheet-btn {
    min-height: 40px;
    font-size: 0.9rem;
  }
  .wc-overview-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .wc-overview-item {
    padding: 6px;
  }
  .wc-overview-item strong {
    font-size: 0.74rem;
    gap: 4px;
  }
}

@media (min-width: 860px) {
  .action-sheet-overlay {
    padding: 12px;
  }
  .action-sheet {
    width: min(720px, 100%);
    max-height: min(86dvh, 760px);
    border-radius: 16px;
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
    display: block;
  }
}
</style>
