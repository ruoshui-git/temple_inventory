<script setup lang="ts">
import DetailPopover from "./DetailPopover.vue";
import ImageForwardCard from "./ImageForwardCard.vue";
import type { InventoryCardRow } from "../lib/inventoryTypes";

const props = withDefaults(
	defineProps<{
		rows: InventoryCardRow[];
		loading?: boolean;
		loadingMore?: boolean;
		error?: string;
		selectionMode?: boolean;
		selectedKeys?: string[];
		warehouseLabel?: (name: string) => string;
		compactMobile?: boolean;
	}>(),
	{
		loading: false,
		loadingMore: false,
		error: "",
		selectionMode: false,
		selectedKeys: () => [],
		compactMobile: false,
	},
);
const emit = defineEmits<{
	activate: [row: InventoryCardRow];
	toggle: [row: InventoryCardRow];
}>();

function activate(row: InventoryCardRow, event: Event) {
	if (event.target instanceof Element && event.target.closest("[data-card-control]")) return;
	if (props.selectionMode) emit("toggle", row);
	else emit("activate", row);
}
function activateKey(row: InventoryCardRow, event: KeyboardEvent) {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	activate(row, event);
}
const formatQuantity = (value: number) =>
	new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(Number(value || 0));
const locations = (row: InventoryCardRow) =>
	Object.entries(row.warehouse_stock || {}).filter(([, quantity]) => Number(quantity) !== 0);
const description = (row: InventoryCardRow) =>
	String(row.description || "")
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
const batchLabel = (row: InventoryCardRow) =>
	!row.has_batch_no
		? ""
		: typeof row.batch_count === "number"
			? `${row.batch_count} 批次`
			: "批次管理";
const expiryTone = (row: InventoryCardRow) => {
	if (row.nearest_expiry_days == null) return "";
	if (row.nearest_expiry_days < 0) return "danger";
	if (row.nearest_expiry_days <= 30) return "warning";
	return "";
};
const expiryBadge = (row: InventoryCardRow) => {
	if (row.nearest_expiry_days == null) return "";
	if (row.nearest_expiry_days < 0) return "含过期批次";
	if (row.nearest_expiry_days <= 30) return "即将到期";
	return "";
};
const batchDetails = (row: InventoryCardRow) => row.batches || [];
</script>

