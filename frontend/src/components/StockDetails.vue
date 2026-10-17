<script setup lang="ts">
import { useOptionalReferenceData } from "../services/contracts";
import { warehouseLabel } from "../lib/warehouseLabel";
import { computed } from "vue";
import DetailPopover from "./ui/DetailPopover.vue";
import InventoryIcon from "./InventoryIcon.vue";
import { itemBatches, type StockItem } from "../lib/stockPresentation";
const props = defineProps<{ item: StockItem }>();
const batches = computed(() => itemBatches(props.item));
const warehouseReference = useOptionalReferenceData();
</script>
<template>
	<div class="stock-detail-chips">
		<DetailPopover v-if="item.locations.length" :label="`${item.name}的库位与可用数量`">
			<template #trigger
				><InventoryIcon name="warehouse" />{{
					item.locations.length === 1
						? warehouseLabel(
								item.locations[0].location,
								warehouseReference?.warehouses || [],
								item.locations[0].label,
							)
						: `${item.locations.length} 个库位`
				}}</template
			>
			<strong>{{ item.name }}</strong>
			<p class="muted">当前筛选范围 · 可用库存</p>
			<table class="stock-breakdown">
				<thead>
					<tr>
						<th>库位</th>
						<th>可用数量</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in item.locations" :key="row.location">
						<td>
							{{
								warehouseLabel(
									row.location,
									warehouseReference?.warehouses || [],
									row.label,
								)
							}}
						</td>
						<td>{{ row.available }} {{ item.uom }}</td>
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<th>合计</th>
						<td>{{ item.available }} {{ item.uom }}</td>
					</tr>
				</tfoot>
			</table>
		</DetailPopover>
		<span v-else class="muted">暂无库存位置</span>
		<DetailPopover
			v-if="item.tracksBatch && batches.length"
			:label="`${item.name}的批次信息`"
			:trigger-text="`${batches.length} 个批次`"
		>
			<strong>批次与位置</strong>
			<p class="muted">当前筛选范围 · 可用库存</p>
			<section v-for="row in item.locations" :key="row.location" class="batch-location">
				<strong>{{
					warehouseLabel(row.location, warehouseReference?.warehouses || [], row.label)
				}}</strong>
				<div v-for="batch in row.batches || []" :key="batch.id">
					<span>{{ batch.id }} · {{ batch.available }} {{ item.uom }}</span
					><small v-if="item.tracksExpiry && batch.expiry"
						>到期 {{ batch.expiry }}</small
					>
				</div>
			</section>
		</DetailPopover>
		<span v-else-if="item.tracksBatch" class="badge neutral">0 批次</span>
	</div>
</template>
