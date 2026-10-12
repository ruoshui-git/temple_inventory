<script setup lang="ts">
import { ref } from "vue";
import type { InventoryCardRow } from "../lib/inventoryTypes";
import DetailPopover from "./DetailPopover.vue";
import AsyncImage from "./AsyncImage.vue";
import UiLoadingBoundary from "./UiLoadingBoundary.vue";

const props = withDefaults(
	defineProps<{
		rows: InventoryCardRow[];
		loading?: boolean;
		loadingMore?: boolean;
		error?: string;
		warehouseLabel?: (name: string) => string;
	}>(),
	{ loading: false, loadingMore: false, error: "" },
);
const emit = defineEmits<{ activate: [row: InventoryCardRow]; retry: [] }>();
const contentRoot = ref<HTMLElement>();
const format = (value: number) => value.toLocaleString("zh-CN");
const locationCount = (row: InventoryCardRow) =>
	Object.values(row.warehouse_stock || {}).filter((quantity) => Number(quantity) !== 0).length;
const expiryLabel = (row: InventoryCardRow) => {
	if (row.nearest_expiry_days == null) return "";
	if (row.nearest_expiry_days < 0) return "含过期批次";
	if (row.nearest_expiry_days <= 30) return "即将到期";
	return "";
};
function activate(row: InventoryCardRow, event: Event) {
	if (props.loading && props.rows.length) return;
	if (event.target instanceof Element && event.target.closest("[data-row-control]")) return;
	emit("activate", row);
}
function activateKey(row: InventoryCardRow, event: KeyboardEvent) {
	if (props.loading && props.rows.length) return;
	if (event.key !== "Enter" && event.key !== " ") return;
	if (event.target instanceof Element && event.target.closest("[data-row-control]")) return;
	event.preventDefault();
	emit("activate", row);
}
</script>

<template>
	<div
		ref="contentRoot"
		class="mobile-inventory-list"
		role="list"
		aria-label="库存列表视图"
		:aria-busy="props.loading || props.loadingMore"
	>
		<UiLoadingBoundary
			v-if="props.loading"
			:busy="true"
			:mode="props.rows.length ? 'refresh' : 'initial'"
			:region="contentRoot"
			:dim-region="props.rows.length > 0"
			:block-interactions="false"
		/>
		<div
			v-if="props.loading && !props.rows.length"
			class="mobile-inventory-state loading-state"
			aria-hidden="true"
		>
			<b>正在加载记录…</b><i v-for="index in 3" :key="index"></i>
		</div>
		<div v-else-if="props.error" class="mobile-inventory-state error" role="alert">
			{{ props.error }} <button type="button" @click="emit('retry')">重试</button>
		</div>
		<template v-if="props.rows.length">
			<article
				v-for="row in props.rows"
				:key="row.item_code"
				class="mobile-inventory-row"
				:inert="props.loading ? true : undefined"
				role="listitem"
				tabindex="0"
				@click="activate(row, $event)"
				@keydown="activateKey(row, $event)"
			>
				<span class="mobile-row-image">
					<AsyncImage
						v-if="row.image"
						:src="row.image"
						:alt="row.item_name"
						class="mobile-row-image__asset"
					/>
					<span v-else aria-hidden="true">□</span>
				</span>
				<span class="mobile-row-copy">
					<b>{{ row.item_name }}</b>
					<small>{{ row.item_code }} · {{ row.item_group }}</small>
					<span class="mobile-row-chips" data-row-control>
						<DetailPopover
							v-if="locationCount(row)"
							:label="`${row.item_name}的仓库位置`"
							:trigger-text="`${locationCount(row)} 个库位`"
							trigger-class="mobile-row-chip"
						>
							<p
								v-for="[name, quantity] in Object.entries(
									row.warehouse_stock || {},
								).filter(([, quantity]) => Number(quantity) !== 0)"
								:key="name"
							>
								{{ props.warehouseLabel?.(name) || name }}：{{
									format(Number(quantity))
								}}
								{{ row.stock_uom }}
							</p>
						</DetailPopover>
						<DetailPopover
							v-if="row.has_batch_no && row.batch_count"
							:label="`${row.item_name}的批次信息`"
							:trigger-text="`${row.batch_count} 批次`"
							trigger-class="mobile-row-chip"
						>
							<p v-for="batch in row.batches || []" :key="batch.batch_no">
								批次 {{ batch.batch_no }} · {{ format(batch.qty) }}
								{{ row.stock_uom }} · {{ batch.expiry_date || "无效期" }}
							</p>
						</DetailPopover>
						<small v-if="expiryLabel(row)" class="warning">{{
							expiryLabel(row)
						}}</small>
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
			</article>
		</template>
		<div
			v-if="!props.loading && !props.loadingMore && !props.error && !props.rows.length"
			class="mobile-inventory-state"
		>
			暂无符合条件的物品
		</div>
		<div v-if="props.loadingMore" class="mobile-inventory-state" role="status">
			<span class="loading-spinner loading-spinner-small" aria-hidden="true"></span
			>正在加载更多记录…
		</div>
	</div>
