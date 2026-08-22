<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BaseWallet, Config, DefaultProvider, HDWallet, NetworkType, TestNetHDWallet, TestNetWallet, TokenSendRequest, UnitEnum, Wallet, convert } from 'mainnet-js';
import { IndexedDBProvider } from '@mainnet-cash/indexeddb-storage';
import type { IWalletKit, WalletKitTypes } from '@reown/walletkit';
import { base58AddressToLockingBytecode, binToHex, encodeLockingBytecodeP2pkh, lockingBytecodeToCashAddress, secp256k1, sha256 } from '@bitauth/libauth';
import type { WcSignMessageRequest, WcSignTransactionRequest } from '@bch-wc2/interfaces';
import { DERIVATION_PATHS, DERIVATION_SCAN_CANDIDATES, type DerivationPathType, resolveDerivationPaths } from './lib/derivation';
import UiSelect from './components/UiSelect.vue';
import WalletAllocationChart, { type AllocationEntry } from './components/WalletAllocationChart.vue';

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

type WalletBalanceEntry = {
  sats: bigint;
  loading: boolean;
  error?: string;
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

type ScanTokenBalance = {
  category: string;
  displayName: string;
  symbol?: string;
  decimals: number;
  amount: bigint;
};

type DerivationScanResult = {
  label: string;
  parent: string;
  full: string;
  chain: number;
  index: number;
  switchable: boolean;
  address: string;
  balanceSats: bigint;
  tokenBalances: ScanTokenBalance[];
  error?: string;
};

type UsdRateCache = {
  rate: number;
  updatedAt: number;
};

type FiatRateCache = {
  rates: Record<string, number>;
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

type NotificationSettingKey = 'sendFunds' | 'receiveFunds' | 'walletConnectApproval';

type NotificationItem = {
  id: string;
  label: string;
  icon: string;
  settingKey: NotificationSettingKey;
};

type NotificationEventItem = {
  id: string;
  type: NotificationSettingKey;
  label: string;
  icon: string;
  message: string;
  createdAt: number;
  read: boolean;
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
type OverlayScreen = 'none' | 'wallet-list' | 'token-list' | 'send-asset' | 'wallet-connect' | 'manage-wallet' | 'create-import' | 'about' | 'receive' | 'notifications' | 'allocation-chart';

const WALLETCONNECT_PROJECT_ID = '3fd234b8e2cd0e1da4bc08a0011bbf64';
const TOKEN_NAME_CACHE_STORAGE_KEY = 'slim.tokenNameCache.v2';
const USD_RATE_CACHE_STORAGE_KEY = 'slim.usdRateCache.v1';
const FIAT_RATE_CACHE_STORAGE_KEY = 'slim.fiatRateCache.v1';
const FIAT_CURRENCY_STORAGE_KEY = 'slim.fiatCurrency.v1';
const HIDDEN_TOKEN_CATEGORIES_STORAGE_KEY = 'slim.hiddenTokenCategories.v1';
const COINPAPRIKA_BCH_TICKER_URL = 'https://api.coinpaprika.com/v1/tickers/bch-bitcoin-cash';
const FAVORITE_TOKEN_CATEGORIES_STORAGE_KEY = 'slim.favoriteTokenCategories.v1';
const NOTIFICATION_SETTINGS_STORAGE_KEY = 'slim.notificationSettings.v1';
const NOTIFICATION_EVENTS_STORAGE_KEY = 'slim.notificationEvents.v1';
const IPFS_GATEWAY = 'https://dweb.link/ipfs/';
const IPFS_GATEWAYS_LIST = [
  'https://dweb.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];
const BCH_ICON_URI = 'https://bitcoincash.org/img/green/bitcoin-cash-circle.svg';
const MAX_TOKEN_NAME_CACHE_ENTRIES = 350;
const SUPPORTED_FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR', 'PHP'];
const DEFAULT_FIAT_CURRENCY = 'USD';
const USD_RATE_CACHE_TTL_DESKTOP_MS = 2 * 60 * 1000;
const USD_RATE_CACHE_TTL_MOBILE_MS = 6 * 60 * 1000;
const USD_FIAT_RATE_API_KEY = 'bec0eef0773f6adde5c947ba';
const USD_FIAT_RATE_API_URL = `https://v6.exchangerate-api.com/v6/${USD_FIAT_RATE_API_KEY}/latest/USD`;
const USD_FIAT_RATE_FALLBACK_URL = `https://api.exchangerate.host/latest?base=USD&symbols=${SUPPORTED_FIAT_CURRENCIES.join(',')}`;
const TOKEN_EXPLORER_BASE_URL = 'https://tokenexplorer.cash/?tokenId=';

const walletConnectRuntime = globalThis as typeof globalThis & {
  __purzeWalletConnectCore?: unknown;
  __purzeWalletConnectInitPromise?: Promise<IWalletKit>;
};

const status = ref('Ready');
const toastMessage = ref('');
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const wallets = ref<ManagedWallet[]>([]);
const walletBalances = ref<Record<string, WalletBalanceEntry>>({});
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
const derivationScanResults = ref<DerivationScanResult[]>([]);
const isScanningDerivations = ref(false);
const derivationScanMessage = ref('');
const derivationUpdateType = ref<DerivationPathType>('standard');
const customDerivationPathUpdate = ref('');
const isUpdatingDerivation = ref(false);
const activeWalletScanResults = ref<DerivationScanResult[]>([]);
const isScanningActiveWalletDerivations = ref(false);
const activeWalletScanMessage = ref('');
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
const fiatCurrency = ref<string>(DEFAULT_FIAT_CURRENCY);
const usdToFiatRate = ref<number>(1);
const fiatBalance = ref<number | null>(null);
const fiatRateCache = ref<FiatRateCache | null>(null);
const walletAddress = ref('');
const tokenWalletAddress = ref('');
const tokenList = ref<TokenSummary[]>([]);
const tokenNameCache = ref<Record<string, TokenMetadata>>({});
const hiddenTokenCategories = ref<Record<string, true>>({});
const favoriteTokenCategories = ref<Record<string, true>>({});
const usdRateCache = ref<UsdRateCache | null>(null);
const sendMode = ref<'bch' | 'token'>('bch');
const sendModalTabView = ref<'send' | 'history'>('send');
const sendToAddress = ref('');
const sendBchAmount = ref('');
const sendUsdAmount = ref('');
const sendTokenCategory = ref('');
const sendTokenAmount = ref('');
const sendDestinationMode = ref<'external' | 'wallet'>('external');
const sendToWalletName = ref('');
const isResolvingWalletAddress = ref(false);
const sendToWalletError = ref('');
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
const tokenDetailOpen = ref(false);
const tokenDetailAsset = ref<AssetItem | null>(null);
const tokenDetailUrl = ref('');
const tokenDetailIframeSrc = ref('');
const tokenDetailLoading = ref(false);
const tokenDetailError = ref('');
const walletManagerCollapsed = ref(true);
const activeWalletSectionEl = ref<HTMLElement | null>(null);
const tokensSectionEl = ref<HTMLElement | null>(null);
const walletManagerSectionEl = ref<HTMLElement | null>(null);
const walletConnectSectionEl = ref<HTMLElement | null>(null);
const copiedTokenId = ref<string | null>(null);
const failedAssetIcons = ref<Record<string, true>>({});
const failedIconUris = ref<Record<string, true>>({});
let copiedTokenTimer: ReturnType<typeof setTimeout> | null = null;
const notificationMenuOpen = ref(false);
const notificationMenuEl = ref<HTMLElement | null>(null);
const notificationsModalEl = ref<HTMLElement | null>(null);
const notificationSettings = ref<Record<NotificationSettingKey, boolean>>({
  sendFunds: true,
  receiveFunds: true,
  walletConnectApproval: true,
});
const notificationEvents = ref<NotificationEventItem[]>([]);
const previousBchBalance = ref<bigint | null>(null);
const previousTokenTotals = ref<Record<string, bigint>>({});
const hasNotificationBalanceBaseline = ref(false);
const walletModalView = ref<'wallets' | 'notifications'>('wallets');
const notificationPanelView = ref<'list' | 'settings'>('list');
const notificationListFilter = ref<'unread' | 'all'>('unread');
const notificationPage = ref(1);
const notificationPageSize = ref(8);

const filteredNotificationEvents = computed(() => {
  const byType = notificationEvents.value.filter((item) => notificationSettings.value[item.type]);
  if (notificationListFilter.value === 'unread') {
    return byType.filter((i) => !i.read);
  }
  return byType;
});

const notificationTotalPages = computed(() => Math.max(1, Math.ceil(filteredNotificationEvents.value.length / notificationPageSize.value)));
const displayedNotifications = computed(() => {
  const page = Math.max(1, Math.min(notificationPage.value, notificationTotalPages.value));
  const start = (page - 1) * notificationPageSize.value;
  return filteredNotificationEvents.value.slice(start, start + notificationPageSize.value);
});

watch([notificationListFilter, filteredNotificationEvents], () => {
  notificationPage.value = 1;
});

const wcUri = ref('');
const walletKit = ref<IWalletKit | null>(null);
const wcSessions = ref<SessionMap>({});
const pendingWcRequests = ref<PendingWcRequest[]>([]);
const pendingWcConnectionProposals = ref<PendingWcConnectionProposal[]>([]);
const isHandlingWcConnectionProposal = ref(false);
const isHandlingWcApproval = ref(false);

Config.UseIndexedDBCache = true;
BaseWallet.StorageProvider = IndexedDBProvider;
Config.DefaultParentDerivationPath = DERIVATION_PATHS.standard.parent;

// mainnet-js normally talks to a single random Electrum/Fulcrum server (often
// blackie.c3-soft.com). If that one server is down, blocked, or refuses the
// websocket handshake, every wallet call fails with an ERR_CONNECTION_REFUSED
// style error. Giving it a list of known-good public servers instead lets it
// fall back to the next one automatically, the same way Cashonize does.
DefaultProvider.servers.mainnet = [
  'wss://bch.imaginary.cash:50004',
  'wss://blackie.c3-soft.com:50004',
  'wss://fulcrum.jettscythe.xyz:50004',
  'wss://cashnode.bch.ninja:50004',
];
DefaultProvider.servers.testnet = [
  'wss://chipnet.imaginary.cash:50004',
  'wss://chipnet.bch.ninja:50004',
];

const walletNames = computed(() => wallets.value.map((w) => w.name));
const grandTotalSats = computed(() => wallets.value.reduce((sum, w) => sum + (walletBalances.value[w.name]?.sats ?? 0n), 0n));
const grandTotalFiat = computed(() => {
  if (bchUsdRate.value === null) return null;
  return (Number(grandTotalSats.value) / 100_000_000) * bchUsdRate.value * usdToFiatRate.value;
});
const isLoadingWalletBalances = computed(() => wallets.value.some((w) => walletBalances.value[w.name]?.loading));
const resolvedDerivation = computed(() => resolveDerivationPaths(derivationPathType.value, customDerivationPath.value));
const activeWalletOptions = computed<SelectOption[]>(() => wallets.value.map((w) => ({ value: w.name, label: `${w.name} (${w.type})` })));
const otherWalletOptions = computed<SelectOption[]>(() =>
  wallets.value.filter((w) => w.name !== activeWalletName.value).map((w) => ({ value: w.name, label: `${w.name} (${w.type})` }))
);
const hasOtherWallets = computed(() => otherWalletOptions.value.length > 0);
const sendDestinationModeOptions: SelectOption[] = [
  { value: 'external', label: 'External Address' },
  { value: 'wallet', label: 'One of My Wallets' },
];
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
const activeWalletScanFundedCount = computed(
  () => activeWalletScanResults.value.filter((r) => r.balanceSats > 0n || r.tokenBalances.length > 0).length,
);
const activeWalletScanErrors = computed(() => activeWalletScanResults.value.filter((r) => r.error));

const currencyOptions = computed<SelectOption[]>(() =>
  SUPPORTED_FIAT_CURRENCIES.map((currency) => ({ value: currency, label: currency })),
);

async function onFiatCurrencyChange(value: string) {
  if (!SUPPORTED_FIAT_CURRENCIES.includes(value)) return;
  fiatCurrency.value = value;
  persistFiatCurrency();

  fiatRateCache.value = null;
  await updateFiatRate(true);
  fiatBalance.value = usdBalance.value !== null ? usdBalance.value * usdToFiatRate.value : null;
}

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
    cauldronPriceText: '--',
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
const externalSendAddressResolution = computed<DestinationResolution>(() => {
  if (sendDestinationMode.value !== 'external') return { address: null, isLegacy: false, error: null };
  const isMainnet = !activeWallet.value || activeWallet.value.network === NetworkType.Mainnet;
  return resolveDestinationAddress(sendToAddress.value, isMainnet, sendMode.value === 'token');
});
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
    iconUri: BCH_ICON_URI,
    usdValueText: formatCurrency(fiatBalance.value),
    cauldronPriceText: bchUsdRate.value === null ? '--' : formatCurrency(bchUsdRate.value * usdToFiatRate.value),
    amountText: `${formatBchFromSats(bchBalance.value)} BCH`,
    canSend: bchBalance.value > 0n,
  };

  const tokenAssets = visibleTokenList.value.map((token) => toTokenAssetItem(token));

  return [bchAsset, ...tokenAssets];
});
const previewAssets = computed(() => assetItems.value.slice(0, 100));

// --- Fund allocation chart (active wallet only) ---------------------------
// Built purely from this wallet's own reactive state (bchBalance,
// visibleTokenList) - never touches `wallets`/`walletBalances` for other
// wallets, so switching wallets or hiding a token is reflected automatically
// and nothing here can leak another wallet's holdings into the chart.
type AllocationSourceEntry = {
  key: string;
  label: string;
  amountText: string;
  valueText: string | null;
  /** Decimal-adjusted raw amount, used for slice sizing when not every asset has a fiat value. */
  amountWeight: number;
  /** Fiat value, used for slice sizing only when every included asset has one. */
  valueWeight: number | null;
};

const walletAllocationSourceEntries = computed<AllocationSourceEntry[]>(() => {
  if (!activeWallet.value) return [];
  const entries: AllocationSourceEntry[] = [];

  if (bchBalance.value > 0n) {
    entries.push({
      key: 'alloc-bch',
      label: 'Bitcoin Cash (BCH)',
      amountText: `${formatBchFromSats(bchBalance.value)} BCH`,
      valueText: fiatBalance.value !== null ? formatCurrency(fiatBalance.value) : null,
      amountWeight: Number(bchBalance.value) / 1e8,
      valueWeight: fiatBalance.value,
    });
  }

  for (const token of visibleTokenList.value) {
    if (token.fungibleAmount <= 0n) continue; // NFT-only or empty balance - nothing to size a slice by
    entries.push({
      key: `alloc-${token.category}`,
      label: token.symbol ? `${token.displayName} (${token.symbol})` : token.displayName,
      amountText: formatTokenAmount(token.fungibleAmount, token.decimals),
      valueText: null, // Purze doesn't currently price individual tokens in fiat
      amountWeight: Number(token.fungibleAmount) / 10 ** (token.decimals ?? 0),
      valueWeight: null,
    });
  }

  return entries;
});

// Only size slices by fiat value when every included asset actually has one -
// otherwise a token's raw unit count would get compared against BCH's dollar
// value, which isn't a fair "allocation" in any real sense.
const walletAllocationUsesValueWeighting = computed(
  () =>
    walletAllocationSourceEntries.value.length > 0 &&
    walletAllocationSourceEntries.value.every((entry) => entry.valueWeight !== null && entry.valueWeight > 0),
);

const walletAllocationEntries = computed<AllocationEntry[]>(() =>
  walletAllocationSourceEntries.value.map((entry) => ({
    key: entry.key,
    label: entry.label,
    amountText: entry.amountText,
    valueText: entry.valueText,
    weight: walletAllocationUsesValueWeighting.value ? (entry.valueWeight as number) : entry.amountWeight,
  })),
);
const currentWalletButtonLabel = computed(() => activeWalletName.value || 'Select Wallet');
const pendingWcApproval = computed(() => pendingWcRequests.value[0] ?? null);
const pendingWcConnectionProposal = computed(() => pendingWcConnectionProposals.value[0] ?? null);
const hasPendingWcConnectionProposal = computed(() => pendingWcConnectionProposals.value.length > 0);
const pendingWcConnectionProposalCount = computed(() => pendingWcConnectionProposals.value.length);
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
const allNotificationItems: NotificationItem[] = [
  { id: 'send-funds', label: 'Send funds', icon: 'paper-plane', settingKey: 'sendFunds' },
  { id: 'receive-funds', label: 'Receive funds', icon: 'wallet', settingKey: 'receiveFunds' },
  { id: 'wallet-connect-approval', label: 'Wallet connect approval', icon: 'link', settingKey: 'walletConnectApproval' },
];
const hasEnabledNotificationTypes = computed(() => Object.values(notificationSettings.value).some(Boolean));
const notificationItems = computed(() => notificationEvents.value.filter((item) => notificationSettings.value[item.type] && !item.read));
const notificationCount = computed(() => notificationItems.value.length);
const notificationUnreadIds = computed(() => new Set(notificationItems.value.map((item) => item.id)));

function showBrowserNotification(entry: NotificationEventItem) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(entry.label, {
      body: entry.message,
      tag: entry.id,
      renotify: false,
      silent: false,
    });
    notification.onclick = () => {
      window.focus();
    };
  } catch {
    // Ignore failures from the browser notification API.
  }
}

