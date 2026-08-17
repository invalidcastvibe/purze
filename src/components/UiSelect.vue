<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

type SelectOption = {
  value: string;
  label: string;
};

const props = defineProps<{
  modelValue: string;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();

const isOpen = ref(false);
const root = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuPlacement = ref<'down' | 'up'>('down');

const selectedLabel = computed(() => {
  return props.options.find((opt) => opt.value === props.modelValue)?.label ?? props.placeholder ?? 'Select';
});

function toggleOpen() {
  isOpen.value = !isOpen.value;
}

function updateMenuPlacement() {
  if (!root.value || !menuEl.value) return;
  const rect = root.value.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const menuHeight = Math.min(menuEl.value.scrollHeight, 280);
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  const needsFlip = spaceBelow < menuHeight + 12 && spaceAbove > spaceBelow;
  menuPlacement.value = needsFlip ? 'up' : 'down';
}

function choose(value: string) {
  emit('update:modelValue', value);
  isOpen.value = false;
}

function onDocumentClick(event: MouseEvent) {
  if (!root.value) return;
  const target = event.target as Node;
  if (!root.value.contains(target)) {
    isOpen.value = false;
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    isOpen.value = false;
  }
}

function onWindowReposition() {
  if (!isOpen.value) return;
  updateMenuPlacement();
}

document.addEventListener('click', onDocumentClick);
document.addEventListener('keydown', onDocumentKeydown);
window.addEventListener('resize', onWindowReposition);
window.addEventListener('scroll', onWindowReposition, true);

watch(isOpen, async (open) => {
  if (!open) {
    menuPlacement.value = 'down';
    return;
  }
  await nextTick();
  updateMenuPlacement();
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
  window.removeEventListener('resize', onWindowReposition);
  window.removeEventListener('scroll', onWindowReposition, true);
});
</script>

<template>
  <div ref="root" class="ui-select" :class="{ 'is-open': isOpen }">
    <button
      :id="id"
      type="button"
      class="ui-select-trigger"
      :aria-expanded="isOpen"
      aria-haspopup="true"
      @click="toggleOpen"
    >
      <span class="ui-select-value">{{ selectedLabel }}</span>
      <span class="ui-select-caret" aria-hidden="true">▾</span>
    </button>
    <div
      v-if="isOpen"
      ref="menuEl"
      class="ui-select-menu"
      :class="{ 'is-up': menuPlacement === 'up' }"
    >
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="ui-select-option"
        :class="{ 'is-active': opt.value === modelValue }"
        @click="choose(opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ui-select {
  position: relative;
  width: 100%;
  z-index: 1;
}

.ui-select.is-open {
  z-index: 120;
}

.ui-select-trigger {
  width: 100%;
  min-height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.45);
  color: #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  font-size: 14px;
  line-height: 1.2;
  text-align: left;
}

.ui-select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-select.compact-select .ui-select-trigger {
  min-height: 28px;
  padding: 4px 6px;
  font-size: 12px;
}

.ui-select-caret {
  color: #93c5fd;
  font-size: 12px;
}

.ui-select-menu {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  max-height: 280px;
  overflow-y: auto;
  z-index: 240;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.96);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 14px 28px rgba(2, 6, 23, 0.45);
  padding: 6px;
}

.ui-select-menu.is-up {
  top: auto;
  bottom: calc(100% + 6px);
}

.ui-select-option {
  width: 100%;
  min-height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #e2e8f0;
  text-align: left;
  padding: 6px 8px;
  font-size: 14px;
}

.ui-select-option:hover,
.ui-select-option.is-active {
  background: rgba(59, 130, 246, 0.22);
}

.ui-select.compact-select .ui-select-option {
  min-height: 28px;
  padding: 4px 6px;
  font-size: 12px;
}

@media (max-width: 460px) {
  .ui-select-trigger,
  .ui-select-option {
    min-height: 32px;
    font-size: 14px;
  }
}
</style>
