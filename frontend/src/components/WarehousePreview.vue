<script setup lang="ts">
import { computed } from 'vue'
import DetailPopover from './DetailPopover.vue'
import { warehousePresentation, type WarehouseRecord } from '../lib/warehousePresenter'

type Location = { warehouse: string }

const props = withDefaults(defineProps<{
  locations: Location[]
  tree: WarehouseRecord[]
  label: string
  limit?: number
}>(), { limit: 2 })

const visibleLocations = computed(() => props.locations.slice(0, props.limit))
const remainingCount = computed(() => Math.max(0, props.locations.length - props.limit))
const warehouseText = (name: string) => warehousePresentation(name, props.tree).breadcrumb
</script>

<template>
  <div class="warehouse-preview">
    <span v-if="!locations.length" class="warehouse-preview-empty">—</span>
    <span
      v-for="location in visibleLocations"
      :key="location.warehouse"
      class="warehouse-preview-name"
    >{{ warehouseText(location.warehouse) }}</span>
    <span v-if="remainingCount" data-row-control>
      <DetailPopover
        :label="`查看全部 ${locations.length} 个${label}`"
        :trigger-text="`+${remainingCount}`"
      >
        <span
          v-for="location in locations"
          :key="location.warehouse"
          class="warehouse-preview-popover-name"
        >{{ warehouseText(location.warehouse) }}</span>
      </DetailPopover>
    </span>
  </div>
</template>

<style scoped>
.warehouse-preview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
  font-size: 0.8125rem;
  line-height: 1.35;
}

.warehouse-preview-name,
.warehouse-preview-popover-name {
  overflow-wrap: anywhere;
}

.warehouse-preview-popover-name {
  display: block;
}

.warehouse-preview-empty {
  color: #6b6257;
}
</style>
