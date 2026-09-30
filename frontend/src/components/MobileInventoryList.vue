pyenv: cannot rehash: /home/frappe/.pyenv/shims isn't writable rm: cannot remove
'/home/frappe/.nvm/current': Read-only file system
<script setup lang="ts">
import type { InventoryCardRow } from "../lib/inventoryTypes";

const props = withDefaults(
	defineProps<{
		rows: InventoryCardRow[];
		loading?: boolean;
		loadingMore?: boolean;
		error?: string;
	}>(),
	{ loading: false, loadingMore: false, error: "" },
);
const emit = defineEmits<{ activate: [row: InventoryCardRow]; retry: [] }>();
const format = (value: number) => value.toLocaleString("zh-CN");
const locationCount = (row: InventoryCardRow) =>
	Object.values(row.warehouse_stock || {}).filter((quantity) => Number(quantity) !== 0).length;
const expiryLabel = (row: InventoryCardRow) => {
	if (row.nearest_expiry_days == null) return "";
	if (row.nearest_expiry_days < 0) return "含过期批次";
	if (row.nearest_expiry_days <= 30) return "即将到期";
	return "";
};
</script>

<template>
	<div class="mobile-inventory-list" role="list" aria-label="库存列表视图">
		<div v-if="props.loading" class="mobile-inventory-state" role="status">正在更新记录…</div>
		<div v-else-if="props.error" class="mobile-inventory-state error" role="alert">
			{{ props.error }} <button type="button" @click="emit('retry')">重试</button>
		</div>
		<button
			v-else
			v-for="row in props.rows"
			:key="row.item_code"
			type="button"
			class="mobile-inventory-row"
			role="listitem"
			@click="emit('activate', row)"
		>
			<span class="mobile-row-image">
				<img
					v-if="row.image"
					:src="row.image"
					:alt="row.item_name"
					loading="lazy"
					decoding="async"
				/>
				<span v-else aria-hidden="true">□</span>
			</span>
			<span class="mobile-row-copy">
				<b>{{ row.item_name }}</b>
				<small>{{ row.item_code }} · {{ row.item_group }}</small>
				<span class="mobile-row-chips">
					<small v-if="locationCount(row)">{{ locationCount(row) }} 个库位</small>
					<small v-if="row.batch_count">{{ row.batch_count }} 批次</small>
					<small v-if="expiryLabel(row)" class="warning">{{ expiryLabel(row) }}</small>
				</span>
				<small class="mobile-row-totals">
					总 {{ format(row.total_stock) }} · 借 {{ format(row.on_loan_qty) }} · 损
					{{ format(row.damaged_qty) }}
				</small>
			</span>
			<span class="mobile-row-quantity">
				<strong>{{ format(row.available_stock) }}</strong>
				<small>{{ row.stock_uom }}</small>
			</span>
			<span aria-hidden="true" class="mobile-row-chevron">›</span>
		</button>
		<div
			v-if="!props.loading && !props.error && !props.rows.length"
			class="mobile-inventory-state"
		>
			暂无符合条件的物品
		</div>
		<div v-if="props.loadingMore" class="mobile-inventory-state" role="status">
			正在加载更多记录…
		</div>
	</div>
</template>

<style scoped>
.mobile-inventory-list {
	display: grid;
	background: #fff;
	border: 1px solid #ece8e1;
	border-radius: 9px;
}
.mobile-inventory-state {
	padding: 26px 12px;
	color: #6d747b;
	text-align: center;
}
.mobile-inventory-state.error {
	color: #b42318;
}
.mobile-inventory-row {
	display: grid;
	grid-template-columns: 64px minmax(0, 1fr) auto 10px;
	align-items: center;
	gap: 8px;
	min-height: 92px;
	padding: 8px;
	border: 0;
	border-bottom: 1px solid #eeeae3;
	background: transparent;
	color: #27313d;
	text-align: left;
}
.mobile-inventory-row:last-child {
	border-bottom: 0;
}
.mobile-row-image {
	display: grid;
	place-items: center;
	width: 64px;
	aspect-ratio: 1;
	overflow: hidden;
	border-radius: 7px;
	background: #f6f4ef;
	color: #aaa397;
}
.mobile-row-image img {
	width: 100%;
	height: 100%;
	padding: 0;
	border: 0;
	object-fit: contain;
}
.mobile-row-copy {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 2px;
}
.mobile-row-copy > b,
.mobile-row-copy > small {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.mobile-row-copy > b {
	font-size: 13px;
}
.mobile-row-copy > small {
	color: #7c858f;
	font-size: 10px;
}
.mobile-row-chips {
	display: flex;
	gap: 4px;
	margin-top: 2px;
}
.mobile-row-chips small {
	padding: 2px 5px;
	border-radius: 10px;
	background: #eef5fa;
	color: #47708c;
	font-size: 9px;
}
.mobile-row-chips .warning {
	background: #fff1e4;
	color: #a6531b;
}
.mobile-row-totals {
	color: #667079 !important;
}
.mobile-row-quantity {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	color: #087a48;
}
.mobile-row-quantity strong {
	font-size: 18px;
}
.mobile-row-quantity small {
	font-size: 10px;
}
.mobile-row-chevron {
	color: #a19a90;
}
</style>