function pushNotification(type: NotificationSettingKey, message: string) {
  const definition = allNotificationItems.find((item) => item.settingKey === type);
  if (!definition) return;
  if (!notificationSettings.value[type]) return;

  const entry: NotificationEventItem = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    label: definition.label,
    icon: definition.icon,
    message,
    createdAt: Date.now(),
    read: false,
  };

  notificationEvents.value = [entry, ...notificationEvents.value].slice(0, 60);
  showBrowserNotification(entry);
}

function persistNotificationEvents() {
  localStorage.setItem(NOTIFICATION_EVENTS_STORAGE_KEY, JSON.stringify(notificationEvents.value));
}

function persistNotificationSettings() {
  localStorage.setItem(NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify(notificationSettings.value));
}

function setNotificationSetting(settingKey: NotificationSettingKey, enabled: boolean) {
  notificationSettings.value = {
    ...notificationSettings.value,
    [settingKey]: enabled,
  };
  persistNotificationSettings();
}

function onNotificationSettingToggle(settingKey: NotificationSettingKey, event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const enabled = target.checked;
  setNotificationSetting(settingKey, enabled);
  if (enabled) {
    void ensureBrowserNotificationPermission();
  }
}

async function ensureBrowserNotificationPermission() {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) {
    status.value = 'This browser does not support notifications';
    return;
  }
  if (!window.isSecureContext) {
    status.value = 'Notifications require HTTPS (or localhost)';
    return;
  }

  if (Notification.permission === 'granted') {
    return;
  }

  if (Notification.permission === 'denied') {
    status.value = 'Notifications are blocked. Enable them in browser settings.';
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      status.value = 'Notifications enabled';
      return;
    }
    if (permission === 'denied') {
      status.value = 'Notification permission denied';
      return;
    }
    status.value = 'Notification permission dismissed';
  } catch {
    status.value = 'Unable to request notification permission';
  }
}

function toggleNotificationMenu() {
  if (notificationMenuOpen.value) {
    notificationMenuOpen.value = false;
    activeOverlayScreen.value = 'none';
  } else {
    notificationMenuOpen.value = true;
    activeOverlayScreen.value = 'notifications';
    if (hasEnabledNotificationTypes.value) {
      void ensureBrowserNotificationPermission();
    }
  }
}

function openNotificationSettings() {
  activeOverlayScreen.value = 'notifications';
  notificationMenuOpen.value = true;
  notificationPanelView.value = 'settings';
  void ensureBrowserNotificationPermission();
}

function closeNotificationMenu() {
  notificationMenuOpen.value = false;
  activeOverlayScreen.value = 'none';
}

function openFullNotifications() {
  notificationMenuOpen.value = false;
  openWalletListModal();
  setWalletModalView('notifications');
}

function handleNotificationClick(item: NotificationEventItem) {
  notificationEvents.value = notificationEvents.value.map((eventItem) =>
    eventItem.id === item.id ? { ...eventItem, read: true } : eventItem,
  );
  status.value = `${item.label}: ${item.message}`;
  closeNotificationMenu();
}

