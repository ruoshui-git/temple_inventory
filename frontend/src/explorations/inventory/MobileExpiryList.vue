<script setup lang="ts">
import ItemImagePreview from "../../components/ItemImagePreview.vue";
import type { InventoryBatchRow, InventoryItem } from "./fixtures";
import { daysFromFixtureDate } from "./fixtures";

defineProps<{
	rows: InventoryBatchRow[];
	imageFor: (item: InventoryItem) => string | undefined;
	locationFor: (item: InventoryItem) => string;
}>();
const emit = defineEmits<{ activate: [row: InventoryBatchRow] }>();
const format = (value: number) => value.toLocaleString("zh-CN");
const relative = (row: InventoryBatchRow) => {
	const days = daysFromFixtureDate(row.expiry);
	if (days == null) return "无效期";
	if (days < 0) return `已过期 ${Math.abs(days)} 天`;
	if (days === 0) return "今天到期";
	return `剩余 ${days} 天`;
};
const tone = (row: InventoryBatchRow) =>
	(daysFromFixtureDate(row.expiry) ?? 9999) < 0 ? "danger" : "warning";
</script>

<template>
	<div class="mobile-expiry-list" role="list" aria-label="效期批次列表">
		<button
			v-for="row in rows"
			:key="row.code"
			type="button"
			class="mobile-expiry-row"
			role="listitem"
			:data-batch="row.code"
			@click="emit('activate', row)"
		>
			<span class="expiry-row-image">
				<ItemImagePreview
					v-if="imageFor(row.item)"
					:src="imageFor(row.item)"
					:alt="row.item.name"
				/>
				<span v-else aria-hidden="true">□</span>
			</span>
			<span class="expiry-row-copy">
				<b>{{ row.item.name }}</b>
				<small>{{ row.item.code }} · {{ row.item.category }}</small>
				<small
					><span class="batch-chip">批次 {{ row.code }}</span></small
				>
				<small>⌖ {{ locationFor(row.item) }}</small>
			</span>
			<span class="expiry-row-status" :class="tone(row)">
				<b>{{ row.expiry || "无效期" }}</b>
				<small>{{ relative(row) }}</small>
				<strong>{{ format(row.quantity) }} {{ row.item.uom }}</strong>
			</span>
			<span aria-hidden="true" class="expiry-row-chevron">›</span>
		</button>
	</div>
</template>

<style scoped>
.mobile-expiry-list {
	display: grid;
	background: #fff;
	border: 1px solid #ece8e1;
	border-radius: 9px;
}
.mobile-expiry-row {
	display: grid;
	grid-template-columns: 62px minmax(0, 1fr) auto 9px;
	align-items: center;
	gap: 8px;
	min-height: 105px;
	padding: 8px;
	border: 0;
	border-bottom: 1px solid #eeeae3;
	background: transparent;
	color: #27313d;
	text-align: left;
}
.mobile-expiry-row:last-child {
	border-bottom: 0;
}
.expiry-row-image {
	display: grid;
	place-items: center;
	width: 62px;
	aspect-ratio: 1;
	overflow: hidden;
	border-radius: 7px;
	background: #f6f4ef;
	color: #aaa397;
}
.expiry-row-image :deep(.image-preview),
.expiry-row-image :deep(.image-thumb-button),
.expiry-row-image :deep(img) {
	width: 100%;
	height: 100%;
	padding: 0;
	border: 0;
	object-fit: contain;
}
.expiry-row-copy {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 3px;
}
.expiry-row-copy b,
.expiry-row-copy small {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.expiry-row-copy b {
	font-size: 13px;
}
.expiry-row-copy small {
	color: #78818b;
	font-size: 10px;
}
.batch-chip {
	display: inline-block;
	padding: 1px 5px;
	border-radius: 9px;
	background: #edf4fa;
	color: #4b708a;
}
.expiry-row-status {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	font-variant-numeric: tabular-nums;
}
.expiry-row-status b,
.expiry-row-status small {
	font-size: 10px;
}
.expiry-row-status strong {
	margin-top: 6px;
	color: #087a48;
	font-size: 13px;
}
.expiry-row-status.warning b,
.expiry-row-status.warning small {
	color: #ef661e;
}
.expiry-row-status.danger b,
.expiry-row-status.danger small {
	color: #c43c35;
}
.expiry-row-chevron {
	color: #a19a90;
}
</style>
