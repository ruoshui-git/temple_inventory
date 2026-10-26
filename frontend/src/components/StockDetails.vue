<script setup lang="ts">
import { useOptionalReferenceData } from "../services/contracts";
import { warehouseLabel } from "../lib/warehouseLabel";
import { computed } from "vue";
import DetailPopover from "./ui/DetailPopover.vue";
import InventoryIcon from "./InventoryIcon.vue";
import { itemBatches, type StockItem } from "../lib/stockPresentation";
import DataTable from "./ui/DataTable.vue";
import type { DataColumn, DataTableRecord } from "../lib/dataTable";
import { useColumnPreferences } from "../composables/useColumnPreferences";
import { useOptionalInventoryServices } from "../services/contracts";
import { useArrayTableSort } from "../composables/useArrayTableSort";
const props = withDefaults(
	defineProps<{ item: StockItem; loading?: boolean; initialized?: boolean; stale?: boolean }>(),
	{ loading: false, initialized: true, stale: false },
);
const batches = computed(() => itemBatches(props.item));
const physicalLocations = computed(() =>
	props.item.locations.filter((row) => Number(row.available) > 0),
);
const availableBatches = computed(() => batches.value.filter((row) => Number(row.available) > 0));
const loanedTotal = computed(() =>
	props.item.locations.reduce((total, row) => total + Number(row.loaned || 0), 0),
);
const damagedTotal = computed(() =>
	props.item.locations.reduce((total, row) => total + Number(row.damaged || 0), 0),
);
const warehouseReference = useOptionalReferenceData();
const services = useOptionalInventoryServices();
const locationColumns: DataColumn[] = [
	{
		id: "location",
		label: "库位",
		required: true,
		defaultVisible: true,
		sortable: true,
		minWidth: "130px",
	},
	{
		id: "available",
		label: "可用数量",
		defaultVisible: true,
		sortable: true,
		align: "end",
		minWidth: "100px",
	},
	{ id: "uom", label: "单位", defaultVisible: true, sortable: true },
];
const batchColumns: DataColumn[] = [
	{
		id: "location",
		label: "库位",
		required: true,
		defaultVisible: true,
		sortable: true,
		minWidth: "130px",
	},
	{
		id: "batch",
		label: "批次",
		required: true,
		defaultVisible: true,
		sortable: true,
		minWidth: "130px",
	},
	{
		id: "available",
		label: "可用数量",
		defaultVisible: true,
		sortable: true,
		align: "end",
		minWidth: "100px",
	},
	{ id: "expiry", label: "效期", defaultVisible: true, sortable: true, minWidth: "100px" },
	{ id: "uom", label: "单位", defaultVisible: true, sortable: true },
];
const locationRows = computed<DataTableRecord[]>(() =>
	physicalLocations.value.map((row) => ({
		kind: "record",
		id: row.location,
		value: { ...row, uom: props.item.uom },
	})),
);
const batchRows = computed<DataTableRecord[]>(() =>
	props.item.locations.flatMap((location) =>
		(location.batches || [])
			.filter((batch) => Number(batch.available) > 0)
			.map((batch) => ({
				kind: "record" as const,
				id: `${location.location}:${batch.id}`,
				value: {
					location: location.location,
					label: location.label,
					batch: batch.id,
					uom: props.item.uom,
					...batch,
				},
			})),
	),
);
const locationSort = useArrayTableSort(locationRows, "location", ["location", "available", "uom"]);
const batchSort = useArrayTableSort(batchRows, "location", [
	"location",
	"batch",
	"available",
	"expiry",
	"uom",
]);
const locationPreferences =
	services && warehouseReference
		? useColumnPreferences(
				"stock.location-breakdown",
				computed(() => locationColumns),
				warehouseReference,
				services,
			)
		: undefined;
const batchPreferences =
	services && warehouseReference
		? useColumnPreferences(
				"stock.batch-breakdown",
				computed(() => batchColumns),
				warehouseReference,
				services,
			)
		: undefined;
</script>
<template>
	<div class="stock-detail-chips">
		<DetailPopover
			v-if="physicalLocations.length || loanedTotal || damagedTotal"
			:label="`${item.name}的库位与可用数量`"
		>
			<template #trigger
				><InventoryIcon name="warehouse" />{{
					physicalLocations.length === 1
						? warehouseLabel(
								physicalLocations[0].location,
								warehouseReference?.warehouses || [],
								physicalLocations[0].label,
							)
						: physicalLocations.length
							? `${physicalLocations.length} 个库位`
							: `借出 ${loanedTotal} · 损坏 ${damagedTotal}`
				}}</template
			>
			<strong>{{ item.name }}</strong>
			<p class="muted">当前筛选范围 · 可用库存</p>
			<DataTable
				v-if="physicalLocations.length"
				ariaLabel="库位可用数量"
				table-class="stock-breakdown"
				:columns="locationColumns"
				:rows="locationSort.rows.value"
				:loading="loading"
				:initialized="initialized"
				:stale="stale"
				:sort-by="locationSort.sortBy.value"
				:sort-direction="locationSort.sortDirection.value"
				:column-preferences="locationPreferences"
				@sort="locationSort.setSort"
			>
				<template #cell="{ column, row }">
					<template v-if="column.id === 'location'">{{
						warehouseLabel(
							String(row.location),
							warehouseReference?.warehouses || [],
							String(row.label || ""),
						)
					}}</template>
					<template v-else>{{ row[column.id] }}</template>
				</template>
			</DataTable>
			<p v-if="loanedTotal || damagedTotal" class="stock-breakdown-other muted">
				另有 借出 {{ loanedTotal }} · 损坏 {{ damagedTotal }}
			</p>
			<p v-if="physicalLocations.length" class="stock-breakdown-total">
				合计 {{ item.available }} {{ item.uom }}
			</p>
		</DetailPopover>
		<span v-else class="muted">暂无库存位置</span>
		<DetailPopover
			v-if="item.tracksBatch && (availableBatches.length || loanedTotal || damagedTotal)"
			:label="`${item.name}的批次信息`"
			:trigger-text="
				availableBatches.length
					? `${availableBatches.length} 个批次`
					: `借出 ${loanedTotal} · 损坏 ${damagedTotal}`
			"
		>
			<strong>批次与位置</strong>
			<p class="muted">当前筛选范围 · 可用库存</p>
			<DataTable
				v-if="availableBatches.length"
				ariaLabel="批次与位置库存"
				table-class="stock-breakdown"
				:columns="batchColumns"
				:rows="batchSort.rows.value"
				:loading="loading"
				:initialized="initialized"
				:stale="stale"
				:sort-by="batchSort.sortBy.value"
				:sort-direction="batchSort.sortDirection.value"
				:column-preferences="batchPreferences"
				@sort="batchSort.setSort"
			>
				<template #cell="{ column, row }">
					<template v-if="column.id === 'location'">{{
						warehouseLabel(
							String(row.location),
							warehouseReference?.warehouses || [],
							String(row.label || ""),
						)
					}}</template>
					<template v-else-if="column.id === 'batch'">{{ row.batch }}</template>
					<template v-else>{{ row[column.id] }}</template>
				</template>
			</DataTable>
			<p v-if="loanedTotal || damagedTotal" class="stock-breakdown-other muted">
				另有 借出 {{ loanedTotal }} · 损坏 {{ damagedTotal }}
			</p>
		</DetailPopover>
		<span v-else-if="item.tracksBatch" class="badge neutral">0 批次</span>
	</div>
</template>
