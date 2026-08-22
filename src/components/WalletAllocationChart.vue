<script setup lang="ts">
import { computed } from 'vue';

// A single slice's worth of pre-computed, ready-to-render data. The parent
// (App.vue) is responsible for building this list from the *active wallet
// only* (bchBalance + visibleTokenList) - this component does no wallet
// lookups of its own, so it can't accidentally aggregate other wallets.
export type AllocationEntry = {
  key: string;
  label: string;
  /** Preformatted amount string, reusing the app's existing formatters (e.g. "1.2345 BCH"). */
  amountText: string;
  /** Preformatted fiat string if a price is known for this asset, otherwise null. */
  valueText: string | null;
  /** Non-negative numeric weight used purely for slice sizing. */
  weight: number;
};

const props = defineProps<{
  walletName: string;
  entries: AllocationEntry[];
  /** True when every entry has a fiat value and slices are sized by value; false when sized by raw amount. */
  valueWeighted: boolean;
}>();

// A small fixed palette cycled by index - keeps the chart self-contained
// with no new dependency and consistent color-to-slice mapping between the
// pie and the legend.
const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#eab308', '#ec4899', '#14b8a6', '#818cf8'];

const totalWeight = computed(() => props.entries.reduce((sum, entry) => sum + Math.max(entry.weight, 0), 0));

const hasData = computed(() => props.entries.length > 0 && totalWeight.value > 0);

type Slice = AllocationEntry & { color: string; percent: number; startPercent: number };

const slices = computed<Slice[]>(() => {
  if (!hasData.value) return [];
  let cursor = 0;
  return props.entries
    .filter((entry) => entry.weight > 0)
    .map((entry, i) => {
      const percent = (entry.weight / totalWeight.value) * 100;
      const slice: Slice = { ...entry, color: PALETTE[i % PALETTE.length], percent, startPercent: cursor };
      cursor += percent;
      return slice;
    });
});

const pieBackground = computed(() => {
  if (!hasData.value) return 'transparent';
  const stops = slices.value.map((slice) => `${slice.color} ${slice.startPercent}% ${slice.startPercent + slice.percent}%`);
  return `conic-gradient(${stops.join(', ')})`;
});

const pieAriaLabel = computed(() => {
  if (!hasData.value) return 'No allocation data';
  return slices.value.map((slice) => `${slice.label} ${slice.percent.toFixed(1)}%`).join(', ');
});

function formatPercent(percent: number): string {
  return `${percent < 0.1 ? '<0.1' : percent.toFixed(1)}%`;
}
</script>

<template>
  <div class="allocation-chart">
    <div v-if="!hasData" class="allocation-empty">
      <FontAwesomeIcon :icon="['fas', 'chart-pie']" class="allocation-empty-icon" />
      <p>No priced or funded assets in <strong>{{ walletName }}</strong> yet.</p>
      <p class="hint">BCH and any visible tokens with a balance will show up here once funded.</p>
    </div>

    <template v-else>
      <div class="allocation-body">
        <div class="allocation-pie" :style="{ background: pieBackground }" role="img" :aria-label="pieAriaLabel"></div>
        <ul class="allocation-legend">
          <li v-for="slice in slices" :key="slice.key" class="allocation-legend-row">
            <span class="allocation-swatch" :style="{ backgroundColor: slice.color }" aria-hidden="true"></span>
            <span class="allocation-legend-main">
              <span class="allocation-legend-label">{{ slice.label }}</span>
              <span class="allocation-legend-sub">{{ slice.valueText ?? slice.amountText }}</span>
            </span>
            <span class="allocation-legend-percent">{{ formatPercent(slice.percent) }}</span>
          </li>
        </ul>
      </div>
      <p class="hint allocation-note">
        {{ valueWeighted ? 'Slice sizes reflect fiat value.' : "Slice sizes reflect asset amounts - Purze doesn't have live USD pricing for individual tokens yet, so value and amount can't be mixed fairly." }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.allocation-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.allocation-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 28px 12px;
  color: #94a3b8;
}

.allocation-empty-icon {
  font-size: 28px;
  color: #64748b;
  margin-bottom: 4px;
}

.allocation-body {
  display: flex;
  align-items: center;
  gap: 20px;
}

.allocation-pie {
  width: 128px;
  height: 128px;
  min-width: 128px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.25) inset;
}

.allocation-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.allocation-legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.allocation-swatch {
  width: 10px;
  height: 10px;
  min-width: 10px;
  border-radius: 3px;
}

.allocation-legend-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.allocation-legend-label {
  color: #e2e8f0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.allocation-legend-sub {
  color: #94a3b8;
  font-size: 12px;
}

.allocation-legend-percent {
  color: #e2e8f0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.allocation-note {
  margin: 0;
}

@media (max-width: 460px) {
  .allocation-body {
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  .allocation-pie {
    width: 148px;
    height: 148px;
    min-width: 148px;
  }

  .allocation-legend {
    width: 100%;
  }
}
</style>
