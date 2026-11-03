<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import ItemImage from "../../components/ItemImage.vue";
import StockDetails from "../../components/StockDetails.vue";
import UnitText from "../../components/ui/UnitText.vue";
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
	stockWarehousePath,
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
const compactSummary = computed(() => {
	const row = props.row;
	if (!isStockItemRow(row)) return "—";
	if (props.column.id === "locations") {
		const physical = row.locations.filter((location) => Number(location.available) > 0);
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
	<span v-if="row.disabled" class="badge neutral">已停用</span>
	<template v-else-if="column.id === 'item_code'">{{ stockCode(row) }}</template>
	<template v-else-if="column.id === 'stock_uom'"
		><UnitText :name="row.uom || row.stock_uom"
	/></template>
	<template v-else-if="column.id === 'category'">{{ row.category || "未分类" }}</template>
	<template v-else-if="column.id === 'warehouse_label'">{{
		stockComponentDetail(row, "warehouse_label", reference.siteDate) || "—"
	}}</template>
	<template v-else-if="column.id === 'batch_no'">{{
		stockComponentDetail(row, "batch_no", reference.siteDate) || "—"
	}}</template>
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
		><span :title="stockWarehousePath(row, reference)">{{
			stockLocationLabel(row, reference)
		}}</span></template
	>
	<template v-else-if="column.id === 'warehouse_path'">{{
		stockLocationDetail(row, "path") || "—"
	}}</template>
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
