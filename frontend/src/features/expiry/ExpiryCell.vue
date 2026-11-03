<script setup lang="ts">
import { computed } from "vue";
import ItemImage from "../../components/ItemImage.vue";
import UnitText from "../../components/ui/UnitText.vue";
import type { DataColumn } from "../../lib/dataTable";
import type { ReportRow } from "../../lib/reportContract";
import type { StockItem } from "../../lib/stockPresentation";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { formatExpiryDuration } from "../../lib/expiryDuration";
import type { ReferenceData } from "../../services/contracts";
import { expiryRemainingText, expiryStatusOf } from "./expiryColumns";

// One batch cell by column id. The table and the card/row fields both render through it, so a
// column reads the same wherever it appears. Item and batch links bubble up as events.
const props = defineProps<{
	column: DataColumn;
	row: ReportRow;
	item: StockItem;
	stale: boolean;
	siteDate: string;
	warehouses: ReferenceData["warehouses"];
}>();
const emit = defineEmits<{ item: []; batch: [] }>();
const id = computed(() => String(props.column.id));
const status = computed(() => expiryStatusOf(props.row, props.siteDate));
</script>

<template>
	<div v-if="id === 'image'" class="expiry-item-identity">
		<ItemImage :item="item" />
	</div>
	<button
		v-else-if="id === 'item_name'"
		class="browse-row-link"
		:disabled="stale"
		@click="emit('item')"
	>
		<strong>{{ row.item_name }}</strong>
	</button>
	<template v-else-if="id === 'item_code'">{{ row.item_code }}</template>
	<template v-else-if="id === 'category'">{{ row.category || "未分类" }}</template>
	<button
		v-else-if="id === 'batch_no'"
		class="browse-row-link"
		:aria-label="`打开批次资料：${row.batch_no}`"
		:disabled="stale"
		@click="emit('batch')"
	>
		{{ row.batch_no }}
	</button>
	<span
		v-else-if="id === 'expiry_date'"
		class="browse-badge"
		:class="
			!row.expiry_date
				? 'is-neutral'
				: String(row.expiry_date) < siteDate
					? 'is-danger'
					: 'is-success'
		"
		>{{ row.expiry_date || "无效期" }}</span
	>
	<template v-else-if="id === 'remaining_days'">
		<span
			v-if="typeof row.remaining_days === 'number'"
			:title="formatExpiryDuration(row.remaining_days)"
			>{{ expiryRemainingText(row.remaining_days) }}</span
		>
	</template>
	<template v-else-if="id === 'expiry_state'">{{ status.label }}</template>
	<template v-else-if="id === 'stock_qty'"
		>{{ row.stock_qty
		}}<span v-if="Number(row.loaned) > 0" class="browse-badge is-warning">借出</span
		><span v-else-if="Number(row.damaged) > 0" class="browse-badge is-danger"
			>损坏</span
		></template
	>
	<template v-else-if="id === 'stock_uom'"><UnitText :name="row.stock_uom" /></template>
	<template v-else-if="id === 'warehouse'">{{
		warehouseLabel(String(row.warehouse || ""), warehouses, String(row.warehouse_label || ""))
	}}</template>
	<template v-else-if="id === 'warehouse_path'">{{ row.warehouse_path || "—" }}</template>
	<template v-else-if="id === 'warehouse_native_name'">{{
		row.warehouse_native_name || "—"
	}}</template>
</template>