<template>
	<div v-if="loading && rows.length" class="card-refresh-overlay" role="status">
		<span class="loading-spinner" aria-hidden="true"></span>正在更新记录…
	</div>
	<div v-if="loading && !rows.length" class="card-state loading-state" role="status">
		<span class="loading-spinner" aria-hidden="true"></span><b>正在加载记录…</b
		><i v-for="index in 3" :key="index"></i>
	</div>
	<div v-else-if="error" class="card-state error" role="alert">
		<slot name="error">{{ error }}</slot>
	</div>
	<div v-else-if="!loading && !loadingMore && !rows.length" class="card-state">
		暂无符合条件的物品
	</div>
	<div
		v-else
		class="inventory-card-grid"
		:class="{
			'compact-mobile': compactMobile,
			'is-refreshing': loading && rows.length,
		}"
		role="list"
		aria-label="库存卡片"
	>
		<article
			v-for="row in rows"
			:key="row.item_code"
			class="inventory-visual-card"
			:class="{ selected: selectedKeys.includes(row.item_code) }"
			role="listitem"
			tabindex="0"
			@keydown="activateKey(row, $event)"
			@click="activate(row, $event)"
		>
			<ImageForwardCard :image="row.image" :alt="row.item_name">
				<template #placeholder
					><div class="inventory-card-placeholder" aria-hidden="true">
						<span>□</span><small>暂无图片</small>
					</div></template
				>
				<div class="inventory-card-primary">
					<b class="inventory-card-name">{{ row.item_name }}</b>
					<div class="inventory-card-available">
						<small>可用</small>
						<span
							><strong>{{ formatQuantity(row.available_stock) }}</strong
							><small>{{ row.stock_uom }}</small></span
						>
					</div>
					<input
						v-if="selectionMode"
						data-card-control
						type="checkbox"
						:checked="selectedKeys.includes(row.item_code)"
						:aria-label="`选择 ${row.item_name}`"
						@change="emit('toggle', row)"
					/>
				</div>
				<p class="inventory-card-code">{{ row.item_code }} · {{ row.item_group }}</p>
				<p v-if="description(row)" class="inventory-card-description">
					{{ description(row) }}
				</p>
				<div
					v-if="locations(row).length || batchLabel(row)"
					class="inventory-card-details"
					data-card-control
				>
					<DetailPopover
						v-if="locations(row).length"
						:label="`${row.item_name}的仓库位置`"
						:trigger-text="`${locations(row).length} 个库位`"
					>
						<p v-for="[name, quantity] in locations(row)" :key="name">
							{{ warehouseLabel?.(name) || name }}<br />{{
								formatQuantity(Number(quantity))
							}}
							{{ row.stock_uom }}
						</p>
					</DetailPopover>
					<DetailPopover
						v-if="batchLabel(row) && batchDetails(row).length"
						:label="`${row.item_name}的批次信息`"
						:trigger-text="batchLabel(row)"
					>
						<p v-for="batch in batchDetails(row)" :key="batch.batch_no">
							批次 {{ batch.batch_no }} · 数量 {{ formatQuantity(batch.qty) }}
							{{ row.stock_uom }} · {{ batch.expiry_date || "无效期" }}
						</p>
					</DetailPopover>
					<span v-else-if="batchLabel(row)" class="batch-badge">{{
						batchLabel(row)
					}}</span>
					<span v-if="expiryBadge(row)" class="expiry-badge" :class="expiryTone(row)">{{
						expiryBadge(row)
					}}</span>
				</div>
				<div class="inventory-card-totals">
					<span
						>总计 <b>{{ formatQuantity(row.total_stock) }}</b></span
					>
					<span
						>借出 <b>{{ formatQuantity(row.on_loan_qty) }}</b></span
					>
					<span :class="{ damaged: Number(row.damaged_qty) !== 0 }"
						>损坏 <b>{{ formatQuantity(row.damaged_qty) }}</b></span
					>
					<small>{{ row.stock_uom }}</small>
				</div>
				<p
					v-if="row.nearest_expiry_date"
					class="inventory-card-expiry"
					:class="expiryTone(row)"
				>
					最近效期 {{ row.nearest_expiry_date }}
				</p>
			</ImageForwardCard>
		</article>
	</div>
	<div v-if="loadingMore" class="card-state" role="status">
		<span class="loading-spinner loading-spinner-small" aria-hidden="true"></span
		>正在加载更多记录…
	</div>
</template>

