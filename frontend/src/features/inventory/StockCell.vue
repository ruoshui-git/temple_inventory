<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import ItemImage from "../../components/ItemImage.vue";
import StockDetails from "../../components/StockDetails.vue";
import UnitText from "../../components/ui/UnitText.vue";
import LocationLabel from "../../components/ui/LocationLabel.vue";
import type { DataColumn } from "../../lib/dataTable";
import { itemBatches } from "../../lib/stockPresentation";
import { routeTarget } from "../../lib/routeRegistry";
import { warehouseLabel } from "../../lib/warehouseLabel";
import {
	isStockItemRow,
	stockCode,
	stockComponentDetail,
	stockExpiryLabel,
	stockIdentity,
	stockLocationDetail,
	stockLocationLabel,
	stockName,
	type StockReference,
	type StockRow,
} from "./stockColumns";

// One stock cell by column id. The DataTable, card fields and 列表 rows all render through
// this so a column looks the same in every layout. 列表 rows (compact) keep locations and
// batches as one plain summary line; the StockDetails chips stay in tables and cards.
const props = defineProps<{
	column: DataColumn;
	row: StockRow;
	reference: StockReference;
	loading?: boolean;
	initialized?: boolean;
	stale?: boolean;
	compact?: boolean;
}>();
const physicalLocations = computed(() =>
	isStockItemRow(props.row)
		? props.row.locations.filter((location) => Number(location.available) > 0)
		: [],
);
const compactSummary = computed(() => {
	const row = props.row;
	if (!isStockItemRow(row)) return "—";
	if (props.column.id === "locations") {
		const physical = physicalLocations.value;
		if (physical.length === 1)
			return warehouseLabel(
				physical[0]!.location,
				props.reference.warehouses,
				physical[0]!.label,
			);
		return physical.length ? `${physical.length} 个库位` : "暂无库存位置";
	}
	if (!row.tracksBatch) return "—";
	const available = itemBatches(row).filter((batch) => Number(batch.available) > 0).length;
	return available ? `${available} 个批次` : "0 批次";
});
</script>

<template>
	<div v-if="column.id === 'image'" class="table-item-image">
		<ItemImage :item="stockIdentity(row)"></ItemImage>
	</div>
	<RouterLink
		v-else-if="column.id === 'item_name'"
		class="item-name browse-row-link"
		:to="routeTarget('item-detail', { code: stockCode(row) })"
		:title="stockName(row)"
	>
		{{ stockName(row) }}
	</RouterLink>
	<span v-if="row.disabled && column.id === 'item_name'" class="badge neutral">已停用</span>
	<template v-else-if="column.id === 'item_code'">{{ stockCode(row) }}</template>
	<template v-else-if="column.id === 'stock_uom'"
		><UnitText :name="row.uom || row.stock_uom"
	/></template>
	<template v-else-if="column.id === 'category'">{{ row.category || "未分类" }}</template>
	<template v-else-if="column.id === 'warehouse_label'">
		<template v-if="isStockItemRow(row) && row.locations.length">
			<template v-for="(place, index) in row.locations" :key="place.location">
				<span v-if="index">；</span>
				<LocationLabel :warehouse="place.location" :label="place.label" />
			</template>
		</template>
		<LocationLabel
			v-else
			:warehouse="String(row.warehouse || '')"
			:label="stockComponentDetail(row, 'warehouse_label', reference.siteDate) || '—'"
		/>
	</template>
	<template v-else-if="column.id === 'warehouse_name'">{{
		stockLocationDetail(row, "warehouse_name") || "—"
	}}</template>
	<template v-else-if="column.id === 'batch_no'">{{
		stockComponentDetail(row, "batch_no", reference.siteDate) || "—"
	}}</template>
	<LocationLabel
		v-else-if="compact && column.id === 'locations' && physicalLocations.length === 1"
		:warehouse="physicalLocations[0]?.location"
		:label="compactSummary"
	/>
	<template v-else-if="compact && (column.id === 'locations' || column.id === 'batches')">{{
		compactSummary
	}}</template>
	<StockDetails
		v-else-if="column.id === 'locations' && isStockItemRow(row)"
		:item="row"
		part="locations"
		:loading="loading"
		:initialized="initialized"
		:stale="stale"
	/>
	<StockDetails
		v-else-if="column.id === 'batches' && isStockItemRow(row)"
		:item="row"
		part="batches"
		:loading="loading"
		:initialized="initialized"
		:stale="stale"
	/>
	<template v-else-if="column.id === 'batches'">{{
		stockComponentDetail(row, "batch_no", reference.siteDate) || "—"
	}}</template>
	<template v-else-if="column.id === 'locations'"
		><LocationLabel
			:warehouse="String(row.warehouse || '')"
			:label="stockLocationLabel(row, reference)"
	/></template>
	<template v-else-if="column.id === 'warehouse_native_name'">{{
		stockLocationDetail(row, "nativeName") || "—"
	}}</template>
	<template v-else-if="column.id === 'available'">{{ row.available }}</template>
	<template v-else-if="column.id === 'loaned'">{{ row.loaned }}</template>
	<template v-else-if="column.id === 'damaged'">{{ row.damaged }}</template>
	<template v-else-if="column.id === 'total'">{{ row.stock_qty }}</template>
	<template v-else-if="column.id === 'expiry_date'">{{
		stockComponentDetail(row, "expiry_date", reference.siteDate) || "—"
	}}</template>
	<template v-else-if="column.id === 'remaining_days'">{{
		stockComponentDetail(row, "remaining_days", reference.siteDate) || "—"
	}}</template>
	<template v-else-if="column.id === 'expiry_state'">{{
		stockComponentDetail(row, "expiry_state", reference.siteDate) || "—"
	}}</template>
	<template v-else-if="column.id === 'serial_nos'">{{ row.serial_nos || "—" }}</template>
	<span
		v-else-if="column.id === 'expiry' && stockExpiryLabel(row, reference.siteDate)"
		class="badge"
		:class="
			stockExpiryLabel(row, reference.siteDate) === '未过期'
				? 'success'
				: stockExpiryLabel(row, reference.siteDate) === '已过期'
					? 'danger'
					: 'warning'
		"
		>{{ stockExpiryLabel(row, reference.siteDate) }}</span
	>
</template>