function markAllNotificationsRead() {
  const unreadIds = notificationUnreadIds.value;
  if (unreadIds.size === 0) return;
  notificationEvents.value = notificationEvents.value.map((eventItem) =>
    unreadIds.has(eventItem.id) ? { ...eventItem, read: true } : eventItem,
  );
  status.value = 'All notifications marked as read';
}

function onDocumentClick(event: MouseEvent) {
  if (!notificationMenuOpen.value) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (notificationMenuEl.value?.contains(target)) return;
  if (notificationsModalEl.value?.contains(target)) return;
  closeNotificationMenu();
}

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
  walletModalView.value = 'wallets';
  activeOverlayScreen.value = 'wallet-list';
  void refreshAllWalletBalances();
}

function setWalletModalView(view: 'wallets' | 'notifications') {
  walletModalView.value = view;
}

function setNotificationPanelView(view: 'list' | 'settings') {
  notificationPanelView.value = view;
}

function setSendModalTabView(view: 'send' | 'history') {
  sendModalTabView.value = view;
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

function openAllocationChartModal() {
  activeOverlayScreen.value = 'allocation-chart';
}

function closeAllocationChartModal() {
  if (activeOverlayScreen.value === 'allocation-chart') {
    activeOverlayScreen.value = 'none';
  }
}

function closeTokenListModal() {
  if (activeOverlayScreen.value === 'token-list') {
    activeOverlayScreen.value = 'none';
    showHiddenTokensInModal.value = false;
  }
  closeTokenDetail();
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
  sendModalTabView.value = 'send';
  sendTokenCategory.value = '';
  sendToAddress.value = '';
  sendBchAmount.value = '';
  sendUsdAmount.value = '';
  sendTokenAmount.value = '';
  sendDestinationMode.value = 'external';
  sendToWalletName.value = '';
  sendToWalletError.value = '';
  tokenSendHistoryError.value = '';
  activeOverlayScreen.value = 'send-asset';
  void loadTokenSendHistory();
}

function openSendAssetModalForToken(category: string) {
  sendMode.value = 'token';
  sendModalTabView.value = 'send';
  sendTokenCategory.value = category;
  sendToAddress.value = '';
  sendBchAmount.value = '';
  sendUsdAmount.value = '';
  sendTokenAmount.value = '';
  sendDestinationMode.value = 'external';
  sendToWalletName.value = '';
  sendToWalletError.value = '';
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

type DestinationResolution = {
  address: string | null;
  isLegacy: boolean;
  error: string | null;
};

// Base58Check version bytes for legacy ("1...", "3...") addresses.
const LEGACY_VERSION_MAINNET_P2PKH = 0x00;
const LEGACY_VERSION_MAINNET_P2SH = 0x05;
const LEGACY_VERSION_TESTNET_P2PKH = 0x6f;
const LEGACY_VERSION_TESTNET_P2SH = 0xc4;

function looksLikeLegacyAddress(input: string): boolean {
  // Legacy BCH/BTC-style Base58Check addresses: no ':' prefix, start with 1/3 (mainnet) or m/n/2 (testnet).
  return /^[123mn][a-km-zA-HJ-NP-Z1-9]{25,39}$/.test(input);
}

// Accepts a raw destination string as typed by the user and, if it's a legacy Base58 address,
// converts it to the equivalent CashAddress. CashAddress-format input (with or without a
// 'bitcoincash:'/'bchtest:' prefix) is passed through unchanged, since mainnet-js already
// validates that format at send time.
function resolveDestinationAddress(rawInput: string, isMainnet: boolean, wantsTokenSupport: boolean): DestinationResolution {
  const trimmed = rawInput.trim();
  if (!trimmed) return { address: null, isLegacy: false, error: null };
  if (!looksLikeLegacyAddress(trimmed)) {
    return { address: trimmed, isLegacy: false, error: null };
  }

  const decoded = base58AddressToLockingBytecode(trimmed);
  if (typeof decoded === 'string') {
    return { address: null, isLegacy: true, error: `Invalid legacy address: ${decoded}` };
  }

  const isTestnetVersion = decoded.version === LEGACY_VERSION_TESTNET_P2PKH || decoded.version === LEGACY_VERSION_TESTNET_P2SH;
  const isMainnetVersion = decoded.version === LEGACY_VERSION_MAINNET_P2PKH || decoded.version === LEGACY_VERSION_MAINNET_P2SH;
  if (!isTestnetVersion && !isMainnetVersion) {
    return { address: null, isLegacy: true, error: 'Unrecognized legacy address format' };
  }
  if (isMainnet && !isMainnetVersion) {
    return { address: null, isLegacy: true, error: 'This is a testnet legacy address, but the active wallet is mainnet' };
  }
  if (!isMainnet && !isTestnetVersion) {
    return { address: null, isLegacy: true, error: 'This is a mainnet legacy address, but the active wallet is testnet' };
  }

  const prefix = isMainnet ? 'bitcoincash' : 'bchtest';
  const encoded = lockingBytecodeToCashAddress({ bytecode: decoded.bytecode, prefix, tokenSupport: wantsTokenSupport });
  if (typeof encoded === 'string') {
    return { address: null, isLegacy: true, error: `Could not convert legacy address: ${encoded}` };
  }

  return { address: encoded.address, isLegacy: true, error: null };
}

function formatBchAmountPlain(bch: number): string {
  if (!Number.isFinite(bch) || bch <= 0) return '';
  const trimmed = bch.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return trimmed;
}

let isSyncingSendAmounts = false;

function onSendBchAmountInput(event: Event) {
  const target = event.target as HTMLInputElement;
  sendBchAmount.value = target.value;
  if (isSyncingSendAmounts) return;
  if (bchUsdRate.value === null) return;

  const sats = parseBchToSats(target.value);
  isSyncingSendAmounts = true;
  if (sats === null) {
    sendUsdAmount.value = '';
  } else {
    const usd = (Number(sats) / 100_000_000) * bchUsdRate.value;
    sendUsdAmount.value = usd > 0 ? usd.toFixed(2) : '';
  }
  isSyncingSendAmounts = false;
}

function onSendUsdAmountInput(event: Event) {
  const target = event.target as HTMLInputElement;
  sendUsdAmount.value = target.value;
  if (isSyncingSendAmounts) return;
  if (bchUsdRate.value === null || bchUsdRate.value <= 0) return;

  const trimmed = target.value.trim();
  isSyncingSendAmounts = true;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed) || Number(trimmed) <= 0) {
    sendBchAmount.value = '';
  } else {
    const bch = Number(trimmed) / bchUsdRate.value;
    sendBchAmount.value = formatBchAmountPlain(bch);
  }
  isSyncingSendAmounts = false;
}

