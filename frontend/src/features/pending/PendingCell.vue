<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import ItemImage from "../../components/ItemImage.vue";
import DataCell from "../../components/ui/DataCell.vue";
import UnitText from "../../components/ui/UnitText.vue";
import type { DataColumn } from "../../lib/dataTable";
import type { ReportRow } from "../../lib/reportContract";
import { routeTarget } from "../../lib/routeRegistry";

// One damaged-stock cell by column id. The table and the card/row fields both render through
// it, so a column reads the same wherever it appears.
const props = withDefaults(
	defineProps<{ column: DataColumn; row: ReportRow; emptyText?: string }>(),
	{ emptyText: "" },
);
const id = computed(() => String(props.column.id));
const identity = computed(() => ({
	code: String(props.row.item_code || ""),
	name: String(props.row.item_name || ""),
	image: String(props.row.image || ""),
}));
</script>

<template>
	<div v-if="id === 'image'" class="table-item-image">
		<ItemImage :item="identity" />
	</div>
	<RouterLink
		v-else-if="id === 'item_name' && row.item_code"
		class="browse-row-link"
		:to="routeTarget('item-detail', { code: String(row.item_code) })"
		>{{ row.item_name }}</RouterLink
	>
	<UnitText v-else-if="id === 'stock_uom'" :name="row.stock_uom" />
	<DataCell v-else :column="column" :value="row[id]" :empty-text="emptyText" />
</template>