</template>

<style scoped>
.mobile-inventory-list {
	display: grid;
	background: var(--ti-surface);
	border: 1px solid var(--ti-accent-soft);
	border-radius: var(--ti-radius-control);
}
.mobile-inventory-list > .ui-loading-boundary {
	display: none;
}
.mobile-inventory-state {
	padding: var(--ti-space-6) var(--ti-space-3);
	color: var(--ti-muted);
	text-align: center;
}
.mobile-inventory-list {
	position: relative;
}
.loading-state {
	display: grid;
	justify-items: center;
	gap: var(--ti-space-2);
	min-height: 150px;
}
.loading-state i {
	width: 92%;
	height: 32px;
	border-radius: var(--ti-radius-control);
	background: var(--ti-accent-soft);
}
.mobile-inventory-state.error {
	color: var(--ti-danger);
}
.mobile-inventory-row {
	display: grid;
	grid-template-columns: 64px minmax(0, 1fr) auto 10px;
	align-items: center;
	gap: var(--ti-space-2);
	min-height: 92px;
	padding: var(--ti-space-2);
	border: 0;
	border-bottom: 1px solid var(--ti-border);
	background: transparent;
	color: var(--ti-ink);
	text-align: left;
	cursor: pointer;
}
.mobile-inventory-row:focus-visible {
	outline: 3px solid var(--ti-accent);
	outline-offset: -2px;
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
	border-radius: var(--ti-radius-control);
	background: var(--ti-canvas);
	color: var(--ti-muted);
}
.mobile-row-image img {
	width: 100%;
	height: 100%;
	padding: 0;
	border: 0;
	object-fit: contain;
}
.mobile-row-image :deep(.mobile-row-image__asset) {
	width: 100%;
	height: 100%;
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
	font-size: var(--ti-font-small);
}
.mobile-row-copy > small {
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
}
.mobile-row-chips {
	display: flex;
	gap: var(--ti-space-1);
	margin-top: 2px;
}
.mobile-row-chips small {
	padding: 2px var(--ti-space-1);
	border-radius: var(--ti-radius-control);
	background: var(--ti-info-bg);
	color: var(--ti-info);
	font-size: var(--ti-font-small);
}
.mobile-row-chips :deep(.mobile-row-chip) {
	min-height: var(--ti-density-control);
	padding: var(--ti-space-2) var(--ti-space-2);
	border: 0;
	border-radius: var(--ti-radius-control);
	background: var(--ti-info-bg);
	color: var(--ti-info);
	font: inherit;
	font-size: var(--ti-font-small);
}
.mobile-row-chips :deep(.detail-popover) {
	display: inline-flex;
}
.mobile-row-chips .warning {
	display: inline-flex;
	box-sizing: border-box;
	min-height: var(--ti-density-control);
	align-items: center;
	justify-content: center;
	line-height: 1.2;
	background: var(--ti-warning-bg);
	color: var(--ti-warning);
}
.mobile-row-totals {
	color: var(--ti-muted) !important;
}
.mobile-row-quantity {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	color: var(--ti-success);
}
.mobile-row-quantity strong {
	font-size: var(--ti-font-section);
}
.mobile-row-quantity small {
	font-size: var(--ti-font-small);
}
.mobile-row-chevron {
	color: var(--ti-muted);
}
</style>