function resetSendForm() {
  sendToAddress.value = '';
  sendBchAmount.value = '';
  sendUsdAmount.value = '';
  sendTokenAmount.value = '';
  sendDestinationMode.value = 'external';
  sendToWalletName.value = '';
  sendToWalletError.value = '';
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

function formatNotificationTime(createdAt: number): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

function onSendDestinationModeChange(value: string) {
  sendDestinationMode.value = value === 'wallet' ? 'wallet' : 'external';
  sendToWalletError.value = '';
  if (sendDestinationMode.value === 'external') {
    sendToWalletName.value = '';
    sendToAddress.value = '';
  } else if (!sendToWalletName.value && otherWalletOptions.value.length > 0) {
    sendToWalletName.value = otherWalletOptions.value[0].value;
  }
}

function onSendToWalletChange(value: string) {
  sendToWalletName.value = value;
}

async function resolveSendToWalletAddress() {
  if (sendDestinationMode.value !== 'wallet' || !sendToWalletName.value) return;

  const meta = getWalletMeta(sendToWalletName.value);
  if (!meta) {
    sendToWalletError.value = 'Selected wallet could not be found';
    sendToAddress.value = '';
    return;
  }

  isResolvingWalletAddress.value = true;
  sendToWalletError.value = '';
  try {
    const wallet = meta.type === 'hd' ? await HDWallet.named(meta.name) : await Wallet.named(meta.name);
    sendToAddress.value = sendMode.value === 'token' ? wallet.getTokenDepositAddress() : wallet.getDepositAddress();
  } catch (error) {
    sendToAddress.value = '';
    sendToWalletError.value = error instanceof Error ? error.message : 'Failed to load wallet address';
  } finally {
    isResolvingWalletAddress.value = false;
  }
}

watch([sendToWalletName, sendMode, sendDestinationMode], () => {
  if (sendDestinationMode.value === 'wallet') {
    void resolveSendToWalletAddress();
  }
});

async function sendBch() {
  if (!activeWallet.value) {
    status.value = 'No active wallet selected';
    return;
  }

  const isMainnet = activeWallet.value.network === NetworkType.Mainnet;
  const destination = sendDestinationMode.value === 'external'
    ? resolveDestinationAddress(sendToAddress.value, isMainnet, false)
    : { address: sendToAddress.value.trim(), isLegacy: false, error: null };
  const sats = parseBchToSats(sendBchAmount.value);
  if (destination.error) {
    status.value = destination.error;
    return;
  }
  const cashaddr = destination.address;
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
    const destinationSuffix = sendDestinationMode.value === 'wallet' && sendToWalletName.value ? ` to ${sendToWalletName.value}` : '';
    status.value = txId ? `BCH sent${destinationSuffix}. TxId: ${txId}` : `BCH sent${destinationSuffix}`;
    pushNotification('sendFunds', `You sent ${formatBchFromSats(sats)} BCH${destinationSuffix}.`);
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

  const isMainnet = activeWallet.value.network === NetworkType.Mainnet;
  const destination = sendDestinationMode.value === 'external'
    ? resolveDestinationAddress(sendToAddress.value, isMainnet, true)
    : { address: sendToAddress.value.trim(), isLegacy: false, error: null };
  const category = sendTokenCategory.value;
  const selectedToken = sendableTokens.value.find((token) => token.category === category);
  const amount = parseTokenAmount(sendTokenAmount.value, selectedToken?.decimals ?? 0);
  if (destination.error) {
    status.value = destination.error;
    return;
  }
  const cashaddr = destination.address;
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
    const destinationSuffix = sendDestinationMode.value === 'wallet' && sendToWalletName.value ? ` to ${sendToWalletName.value}` : '';
    status.value = txId ? `CashToken sent${destinationSuffix}. TxId: ${txId}` : `CashToken sent${destinationSuffix}`;
    pushNotification('sendFunds', `You sent ${formatTokenAmount(amount, selectedToken.decimals)} ${selectedToken.symbol ?? selectedToken.displayName}${destinationSuffix}.`);
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
  if (sendDestinationMode.value === 'wallet' && !sendToWalletName.value) {
    status.value = 'Select a destination wallet';
    return;
  }
  if (sendMode.value === 'token') {
    await sendCashToken();
    return;
  }
  await sendBch();
}

function fallbackTokenName(category: string): string {
  return `Token ${category.slice(0, 8)}`;
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

function persistFiatRateCache() {
  if (!fiatRateCache.value) return;
  localStorage.setItem(FIAT_RATE_CACHE_STORAGE_KEY, JSON.stringify(fiatRateCache.value));
}

function persistFiatCurrency() {
  localStorage.setItem(FIAT_CURRENCY_STORAGE_KEY, fiatCurrency.value);
}

async function getBchUsdRateWithCache() {
  const now = Date.now();
  const ttl = isMobileView.value ? USD_RATE_CACHE_TTL_MOBILE_MS : USD_RATE_CACHE_TTL_DESKTOP_MS;
  if (usdRateCache.value && now - usdRateCache.value.updatedAt < ttl) {
    return usdRateCache.value.rate;
  }

  try {
    const response = await fetch(COINPAPRIKA_BCH_TICKER_URL);
    const data = await response.json();
    const nextRate = typeof data?.quotes?.USD?.price === 'number' ? data.quotes.USD.price : null;
    if (nextRate === null || Number.isNaN(nextRate)) {
      throw new Error('Invalid BCH/USD rate from CoinPaprika');
    }

    usdRateCache.value = { rate: nextRate, updatedAt: now };
    persistUsdRateCache();
    return nextRate;
  } catch {
    const nextRate = await convert(1, 'bch', 'usd');
    usdRateCache.value = { rate: nextRate, updatedAt: now };
    persistUsdRateCache();
    return nextRate;
  }
}

async function getUsdToFiatRatesWithCache(forceRefresh = false) {
  const now = Date.now();
  const ttl = isMobileView.value ? USD_RATE_CACHE_TTL_MOBILE_MS : USD_RATE_CACHE_TTL_DESKTOP_MS;
  if (!forceRefresh && fiatRateCache.value && now - fiatRateCache.value.updatedAt < ttl) {
    return fiatRateCache.value.rates;
  }

  try {
    const response = await fetch(USD_FIAT_RATE_API_URL);
    const data = await response.json();
    const rates = data?.rates ?? {};
    const filteredRates: Record<string, number> = { USD: 1 };
    for (const currency of SUPPORTED_FIAT_CURRENCIES) {
      if (currency === 'USD') continue;
      const rate = rates[currency];
      if (typeof rate === 'number' && !Number.isNaN(rate)) {
        filteredRates[currency] = rate;
      }
    }
    fiatRateCache.value = { rates: filteredRates, updatedAt: now };
    persistFiatRateCache();
    return filteredRates;
  } catch {
    try {
      const response = await fetch(USD_FIAT_RATE_FALLBACK_URL);
      const data = await response.json();
      const rates = data?.rates ?? { USD: 1 };
      fiatRateCache.value = { rates, updatedAt: now };
      persistFiatRateCache();
      return rates;
    } catch {
      return { USD: 1 };
    }
  }
}

async function updateFiatRate(forceRefresh = false) {
  if (fiatCurrency.value === 'USD') {
    usdToFiatRate.value = 1;
    return;
  }

  try {
    const rates = await getUsdToFiatRatesWithCache(forceRefresh);
    usdToFiatRate.value = rates[fiatCurrency.value] ?? 1;
  } catch {
    usdToFiatRate.value = 1;
  }
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

async function openTokenDetail(asset: AssetItem) {
  if (asset.kind !== 'token' || !asset.category) return;

  tokenDetailAsset.value = asset;
  tokenDetailUrl.value = `${TOKEN_EXPLORER_BASE_URL}${asset.category}`;
  tokenDetailIframeSrc.value = '';
  tokenDetailError.value = '';
  tokenDetailLoading.value = true;
  tokenDetailOpen.value = true;

  try {
    // Best-effort fetch to confirm the detail page is reachable before loading it.
    await fetch(tokenDetailUrl.value, { mode: 'no-cors' });
  } catch {
    // tokenexplorer.cash may not expose CORS headers for a plain fetch; that's
    // fine, the iframe below loads the page directly as a normal navigation.
  } finally {
    tokenDetailIframeSrc.value = tokenDetailUrl.value;
    tokenDetailLoading.value = false;
  }
}

function closeTokenDetail() {
  tokenDetailOpen.value = false;
  tokenDetailAsset.value = null;
  tokenDetailUrl.value = '';
  tokenDetailIframeSrc.value = '';
  tokenDetailError.value = '';
  tokenDetailLoading.value = false;
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

function onAssetIconError(evt: Event, assetKey: string, assetIconUri?: string) {
  const img = evt?.target as HTMLImageElement | undefined;

  // If the uri looks like an IPFS gateway URL, attempt rotate through fallbacks
  try {
    if (assetIconUri) {
      const matched = IPFS_GATEWAYS_LIST.findIndex((g) => assetIconUri.startsWith(g));
      // If it matched a known gateway, or contains '/ipfs/' path, try alternatives
      if (matched >= 0 || assetIconUri.includes('/ipfs/')) {
        const originalHash = assetIconUri.includes('/ipfs/')
          ? assetIconUri.split('/ipfs/').pop() ?? ''
          : assetIconUri;
        const currentTry = Number(img?.dataset?.gatewayTryIndex ?? 0);
        const nextTry = currentTry + 1;
        if (nextTry < IPFS_GATEWAYS_LIST.length) {
          const nextSrc = `${IPFS_GATEWAYS_LIST[nextTry]}${originalHash}`;
          if (img) {
            img.dataset.gatewayTryIndex = String(nextTry);
            img.src = nextSrc;
            return; // don't mark as failed yet
          }
        }
      }
    }
  } catch {
    // fallthrough to marking failed
  }

  // final failure path: mark failed and optionally set a fallback icon
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
  if (img) {
    img.src = BCH_ICON_URI;
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

async function resolveScanTokenBalances(tokenCounts: Record<string, bigint>): Promise<ScanTokenBalance[]> {
  const entries = Object.entries(tokenCounts).filter(([, amount]) => amount > 0n);
  const resolved = await Promise.all(
    entries.map(async ([category, amount]) => {
      const meta = await fetchTokenName(category);
      return {
        category,
        displayName: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        amount,
      };
    }),
  );
  if (entries.length > 0) {
    persistTokenNameCache();
  }
  return resolved;
}

function formatScanTokenBalances(tokenBalances: ScanTokenBalance[]): string {
  if (tokenBalances.length === 0) return 'none';
  return tokenBalances.map((t) => `${t.symbol ?? t.displayName}: ${formatTokenAmount(t.amount, t.decimals)}`).join(', ');
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

function formatCurrency(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--';
  return value.toLocaleString(undefined, { style: 'currency', currency: fiatCurrency.value, maximumFractionDigits: 2 });
}

function formatUsd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'Not available';
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function formatUsdCompact(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--';
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
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
    const rawFiatRateCache = localStorage.getItem(FIAT_RATE_CACHE_STORAGE_KEY);
    if (rawFiatRateCache) {
      const parsed = JSON.parse(rawFiatRateCache) as FiatRateCache;
      if (parsed && typeof parsed === 'object' && typeof parsed.updatedAt === 'number') {
        fiatRateCache.value = parsed;
      }
    }
  } catch {
    fiatRateCache.value = null;
  }

  try {
    const rawFiatCurrency = localStorage.getItem(FIAT_CURRENCY_STORAGE_KEY);
    if (rawFiatCurrency && SUPPORTED_FIAT_CURRENCIES.includes(rawFiatCurrency)) {
      fiatCurrency.value = rawFiatCurrency;
    }
  } catch {
    fiatCurrency.value = DEFAULT_FIAT_CURRENCY;
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

  try {
    const rawNotificationSettings = localStorage.getItem(NOTIFICATION_SETTINGS_STORAGE_KEY);
    if (rawNotificationSettings) {
      const parsed = JSON.parse(rawNotificationSettings) as Partial<Record<NotificationSettingKey, boolean>>;
      notificationSettings.value = {
        sendFunds: parsed.sendFunds !== false,
        receiveFunds: parsed.receiveFunds !== false,
        walletConnectApproval: parsed.walletConnectApproval !== false,
      };
    }
  } catch {
    notificationSettings.value = {
      sendFunds: true,
      receiveFunds: true,
      walletConnectApproval: true,
    };
  }

  try {
    const rawNotificationEvents = localStorage.getItem(NOTIFICATION_EVENTS_STORAGE_KEY);
    if (rawNotificationEvents) {
      const parsed = JSON.parse(rawNotificationEvents) as NotificationEventItem[];
      if (Array.isArray(parsed)) {
        notificationEvents.value = parsed
          .filter((eventItem) =>
            eventItem &&
            typeof eventItem.id === 'string' &&
            (eventItem.type === 'sendFunds' || eventItem.type === 'receiveFunds' || eventItem.type === 'walletConnectApproval') &&
            typeof eventItem.label === 'string' &&
            typeof eventItem.message === 'string' &&
            typeof eventItem.icon === 'string' &&
            typeof eventItem.createdAt === 'number' &&
            typeof eventItem.read === 'boolean',
          )
          .slice(0, 60);
      }
    }
  } catch {
    notificationEvents.value = [];
  }
}

function resetNotificationBalanceBaseline() {
  previousBchBalance.value = null;
  previousTokenTotals.value = {};
  hasNotificationBalanceBaseline.value = false;
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

function getWalletBalanceEntry(name: string): WalletBalanceEntry {
  return walletBalances.value[name] ?? { sats: 0n, loading: false };
}

function walletFiatValue(sats: bigint): number | null {
  if (bchUsdRate.value === null) return null;
  return (Number(sats) / 100_000_000) * bchUsdRate.value * usdToFiatRate.value;
}

async function loadWalletBalanceEntry(walletName: string) {
  const meta = getWalletMeta(walletName);
  if (!meta) return;

  if (walletName === activeWalletName.value && activeWallet.value) {
    walletBalances.value = {
      ...walletBalances.value,
      [walletName]: { sats: bchBalance.value, loading: false },
    };
    return;
  }

  walletBalances.value = {
    ...walletBalances.value,
    [walletName]: { sats: getWalletBalanceEntry(walletName).sats, loading: true, error: undefined },
  };

  try {
    const wallet = meta.type === 'hd' ? await HDWallet.named(walletName) : await Wallet.named(walletName);
    const utxos = await wallet.getUtxos();
    const sats = utxos.filter((u) => u.token === undefined).reduce((sum, u) => sum + u.satoshis, 0n);
    walletBalances.value = {
      ...walletBalances.value,
      [walletName]: { sats, loading: false },
    };
  } catch (error) {
    walletBalances.value = {
      ...walletBalances.value,
      [walletName]: {
        sats: getWalletBalanceEntry(walletName).sats,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load balance',
      },
    };
  }
}

async function refreshAllWalletBalances() {
  if (bchUsdRate.value === null) {
    try {
      bchUsdRate.value = await getBchUsdRateWithCache();
    } catch {
      // Grand total will still show BCH amounts even if the fiat rate is unavailable.
    }
  }
  await Promise.all(wallets.value.map((w) => loadWalletBalanceEntry(w.name)));
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
  syncDerivationEditorFromActiveWallet();
  resetNotificationBalanceBaseline();
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
    const { [walletName]: _removedBalance, ...remainingBalances } = walletBalances.value;
    walletBalances.value = remainingBalances;
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
  status.value = 'Updating derivation and reloading wallet...';
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

async function applyScannedDerivationPath(result: DerivationScanResult) {
  if (!result.switchable) {
    derivationScanMessage.value = `${result.label} is a single detection-only key, not a receive chain - it can't be selected as the wallet's derivation path.`;
    return;
  }
  const inferred = inferDerivationSelection(result.parent);
  derivationUpdateType.value = inferred.type;
  customDerivationPathUpdate.value = inferred.customPath;
  derivationPathType.value = inferred.type;
  customDerivationPath.value = inferred.customPath;
  importWalletType.value = 'hd';
  derivationScanMessage.value = `Selected ${result.label}. HD wallet import is enabled to recover full BCH balance across the address chain.`;
}

async function scanImportDerivationPaths() {
  derivationScanResults.value = [];
  derivationScanMessage.value = '';

  const seed = importSeed.value.trim().replace(/\s+/g, ' ');
  if (!seed) {
    derivationScanMessage.value = 'Seed phrase is required to scan paths.';
    return;
  }

  isScanningDerivations.value = true;
  derivationScanMessage.value = 'Scanning common BIP44 derivation paths...';
  try {
    for (const candidate of DERIVATION_SCAN_CANDIDATES) {
      const scanResult: DerivationScanResult = {
        label: candidate.label,
        parent: candidate.parent,
        full: candidate.full,
        chain: candidate.chain,
        index: candidate.index,
        switchable: candidate.switchable,
        address: '',
        balanceSats: 0n,
        tokenBalances: [],
      };
      try {
        const wallet = await HDWallet.fromSeed(seed, candidate.parent, candidate.chain, candidate.index);
        const address = wallet.getDepositAddress(0);
        const utxos = await wallet.getUtxos();
        const bchBalance = utxos.filter((u) => u.token === undefined).reduce((sum, u) => sum + u.satoshis, 0n);
        const tokenCounts = utxos
          .filter((u) => u.token?.category)
          .reduce((acc, utxo) => {
            const category = utxo.token?.category ?? '';
            acc[category] = (acc[category] ?? 0n) + (utxo.token?.amount ?? 0n);
            return acc;
          }, {} as Record<string, bigint>);
        const tokenBalances = await resolveScanTokenBalances(tokenCounts);

        scanResult.address = address;
        scanResult.balanceSats = bchBalance;
        scanResult.tokenBalances = tokenBalances;
        await wallet.stop();
      } catch (error) {
        scanResult.error = error instanceof Error ? error.message : String(error);
      }
      derivationScanResults.value.push(scanResult);
    }
    derivationScanMessage.value = 'Scan complete.';
  } catch (error) {
    derivationScanMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    isScanningDerivations.value = false;
  }
}

async function scanActiveWalletDerivationPaths() {
  activeWalletScanResults.value = [];
  activeWalletScanMessage.value = '';

  const seed = activeSeedPhrase.value?.trim().replace(/\s+/g, ' ');
  if (!seed) {
    activeWalletScanMessage.value = 'Seed phrase unavailable for this wallet; scanning requires an HD/seed-based wallet.';
    return;
  }

  isScanningActiveWalletDerivations.value = true;
  activeWalletScanMessage.value = 'Scanning common BIP44 derivation paths for missing funds...';
  try {
    for (const candidate of DERIVATION_SCAN_CANDIDATES) {
      const scanResult: DerivationScanResult = {
        label: candidate.label,
        parent: candidate.parent,
        full: candidate.full,
        chain: candidate.chain,
        index: candidate.index,
        switchable: candidate.switchable,
        address: '',
        balanceSats: 0n,
        tokenBalances: [],
      };
      try {
        const wallet = await HDWallet.fromSeed(seed, candidate.parent, candidate.chain, candidate.index);
        const address = wallet.getDepositAddress(0);
        const utxos = await wallet.getUtxos();
        const bchBalance = utxos.filter((u) => u.token === undefined).reduce((sum, u) => sum + u.satoshis, 0n);
        const tokenCounts = utxos
          .filter((u) => u.token?.category)
          .reduce((acc, utxo) => {
            const category = utxo.token?.category ?? '';
            acc[category] = (acc[category] ?? 0n) + (utxo.token?.amount ?? 0n);
            return acc;
          }, {} as Record<string, bigint>);
        const tokenBalances = await resolveScanTokenBalances(tokenCounts);

        scanResult.address = address;
        scanResult.balanceSats = bchBalance;
        scanResult.tokenBalances = tokenBalances;
        await wallet.stop();
      } catch (error) {
        scanResult.error = error instanceof Error ? error.message : String(error);
      }
      activeWalletScanResults.value.push(scanResult);
    }
    activeWalletScanMessage.value = activeWalletScanFundedCount.value > 0
      ? `Scan complete. Found funds on ${activeWalletScanFundedCount.value} of ${activeWalletScanResults.value.length} paths checked.`
      : 'Scan complete. No funds found on any of the common derivation paths checked.';
  } catch (error) {
    activeWalletScanMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    isScanningActiveWalletDerivations.value = false;
  }
}

async function switchActiveWalletToScannedPath(result: DerivationScanResult) {
  if (isUpdatingDerivation.value) return;
  if (!result.switchable) {
    activeWalletScanMessage.value = `${result.label} is a single detection-only key, not a receive chain - it can't be switched onto.`;
    return;
  }
  const inferred = inferDerivationSelection(result.parent);
  derivationUpdateType.value = inferred.type;
  customDerivationPathUpdate.value = inferred.customPath;
  await updateActiveWalletDerivationPath();
}

async function refreshBalancesAndTokens() {
  if (!activeWallet.value) return;
  const shouldEmitReceiveNotifications = hasNotificationBalanceBaseline.value;
  const utxos = await activeWallet.value.getUtxos();
  const nextBchBalance = utxos
    .filter((u) => u.token === undefined)
    .reduce((sum, u) => sum + u.satoshis, 0n);
  bchBalance.value = nextBchBalance;
  if (activeWalletName.value) {
    walletBalances.value = {
      ...walletBalances.value,
      [activeWalletName.value]: { sats: nextBchBalance, loading: false },
    };
  }

  if (shouldEmitReceiveNotifications && previousBchBalance.value !== null && nextBchBalance > previousBchBalance.value) {
    const delta = nextBchBalance - previousBchBalance.value;
    pushNotification('receiveFunds', `You received ${formatBchFromSats(delta)} BCH.`);
  }
  previousBchBalance.value = nextBchBalance;

  try {
    const oneBchInUsd = await getBchUsdRateWithCache();
    bchUsdRate.value = oneBchInUsd;
    const balanceBch = Number(bchBalance.value) / 100_000_000;
    usdBalance.value = balanceBch * oneBchInUsd;
    await updateFiatRate();
    fiatBalance.value = usdBalance.value !== null ? usdBalance.value * usdToFiatRate.value : null;
  } catch {
    bchUsdRate.value = null;
    usdBalance.value = null;
    fiatBalance.value = null;
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
  const nextTokenTotals: Record<string, bigint> = Object.fromEntries(nextTokenList.map((token) => [token.category, token.fungibleAmount]));
  if (shouldEmitReceiveNotifications) {
    for (const token of nextTokenList) {
      const previousAmount = previousTokenTotals.value[token.category] ?? 0n;
      if (token.fungibleAmount > previousAmount) {
        const delta = token.fungibleAmount - previousAmount;
        const amountText = formatTokenAmount(delta, token.decimals);
        pushNotification('receiveFunds', `You received ${amountText} ${token.symbol ?? token.displayName}.`);
      }
    }
  }
  previousTokenTotals.value = nextTokenTotals;
  hasNotificationBalanceBaseline.value = true;
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

function dequeueWcConnectionProposal(id: number) {
  pendingWcConnectionProposals.value = pendingWcConnectionProposals.value.filter((item) => item.id !== id);
}

async function approvePendingWcConnectionProposal() {
  if (!walletKit.value || !pendingWcConnectionProposal.value || isHandlingWcConnectionProposal.value) return;
  isHandlingWcConnectionProposal.value = true;
  const proposal = pendingWcConnectionProposal.value;
  try {
    const namespaces = getWalletConnectNamespaces();
    await walletKit.value.approveSession({ id: proposal.id, namespaces });
    dequeueWcConnectionProposal(proposal.id);
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
    dequeueWcConnectionProposal(proposal.id);
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

      // Cap the queue so a burst of proposals (e.g. a malicious/broken dApp) can't be used
      // to spam unbounded pending approvals into memory.
      const MAX_PENDING_WC_PROPOSALS = 5;
      if (pendingWcConnectionProposals.value.length >= MAX_PENDING_WC_PROPOSALS) {
        await instance.rejectSession({
          id: proposal.id,
          reason: { code: 5000, message: 'Too many pending connection approvals.' },
        });
        status.value = `WalletConnect request from ${appName} was rejected: too many pending approvals`;
        return;
      }

      // Multiple dApps can each have their own connection proposal queued for review;
      // approving/pairing one does not affect another dApp's existing sessions or proposals.
      pendingWcConnectionProposals.value = [
        ...pendingWcConnectionProposals.value,
        { id: proposal.id, appName, appUrl, appIcon },
      ];
      pushNotification('walletConnectApproval', `${appName} wants to connect to your wallet.`);
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
  document.addEventListener('click', onDocumentClick);
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

watch([fiatCurrency, usdBalance], async ([currency, usd]) => {
  if (usd === null) {
    fiatBalance.value = null;
    return;
  }

  await updateFiatRate();
  fiatBalance.value = usd * usdToFiatRate.value;
});

watch(notificationEvents, () => {
  persistNotificationEvents();
}, { deep: true });

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportState);
  document.removeEventListener('click', onDocumentClick);
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
});
</script>

<template>
  <main class="app-shell" :class="{ 'compact-mobile': mobileCompactMode }">
    <div class="topbar-simple">
      <div class="top-wallet-group" role="group" aria-label="Wallet actions">
        <button class="top-receive-btn" @click="openReceiveModal" title="Receive BCH" aria-label="Receive BCH">
          <FontAwesomeIcon :icon="['fas', 'wallet']" class="top-connect-icon" />
        </button>
        <button class="top-wallet-btn" @click="openWalletListModal" title="Select Wallet" aria-label="Select Wallet">
          <span class="top-wallet-text">
            <span class="top-wallet-caption">My Purze</span>
            <span class="top-wallet-current">{{ currentWalletButtonLabel }}</span>
          </span>
        </button>
      </div>
    </div>

    

    <div class="home-stack">
      <section class="glass-card active-wallet-card">
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
            <strong>Derivation:</strong>
            <UiSelect
              id="active-derivation-select"
              class="active-derivation-inline-select"
              :model-value="derivationUpdateType"
              :options="derivationOptions"
              @update:modelValue="onDerivationUpdateTypeChangeAndApply"
            />
          </div>
          <!--
          <div class="row fiat-currency-row">
            <label for="fiat-currency-select">Fiat currency</label>
            <UiSelect
              id="fiat-currency-select"
              class="currency-select"
              :model-value="fiatCurrency"
              :options="currencyOptions"
              @update:modelValue="onFiatCurrencyChange"
            />
          </div>
          -->
          <div class="row active-derivation-custom-row" v-if="derivationUpdateType === 'custom'">
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
        </div>
        <div v-else class="hint">Create or import a wallet to get started.</div>
      </section>

      <section class="glass-card tokens-preview-card">
        <div class="tokens-preview-head">
          <div class="tokens-preview-head-left">
            <h3><FontAwesomeIcon :icon="['fas', 'coins']" class="icon-title" />Tokens</h3>
          </div>
          <div class="tokens-preview-head-right">
            <span class="tokens-preview-usd">{{ formatCurrency(fiatBalance) }}</span>
            <button class="tiny-btn" @click="openAllocationChartModal" :disabled="assetItems.length === 0" title="Fund allocation" aria-label="Show fund allocation chart">
              <FontAwesomeIcon :icon="['fas', 'chart-pie']" class="icon-btn" />
            </button>
            <button class="tiny-btn" @click="openTokenListModal" :disabled="assetItems.length === 0">View all</button>
          </div>
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
                @error="onAssetIconError($event, asset.key, asset.iconUri)"
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
                @error="onAssetIconError($event, asset.key, asset.iconUri)"
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

    <footer class="status-menu" aria-label="Purze status menu">
      <div class="brand-chip status-brand-chip">
        <a
          class="brand-icon-wrap status-brand-link"
          href="https://github.com/invalidcastvibe/purze"
          target="_blank"
          rel="noopener noreferrer"
          title="Open Purze GitHub repository"
          aria-label="Open Purze GitHub repository"
        >
          <FontAwesomeIcon :icon="['fas', 'wallet']" class="brand-icon" />
        </a>
        <div class="brand-copy status-brand-copy" aria-hidden="true">
          <strong class="brand-name status-brand-name">Purze</strong>
          <span class="brand-tagline status-brand-tagline">Pocket BCH purse</span>
        </div>
      </div>
      <div class="status-pills" role="list" aria-label="Wallet status indicators">
        <button
          class="status-pill"
          role="listitem"
          type="button"
          @click="openWalletListModal"
          :title="activeWalletName ? `Wallet: ${activeWalletName}` : 'No active wallet selected'"
          :aria-label="activeWalletName ? `Wallet: ${activeWalletName}` : 'No active wallet selected'"
        >
          <FontAwesomeIcon :icon="['fas', 'user']" class="status-pill-icon" />
        </button>
        <button
          class="status-pill"
          role="listitem"
          type="button"
          :class="{ 'status-pill-live': hasActiveWcSessions }"
          @click="openWalletConnectModal"
          :title="hasActiveWcSessions ? `WalletConnect live with ${wcSessionCount} sessions` : 'WalletConnect offline'"
          :aria-label="hasActiveWcSessions ? `WalletConnect live with ${wcSessionCount} sessions` : 'WalletConnect offline'"
        >
          <FontAwesomeIcon :icon="['fas', 'link']" class="status-pill-icon" />
          <span v-if="hasActiveWcSessions" class="status-pill-dot" aria-hidden="true"></span>
        </button>
        <div class="notification-wrap" ref="notificationMenuEl" role="listitem">
          <button
            class="status-pill"
            type="button"
            :class="{ 'status-pill-alert': notificationCount > 0 || pendingWcRequests.length > 0 }"
            @click="toggleNotificationMenu"
            :title="notificationCount > 0 ? `${notificationCount} unread notifications` : 'No unread notifications'"
            :aria-label="notificationCount > 0 ? `${notificationCount} unread notifications` : 'No unread notifications'"
            aria-haspopup="menu"
          >
            <FontAwesomeIcon :icon="['fas', 'bell']" class="status-pill-icon" />
            <span v-if="notificationCount > 0" class="status-pill-badge" aria-hidden="true">{{ notificationCount }}</span>
          </button>
          <button
            class="status-pill notification-settings-shortcut"
            type="button"
            @click="openNotificationSettings"
            title="Notification settings"
            aria-label="Notification settings"
          >
            <FontAwesomeIcon :icon="['fas', 'sliders']" class="status-pill-icon" />
          </button>
        </div>
      </div>
    </footer>

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

        <div class="wallet-modal-tabs" role="tablist" aria-label="Wallet modal sections">
          <button
            class="wallet-modal-tab"
            :class="{ active: walletModalView === 'wallets' }"
            role="tab"
            :aria-selected="walletModalView === 'wallets'"
            @click="setWalletModalView('wallets')"
          >
            Wallets
          </button>
          <button
            class="wallet-modal-tab"
            :class="{ active: walletModalView === 'notifications' }"
            role="tab"
            :aria-selected="walletModalView === 'notifications'"
            @click="setWalletModalView('notifications')"
          >
            Notification settings
          </button>
        </div>

        <div class="manage-wallet-info wallet-list-panel">
          <div v-if="walletModalView === 'wallets' && wallets.length === 0" class="hint">No wallets yet.</div>

          <div v-if="walletModalView === 'wallets' && wallets.length > 0" class="wallet-grand-total">
            <div class="wallet-grand-total-copy">
              <span class="wallet-grand-total-label">
                Total across {{ wallets.length }} wallet{{ wallets.length === 1 ? '' : 's' }}
              </span>
              <span class="wallet-grand-total-amount">
                {{ formatBchFromSats(grandTotalSats) }} BCH
                <span v-if="grandTotalFiat !== null" class="wallet-grand-total-fiat">≈ {{ formatCurrency(grandTotalFiat) }}</span>
              </span>
            </div>
            <button
              class="tiny-btn wallet-grand-total-refresh"
              type="button"
              @click="refreshAllWalletBalances"
              :disabled="isLoadingWalletBalances"
              title="Refresh wallet balances"
              aria-label="Refresh wallet balances"
            >
              <FontAwesomeIcon :icon="['fas', 'rotate']" class="icon-btn" :class="{ 'icon-spin': isLoadingWalletBalances }" />
            </button>
          </div>

          <ul v-if="walletModalView === 'wallets' && wallets.length > 0" class="wallet-list">
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
                  <div class="wallet-item-balance">
                    <span v-if="getWalletBalanceEntry(wallet.name).loading" class="hint">Loading balance…</span>
                    <span v-else-if="getWalletBalanceEntry(wallet.name).error" class="wallet-item-balance-error">Balance unavailable</span>
                    <span v-else class="wallet-item-balance-amount">
                      {{ formatBchFromSats(getWalletBalanceEntry(wallet.name).sats) }} BCH
                      <template v-if="walletFiatValue(getWalletBalanceEntry(wallet.name).sats) !== null">
                        · {{ formatCurrency(walletFiatValue(getWalletBalanceEntry(wallet.name).sats)) }}
                      </template>
                    </span>
                  </div>
                </div>
                <div class="wallet-item-actions">
                  <button class="tiny-btn wallet-row-btn" @click.stop="closeWalletListModal(); openWalletActionSheet(wallet.name)" title="Manage wallet" aria-label="Manage wallet">
                    <FontAwesomeIcon :icon="['fas', 'bars']" class="icon-btn" />
                  </button>
                </div>
              </div>
            </li>
          </ul>

          <section
            v-if="walletModalView === 'notifications'"
            class="wallet-notification-settings wallet-notification-settings-panel"
            aria-label="Notification settings"
          >
            <div class="wallet-notification-settings-head">
              <strong>Notification Settings</strong>
              <span class="hint">Control what appears in the bell list</span>
            </div>
            <div class="wallet-notification-setting" v-for="item in allNotificationItems" :key="`notif-setting-${item.id}`">
              <span class="wallet-notification-setting-label">
                <FontAwesomeIcon :icon="['fas', item.icon]" class="notification-item-icon" />
                {{ item.label }}
              </span>
              <label class="toggle-switch" :for="`notif-toggle-${item.id}`">
                <input
                  class="toggle-switch-input"
                  type="checkbox"
                  :id="`notif-toggle-${item.id}`"
                  :checked="notificationSettings[item.settingKey]"
                  @change="onNotificationSettingToggle(item.settingKey, $event)"
                />
                <span class="toggle-switch-slider" aria-hidden="true"></span>
              </label>
            </div>
          </section>
        </div>

        <button v-if="walletModalView === 'wallets'" class="action-sheet-btn" @click="closeWalletListModal(); openCreateImportModal()">
          <FontAwesomeIcon :icon="['fas', 'plus']" class="icon-btn" />Add / Import Wallet
        </button>
      </dialog>
    </div>

    <div v-if="activeOverlayScreen === 'notifications'" class="action-sheet-overlay" @click.self="closeNotificationMenu">
      <dialog class="action-sheet notifications-modal" ref="notificationsModalEl" open aria-label="Notifications">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">Notifications</strong>
            <span class="action-sheet-subtitle">Recent alerts and settings</span>
          </div>
          <button class="icon-close" @click="closeNotificationMenu" aria-label="Close notifications">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <section class="manage-wallet-info">
          <div class="wallet-notifications-tabs-row">
            <div class="wallet-modal-tabs wallet-notifications-tabs" role="tablist" aria-label="Notification sections">
              <button
                class="wallet-modal-tab"
                :class="{ active: notificationPanelView === 'list' }"
                role="tab"
                :aria-selected="notificationPanelView === 'list'"
                @click="setNotificationPanelView('list')"
                type="button"
              >
                List
              </button>
              <button
                class="wallet-modal-tab"
                :class="{ active: notificationPanelView === 'settings' }"
                role="tab"
                :aria-selected="notificationPanelView === 'settings'"
                @click="setNotificationPanelView('settings')"
                type="button"
              >
                Settings
              </button>
            </div>
            <button
              v-if="notificationCount > 0 && notificationPanelView === 'list'"
              class="notification-mark-read-btn"
              @click="markAllNotificationsRead"
              type="button"
            >
              Mark all as read
            </button>
          </div>

          <div v-if="notificationPanelView === 'list'">
            <div class="notification-list-controls">
              <div class="notification-filter">
                <button :class="{ active: notificationListFilter === 'unread' }" @click="notificationListFilter = 'unread'">Unread</button>
                <button :class="{ active: notificationListFilter === 'all' }" @click="notificationListFilter = 'all'">All</button>
              </div>
              <div class="notification-pagination-info">
                <span>Page {{ notificationPage }} / {{ notificationTotalPages }}</span>
              </div>
            </div>

            <div v-if="filteredNotificationEvents.length === 0" class="notification-empty">
              {{ hasEnabledNotificationTypes ? 'No notifications.' : 'All notification types are turned off.' }}
            </div>

            <div v-else class="wallet-notification-list">
              <button
                v-for="item in displayedNotifications"
                :key="item.id"
                class="wallet-notification-item"
                :class="{ 'is-unread': !item.read }"
                @click="handleNotificationClick(item)"
                type="button"
              >
                <span class="notification-item-avatar" aria-hidden="true">
                  <FontAwesomeIcon :icon="['fas', item.icon]" class="notification-item-icon" />
                </span>
                <span class="notification-item-content">
                  <span class="notification-item-message">{{ item.message }}</span>
                  <span class="notification-item-meta">
                    <span class="notification-item-label">{{ item.label }}</span>
                    <span class="notification-item-time">{{ formatNotificationTime(item.createdAt) }}</span>
                  </span>
                </span>
                <span v-if="!item.read" class="notification-unread-dot" aria-hidden="true"></span>
              </button>
            </div>

            <div class="wallet-notification-pagination">
              <button class="tiny-btn" :disabled="notificationPage <= 1" @click="notificationPage = Math.max(1, notificationPage - 1)">Prev</button>
              <button class="tiny-btn" :disabled="notificationPage >= notificationTotalPages" @click="notificationPage = Math.min(notificationTotalPages, notificationPage + 1)">Next</button>
              <span class="hint">Showing {{ displayedNotifications.length }} of {{ filteredNotificationEvents.length }} notifications</span>
            </div>
          </div>

          <div v-if="notificationPanelView === 'settings'" class="wallet-notification-settings wallet-notification-settings-panel" aria-label="Notification settings">
            <div class="wallet-notification-settings-head">
              <strong>Notification Settings</strong>
              <span class="hint">Control what appears in the bell list</span>
            </div>
            <div class="wallet-notification-setting" v-for="item in allNotificationItems" :key="`notif-setting-${item.id}`">
              <span class="wallet-notification-setting-label">
                <FontAwesomeIcon :icon="['fas', item.icon]" class="notification-item-icon" />
                {{ item.label }}
              </span>
              <label class="toggle-switch" :for="`notif-toggle-${item.id}`">
                <input
                  class="toggle-switch-input"
                  type="checkbox"
                  :id="`notif-toggle-${item.id}`"
                  :checked="notificationSettings[item.settingKey]"
                  @change="onNotificationSettingToggle(item.settingKey, $event)"
                />
                <span class="toggle-switch-slider" aria-hidden="true"></span>
              </label>
            </div>
            <div class="wallet-notification-footer">
              <button class="tiny-btn" @click="setNotificationPanelView('list')">Back to list</button>
            </div>
          </div>
        </section>
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
                  @error="onAssetIconError($event, asset.key, asset.iconUri)"
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
                  @error="onAssetIconError($event, asset.key, asset.iconUri)"
                />
                <FontAwesomeIcon v-else :icon="['fas', 'coins']" />
              </div>
              <div class="token-info-grid">
                <div class="token-main-line">
                  <div class="token-card-title">
                    <span v-if="asset.kind === 'token' && asset.category && isTokenCategoryFavorite(asset.category)" class="token-favorite-badge" title="Favorite token" aria-label="Favorite token">
                      <FontAwesomeIcon :icon="['fas', 'star']" />
                    </span>
                    <button
                      v-if="asset.kind === 'token' && asset.category"
                      type="button"
                      class="token-name-link"
                      @click="openTokenDetail(asset)"
                      :aria-label="`View details for ${asset.displayName}`"
                      :title="`View details for ${asset.displayName}`"
                    >
                      {{ asset.displayName }}<span v-if="asset.symbol"> ({{ asset.symbol }})</span>
                    </button>
                    <template v-else>
                      {{ asset.displayName }}<span v-if="asset.symbol"> ({{ asset.symbol }})</span>
                    </template>
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
                    @error="onAssetIconError($event, asset.key, asset.iconUri)"
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
                    @error="onAssetIconError($event, asset.key, asset.iconUri)"
                  />
                  <FontAwesomeIcon v-else :icon="['fas', 'coins']" />
                </div>
                <div class="token-info-grid">
                  <div class="token-main-line">
                    <div class="token-card-title">
                      <span v-if="asset.kind === 'token' && asset.category && isTokenCategoryFavorite(asset.category)" class="token-favorite-badge" title="Favorite token" aria-label="Favorite token">
                        <FontAwesomeIcon :icon="['fas', 'star']" />
                      </span>
                      <button
                        v-if="asset.kind === 'token' && asset.category"
                        type="button"
                        class="token-name-link"
                        @click="openTokenDetail(asset)"
                        :aria-label="`View details for ${asset.displayName}`"
                        :title="`View details for ${asset.displayName}`"
                      >
                        {{ asset.displayName }}<span v-if="asset.symbol"> ({{ asset.symbol }})</span>
                      </button>
                      <template v-else>
                        {{ asset.displayName }}<span v-if="asset.symbol"> ({{ asset.symbol }})</span>
                      </template>
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

    <div v-if="activeOverlayScreen === 'allocation-chart'" class="action-sheet-overlay" @click.self="closeAllocationChartModal">
      <dialog class="action-sheet allocation-chart-modal" open aria-label="Fund allocation">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">Fund Allocation</strong>
            <span class="action-sheet-subtitle">{{ activeWalletName || 'Active wallet' }}</span>
          </div>
          <button class="icon-close" @click="closeAllocationChartModal" aria-label="Close fund allocation">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="manage-wallet-info">
          <p class="hint" v-if="!activeWallet">Select a wallet to see its fund allocation.</p>
          <WalletAllocationChart
            v-else
            :wallet-name="activeWalletName || 'this wallet'"
            :entries="walletAllocationEntries"
            :value-weighted="walletAllocationUsesValueWeighting"
          />
        </div>
      </dialog>
    </div>

    <div v-if="tokenDetailOpen" class="action-sheet-overlay token-detail-overlay" @click.self="closeTokenDetail">
      <dialog class="action-sheet token-detail-modal" open aria-label="Token detail">
        <div class="action-sheet-header">
          <div class="action-sheet-title-wrap">
            <strong class="action-sheet-title">{{ tokenDetailAsset?.displayName || 'Token Detail' }}</strong>
            <span class="action-sheet-subtitle">From tokenexplorer.cash</span>
          </div>
          <button class="icon-close" @click="closeTokenDetail" aria-label="Close token detail">
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </div>

        <div class="token-detail-body">
          <p class="hint" v-if="tokenDetailLoading">Loading token detail...</p>
          <p class="hint" v-else-if="tokenDetailError">{{ tokenDetailError }}</p>
          <iframe
            v-if="tokenDetailIframeSrc"
            :src="tokenDetailIframeSrc"
            class="token-detail-iframe"
            title="Token explorer detail"
            referrerpolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups"
          ></iframe>
          <p class="hint token-detail-link-hint" v-if="tokenDetailUrl">
            If the detail doesn't load,
            <a :href="tokenDetailUrl" target="_blank" rel="noopener noreferrer">open it in a new tab</a>.
          </p>
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

        <div class="wallet-notifications-tabs-row send-modal-tabs-row">
          <div class="wallet-modal-tabs" role="tablist" aria-label="Send sections">
            <button
              class="wallet-modal-tab"
              :class="{ active: sendModalTabView === 'send' }"
              role="tab"
              :aria-selected="sendModalTabView === 'send'"
              @click="setSendModalTabView('send')"
              type="button"
            >
              Send
            </button>
            <button
              class="wallet-modal-tab"
              :class="{ active: sendModalTabView === 'history' }"
              role="tab"
              :aria-selected="sendModalTabView === 'history'"
              @click="setSendModalTabView('history')"
              type="button"
            >
              Recent Transactions
            </button>
          </div>
        </div>

        <div class="manage-wallet-info" v-if="sendModalTabView === 'send'">
          <div class="row" v-if="hasOtherWallets">
            <label for="send-modal-destination-mode-select">Send To</label>
            <UiSelect
              class="compact-select"
              id="send-modal-destination-mode-select"
              :model-value="sendDestinationMode"
              :options="sendDestinationModeOptions"
              @update:modelValue="onSendDestinationModeChange"
            />
          </div>

          <div class="row" v-if="sendDestinationMode === 'wallet' && hasOtherWallets">
            <label for="send-modal-to-wallet-select">Destination Wallet</label>
            <UiSelect
              class="compact-select"
              id="send-modal-to-wallet-select"
              :model-value="sendToWalletName"
              :options="otherWalletOptions"
              @update:modelValue="onSendToWalletChange"
            />
            <p class="hint" v-if="isResolvingWalletAddress">Looking up wallet address...</p>
            <p class="hint" v-else-if="sendToWalletError">{{ sendToWalletError }}</p>
            <p class="hint" v-else-if="sendToAddress">Sending to: {{ sendToAddress }}</p>
          </div>

          <div class="row" v-if="sendDestinationMode === 'external'">
            <label for="send-modal-to-address-input">{{ sendMode === 'token' ? 'To Token Address' : 'To BCH Address' }}</label>
            <input
              id="send-modal-to-address-input"
              v-model="sendToAddress"
              :placeholder="sendMode === 'token' ? 'bitcoincash:... token address (legacy 1.../3... also accepted)' : 'bitcoincash:... BCH address (legacy 1.../3... also accepted)'"
            />
            <p class="hint" v-if="externalSendAddressResolution.error">{{ externalSendAddressResolution.error }}</p>
            <p class="hint" v-else-if="externalSendAddressResolution.isLegacy && externalSendAddressResolution.address">Legacy address converted to: {{ externalSendAddressResolution.address }}</p>
          </div>

          <div class="row" v-if="sendMode === 'bch'">
            <label for="send-modal-bch-amount-input">Amount (BCH)</label>
            <input
              id="send-modal-bch-amount-input"
              :value="sendBchAmount"
              @input="onSendBchAmountInput"
              placeholder="0.00001"
              inputmode="decimal"
            />
            <p class="hint">Available: {{ formatBchFromSats(bchBalance) }} BCH</p>
          </div>

          <div class="row" v-if="sendMode === 'bch'">
            <label for="send-modal-usd-amount-input">Amount (USD equivalent)</label>
            <input
              id="send-modal-usd-amount-input"
              :value="sendUsdAmount"
              @input="onSendUsdAmountInput"
              :placeholder="bchUsdRate === null ? 'Rate unavailable' : '0.00'"
              :disabled="bchUsdRate === null"
              inputmode="decimal"
            />
            <p class="hint" v-if="bchUsdRate !== null">1 BCH &asymp; {{ formatUsd(bchUsdRate) }}</p>
            <p class="hint" v-else>USD rate is unavailable right now, so this field is disabled.</p>
          </div>

          <div class="row" v-else>
            <label for="send-modal-token-amount-input">Amount{{ selectedSendToken ? ` (${selectedSendToken.decimals} decimals)` : '' }}</label>
            <input id="send-modal-token-amount-input" v-model="sendTokenAmount" :placeholder="selectedSendToken?.decimals ? '1.0' : '1'" />
            <p class="hint" v-if="selectedSendToken">
              Available: {{ formatTokenAmount(selectedSendToken.fungibleAmount, selectedSendToken.decimals) }}{{ selectedSendToken.symbol ? ` ${selectedSendToken.symbol}` : '' }}
            </p>
          </div>

          <button @click="sendFunds" :disabled="isSendingFunds || (sendMode === 'token' && sendableTokens.length === 0) || (sendDestinationMode === 'wallet' && (isResolvingWalletAddress || !sendToAddress || !!sendToWalletError)) || (sendDestinationMode === 'external' && (!sendToAddress.trim() || !!externalSendAddressResolution.error))">
            <FontAwesomeIcon :icon="['fas', isSendingFunds ? 'rotate' : 'paper-plane']" class="icon-btn" />
            {{ isSendingFunds ? 'Sending...' : (sendMode === 'token' ? 'Send CashToken' : 'Send BCH') }}
          </button>

        </div>

        <div class="manage-wallet-info send-history-card" v-if="sendModalTabView === 'history' && (sendMode === 'token' || sendMode === 'bch')">
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
            <span v-if="pendingWcConnectionProposalCount > 1" class="wallet-tag">+{{ pendingWcConnectionProposalCount - 1 }} more waiting</span>
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
              <span class="hint">{{ wcSessionCount === 0 ? 'Paste a WalletConnect URI from the webapp' : 'Paste another WalletConnect URI to add a dApp' }}</span>
            </div>
          </div>
          <div v-if="hasPendingWcConnectionProposal" class="wc-connected-summary">
            <p class="hint">A connection request is waiting above. Approve or reject it to continue.</p>
          </div>
          <template v-else>
            <div class="wc-connected-summary" v-if="wcSessionCount > 0">
              <div class="manage-field">
                <span class="manage-label">Connected dApp{{ wcSessionCount > 1 ? 's' : '' }}</span>
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
            <div class="row wc-uri-row">
              <label for="wc-uri-input" class="wc-uri-label"><FontAwesomeIcon :icon="['fas', 'copy']" class="wc-inline-icon" />Paste WalletConnect URI Here</label>
              <input id="wc-uri-input" class="wc-uri-input" v-model="wcUri" placeholder="wc:..." />
            </div>
            <p class="hint wc-uri-hint">Tip: Copy the full URI from the webapp and paste it into the highlighted field above.</p>
            <button @click="pairWalletConnect" :disabled="!activeWallet || !wcUri.trim()"><FontAwesomeIcon :icon="['fas', 'plug']" class="icon-btn" />Pair and Connect</button>
            <p class="hint" v-if="!activeWallet">Select a wallet first before pairing.</p>
          </template>
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

            <div class="derivation-scan-section" v-if="manageWalletDetails?.isActive">
              <div class="row derivation-scan-row">
                <button
                  class="action-sheet-btn"
                  type="button"
                  @click="scanActiveWalletDerivationPaths"
                  :disabled="isScanningActiveWalletDerivations || !activeSeedPhrase"
                >
                  <FontAwesomeIcon :icon="['fas', 'magnifying-glass']" class="icon-btn" />
                  {{ isScanningActiveWalletDerivations ? 'Scanning paths...' : 'Scan for Missing Funds' }}
                </button>
                <p class="hint" v-if="!activeSeedPhrase">Seed phrase unavailable for this wallet; scanning requires an HD/seed-based wallet.</p>
              </div>
              <p class="hint" v-if="activeWalletScanMessage">{{ activeWalletScanMessage }}</p>

              <details class="scan-results scan-results-details" v-if="activeWalletScanResults.length > 0" open>
                <summary class="scan-results-summary">
                  Scan results
                  <span class="scan-results-count">{{ activeWalletScanFundedCount }} of {{ activeWalletScanResults.length }} paths with funds</span>
                </summary>
                <div class="scan-table-wrap">
                  <table class="scan-table">
                    <thead>
                      <tr>
                        <th>Path</th>
                        <th>Address</th>
                        <th>BCH</th>
                        <th>Tokens</th>
                        <th class="scan-table-action-col"><span class="sr-only">Action</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="result in activeWalletScanResults"
                        :key="result.full"
                        :class="{ 'has-funds': result.balanceSats > 0n || result.tokenBalances.length > 0 }"
                      >
                        <td class="scan-table-label">{{ result.label }}</td>
                        <td class="scan-table-address" :title="result.address">{{ result.address ? formatAddressSingleLine(result.address) : 'Unable to derive' }}</td>
                        <td class="scan-table-bch">{{ formatBchFromSats(result.balanceSats) }}</td>
                        <td class="scan-table-tokens">
                          <span v-if="result.tokenBalances.length === 0" class="hint">—</span>
                          <ul v-else class="scan-token-list">
                            <li v-for="token in result.tokenBalances" :key="token.category">
                              {{ token.symbol ?? token.displayName }}: {{ formatTokenAmount(token.amount, token.decimals) }}
                            </li>
                          </ul>
                        </td>
                        <td class="scan-table-action">
                          <button
                            v-if="result.switchable"
                            class="tiny-btn"
                            type="button"
                            :disabled="isUpdatingDerivation"
                            @click="switchActiveWalletToScannedPath(result)"
                          >Switch</button>
                          <span v-else class="hint scan-detect-only" title="Single detection-only key - not a switchable receive chain">detect-only</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="scan-table-errors" v-if="activeWalletScanErrors.length > 0">
                  <p class="hint">Some paths could not be scanned:</p>
                  <p class="hint" v-for="result in activeWalletScanErrors" :key="`err-${result.parent}`">{{ result.label }}: {{ result.error }}</p>
                </div>
              </details>
            </div>
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
          <div class="row">
            <button class="action-sheet-btn" type="button" @click="scanImportDerivationPaths" :disabled="isScanningDerivations">
              <FontAwesomeIcon :icon="['fas', 'magnifying-glass']" class="icon-btn" />
              {{ isScanningDerivations ? 'Scanning paths...' : 'Scan BIP44 Derivation Paths' }}
            </button>
          </div>
          <div class="row" v-if="derivationScanMessage">
            <p class="hint">{{ derivationScanMessage }}</p>
          </div>
          <div class="row" v-if="derivationScanResults.length > 0">
            <div class="scan-results">
              <div class="scan-results-header">
                <strong>Scan results</strong>
              </div>
              <div class="scan-results-list">
                <div v-for="result in derivationScanResults" :key="result.full" class="scan-result-item">
                  <div class="scan-result-row">
                    <span class="scan-label">{{ result.label }}</span>
                    <button v-if="result.switchable" class="tiny-btn" type="button" @click="applyScannedDerivationPath(result)">Select</button>
                    <span v-else class="hint scan-detect-only" title="Single detection-only key - not a switchable receive chain">detect-only</span>
                  </div>
                  <div class="scan-result-value"><strong>Address:</strong> {{ result.address || 'Unable to derive' }}</div>
                  <div class="scan-result-value"><strong>BCH:</strong> {{ formatBchFromSats(result.balanceSats) }} · <strong>Tokens:</strong> {{ formatScanTokenBalances(result.tokenBalances) }}</div>
                  <div class="scan-result-value" v-if="result.error"><strong>Error:</strong> {{ result.error }}</div>
                </div>
              </div>
            </div>
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

<style scoped src="./styles/app.css"></style>