<style scoped>
.inventory-card-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr));
	grid-auto-rows: 1fr;
	gap: 12px;
	padding: 12px;
	background: #f8f7f4;
}
.card-refresh-overlay {
	position: absolute;
	inset: 0;
	z-index: 3;
	display: flex;
	justify-content: center;
	gap: 8px;
	padding-top: 18px;
	background: rgb(255 253 249 / 58%);
	color: #704d2e;
	font-weight: 700;
	pointer-events: none;
}
.card-refresh-overlay ~ .inventory-card-grid.is-refreshing {
	opacity: 0.55;
	pointer-events: none;
}
.inventory-results,
.inventory-card-grid {
	position: relative;
}
.loading-state {
	display: grid;
	justify-items: center;
	gap: 10px;
	min-height: 190px;
}
.loading-state i {
	display: block;
	width: min(92%, 360px);
	height: 42px;
	border-radius: 9px;
	background: #f0ebe3;
}
.inventory-visual-card {
	display: flex;
	min-width: 0;
	flex-direction: column;
	overflow: hidden;
	border: 1px solid #ebe8e1;
	border-radius: 8px;
	background: white;
	cursor: pointer;
}
.inventory-visual-card:hover {
	border-color: #c8b69b;
	box-shadow: 0 4px 14px rgb(67 48 26 / 8%);
}
.inventory-visual-card:focus-visible,
.inventory-visual-card.selected {
	outline: 3px solid #a66b35;
	outline-offset: 2px;
}
.inventory-card-image {
	display: grid;
	place-items: center;
	width: 100%;
	aspect-ratio: 1 / 1;
	overflow: hidden;
	background: #fff;
}
.inventory-card-image > img {
	width: 100%;
	height: 100%;
	object-fit: contain;
}
.inventory-card-placeholder {
	display: grid;
	place-items: center;
	gap: 8px;
	color: #aaa397;
	font-size: 42px;
}
.inventory-card-placeholder small {
	font-size: 12px;
}
.inventory-visual-card :deep(.image-forward-card__body) {
	display: flex;
	flex: 1;
	min-width: 0;
	flex-direction: column;
	gap: 7px;
	padding: 10px 12px 12px;
}
.inventory-card-primary {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: start;
	gap: 9px;
}
.inventory-card-name {
	display: -webkit-box;
	overflow: hidden;
	color: #252e3a;
	font-size: 15px;
	font-weight: 700;
	line-height: 1.4;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
}
.inventory-card-primary > input {
	margin: 3px 0 0;
}
.inventory-card-available {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	color: #14804e;
}
.inventory-card-available > small {
	color: #7f8991;
	font-size: 10px;
	line-height: 1.2;
}
.inventory-card-available > span {
	display: flex;
	align-items: baseline;
	gap: 3px;
}
.inventory-card-available strong {
	font-size: 24px;
	line-height: 1.1;
}
.inventory-card-available span small {
	font-size: 10px;
	font-weight: 550;
}
.inventory-card-code,
.inventory-card-description {
	margin: -2px 0 0;
	color: #87909a;
	font-size: 12px;
}
.inventory-card-description {
	display: -webkit-box;
	overflow: hidden;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
}
.inventory-card-details,
.inventory-card-totals {
	display: flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: 4px 12px;
	font-size: 12px;
}
.inventory-card-details :deep(.detail-popover-trigger),
.batch-badge,
.expiry-badge {
	min-height: 26px;
	padding: 2px 7px;
	border: 1px solid #dfebf4;
	border-radius: 20px;
	background: #f2f7fb;
	color: #476b88;
	font-size: 11px;
}
.expiry-badge.warning {
	border-color: transparent;
	background: #fff3e6;
	color: #9a541b;
}
.expiry-badge.danger {
	border-color: transparent;
	background: #fff0ed;
	color: #a63e33;
}
.inventory-card-totals {
	margin-top: auto;
	color: #717984;
	font-variant-numeric: tabular-nums;
}
.inventory-card-totals b {
	color: #4d545d;
	font-weight: 600;
}
.inventory-card-totals .damaged,
.inventory-card-totals .damaged b {
	color: #b24d42;
}
.inventory-card-totals small {
	color: #8b9299;
	font-size: 10px;
}
.inventory-card-expiry {
	margin: -2px 0 0;
	color: #7c858f;
	font-size: 11px;
}
.inventory-card-expiry.warning {
	color: #9a541b;
}
.inventory-card-expiry.danger {
	color: #a63e33;
}
.inventory-card-details p {
	margin: 0 0 8px;
}
.inventory-card-details p:last-child {
	margin-bottom: 0;
}
.inventory-card-primary:has(input) {
	grid-template-columns: minmax(0, 1fr) auto auto;
}
.card-state {
	padding: 24px;
	text-align: center;
}
.error {
	color: #9a2d24;
}
@media (max-width: 640px) {
	.inventory-card-grid {
		grid-template-columns: 1fr;
		padding: 8px 0;
	}
	.inventory-card-grid.compact-mobile {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		padding: 4px 0 12px;
	}
	.compact-mobile :deep(.image-forward-card__body) {
		gap: 5px;
		padding: 8px;
	}
	.compact-mobile .inventory-card-primary {
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 5px;
	}
	.compact-mobile .inventory-card-name {
		font-size: 13px;
		line-height: 1.3;
	}
	.compact-mobile .inventory-card-available > small,
	.compact-mobile .inventory-card-description {
		display: none;
	}
	.compact-mobile .inventory-card-available strong {
		font-size: 20px;
	}
	.compact-mobile .inventory-card-code {
		overflow: hidden;
		font-size: 10px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.compact-mobile .inventory-card-details {
		align-items: center;
		gap: 4px;
	}
	.compact-mobile .inventory-card-details :deep(.detail-popover-trigger),
	.compact-mobile .batch-badge,
	.compact-mobile .expiry-badge {
		min-height: 22px;
		padding: 1px 6px;
		font-size: 9px;
	}
	.compact-mobile .inventory-card-totals {
		gap: 2px 7px;
		font-size: 10px;
	}
	.compact-mobile .inventory-card-totals > small {
		display: none;
	}
	.compact-mobile .inventory-card-expiry {
		min-height: 14px;
		font-size: 10px;
	}
	.inventory-visual-card :deep(.image-forward-card__media),
	.inventory-visual-card :deep(.image-forward-card__media img) {
		height: 100%;
	}
}
</style>
