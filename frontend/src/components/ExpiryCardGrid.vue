<script setup lang="ts">
import { formatExpiryDuration } from "../lib/duration";
import ImageForwardCard from "./ImageForwardCard.vue";
import InventoryIcon from "./InventoryIcon.vue";
import DetailPopover from "./DetailPopover.vue";

export type ExpiryCardRow = {
	batch_no: string;
	item_code: string;
	item_name: string;
	item_group: string;
	image?: string | null;
	stock_uom: string;
	total_qty: number;
	expiry_date?: string | null;
	days_to_expiry?: number | null;
	locations?: Array<{ warehouse: string; qty: number }>;
};

const props = withDefaults(
	defineProps<{
		rows: ExpiryCardRow[];
		warehouseLabel?: (name: string) => string;
		loading?: boolean;
		loadingMore?: boolean;
		error?: string;
		compactMobile?: boolean;
	}>(),
	{ loading: false, loadingMore: false, error: "", compactMobile: false },
);
const emit = defineEmits<{ activate: [row: ExpiryCardRow]; retry: [] }>();
const format = (value: number) =>
	new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(Number(value || 0));
function activateKey(row: ExpiryCardRow, event: KeyboardEvent) {
	if (event.target instanceof Element && event.target.closest("[data-card-control]")) return;
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	emit("activate", row);
}
function activate(row: ExpiryCardRow, event: Event) {
	if (event.target instanceof Element && event.target.closest("[data-card-control]")) return;
	emit("activate", row);
}
</script>

<template>
	<div
		class="expiry-card-grid"
		:class="{ 'compact-mobile': compactMobile, 'is-refreshing': loading && rows.length }"
		:aria-busy="loading || loadingMore"
	>
		<div v-if="loading && rows.length" class="expiry-refresh-overlay" role="status">
			<span class="loading-spinner" aria-hidden="true"></span>正在更新记录…
		</div>
		<div v-if="loading && !rows.length" class="expiry-loading-state" role="status">
			<span class="loading-spinner" aria-hidden="true"></span><b>正在加载记录…</b
			><i v-for="index in 3" :key="index"></i>
		</div>
		<div v-else-if="error" class="expiry-card-state error" role="alert">
			{{ error }} <button type="button" @click="emit('retry')">重试</button>
		</div>
		<article
			v-for="row in rows"
			:key="row.batch_no"
			class="expiry-batch-card mobile-expiry-card"
			:class="{
				overdue: Number(row.days_to_expiry) < 0,
				soon: Number(row.days_to_expiry) >= 0 && Number(row.days_to_expiry) <= 30,
			}"
			role="listitem"
			tabindex="0"
			@click="activate(row, $event)"
			@keydown="activateKey(row, $event)"
		>
			<ImageForwardCard :image="row.image" :alt="row.item_name">
				<template #placeholder><InventoryIcon name="box" /></template>
				<small>{{ row.item_group }}</small>
				<h3>{{ row.item_name }}</h3>
				<p>{{ row.item_code }} · 批次 {{ row.batch_no }}</p>
				<strong>{{ format(row.total_qty) }} {{ row.stock_uom }}</strong>
				<p class="expiry-date">
					{{ row.expiry_date ? `到期 ${row.expiry_date}` : "无效期"
					}}<span v-if="row.days_to_expiry != null">
						· {{ formatExpiryDuration(row.days_to_expiry) }}</span
					>
				</p>
				<div v-if="row.locations?.length" class="expiry-chip-row" data-card-control>
					<DetailPopover
						:label="`${row.item_name}的库位信息`"
						:trigger-text="`${row.locations.length} 个库位`"
					>
						<p
							v-for="location in row.locations"
							:key="location.warehouse"
							:class="{ 'expired-location': Number(row.days_to_expiry) < 0 }"
						>
							<strong v-if="Number(row.days_to_expiry) < 0">已过期 · </strong
							>{{
								props.warehouseLabel?.(location.warehouse) || location.warehouse
							}}：{{ format(location.qty) }} {{ row.stock_uom }}
						</p>
					</DetailPopover>
				</div>
			</ImageForwardCard>
		</article>
		<p v-if="!loading && !loadingMore && !error && !rows.length" class="expiry-card-state">
			暂无符合条件的批次
		</p>
		<div v-if="loadingMore" class="expiry-loading-more" role="status">
			<span class="loading-spinner loading-spinner-small" aria-hidden="true"></span
			>正在加载更多记录…
		</div>
	</div>
</template>

<style scoped>
.expiry-card-grid {
	position: relative;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(245px, 1fr));
	gap: 12px;
	padding: 12px;
}
.expiry-refresh-overlay {
	position: absolute;
	inset: 0;
	z-index: 2;
	display: flex;
	justify-content: center;
	gap: 8px;
	padding-top: 18px;
	background: rgb(255 253 249 / 58%);
	color: #704d2e;
	font-weight: 700;
	pointer-events: none;
}
.expiry-card-grid.is-refreshing > .expiry-batch-card {
	opacity: 0.55;
	pointer-events: none;
}
.expiry-loading-state {
	display: grid;
	grid-column: 1 / -1;
	justify-items: center;
	gap: 10px;
	min-height: 190px;
}
.expiry-loading-state i {
	width: min(92%, 360px);
	height: 42px;
	border-radius: 9px;
	background: #f0ebe3;
}
.expiry-loading-more,
.expiry-card-state {
	grid-column: 1 / -1;
	padding: 24px;
	text-align: center;
	color: #64748b;
}
.expiry-loading-more {
	padding: 12px;
	color: #704d2e;
}
.expiry-card-state.error {
	color: #b42318;
}
.expiry-batch-card {
	display: flex;
	min-width: 0;
	flex-direction: column;
	overflow: hidden;
	border: 1px solid var(--border-color, #e2e8f0);
	border-radius: 8px;
	background: #fff;
	color: inherit;
	cursor: pointer;
}
.expiry-batch-card:hover,
.expiry-batch-card:focus-visible {
	border-color: #94a3b8;
	box-shadow: 0 3px 12px rgb(15 23 42 / 8%);
	outline: none;
}
.expiry-batch-card.overdue {
	border-left: 3px solid #dc2626;
}
.expiry-batch-card.soon {
	border-left: 3px solid #d97706;
}
.expiry-batch-card :deep(.image-forward-card__media) {
	width: 100%;
	aspect-ratio: 1;
	background: #f1f5f9;
}
.expiry-batch-card :deep(.image-forward-card__body) {
	min-width: 0;
	padding: 12px;
}
.expiry-batch-card h3 {
	margin: 2px 0;
	font-size: 14px;
	line-height: 1.3;
}
.expiry-batch-card p,
.expiry-batch-card small {
	margin: 2px 0;
	color: #64748b;
	font-size: 12px;
}
.expiry-batch-card strong {
	font-size: 15px;
}
.expiry-date {
	margin-top: 8px !important;
}
.location-line {
	display: block;
}
.expiry-chip-row {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 4px;
}
.expiry-chip-row :deep(.detail-popover-trigger),
.expiry-batch-card :deep(.detail-popover-trigger) {
	min-height: 44px;
}
.expired-location {
	color: #b42318;
}
.loading-spinner-small {
	display: inline-block;
	width: 16px;
	height: 16px;
	margin-right: 6px;
	vertical-align: -3px;
	border-width: 2px;
}
@media (max-width: 1023px) {
	.expiry-card-grid.compact-mobile {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		padding: 4px 0 12px;
		background: #f8f7f4;
	}
	.compact-mobile .expiry-batch-card :deep(.image-forward-card__media) {
		aspect-ratio: 1.08;
	}
	.compact-mobile .expiry-batch-card :deep(.image-forward-card__body) {
		padding: 8px;
	}
	.compact-mobile .expiry-batch-card h3 {
		font-size: 13px;
	}
	.compact-mobile .expiry-batch-card p,
	.compact-mobile .expiry-batch-card small {
		font-size: 10px;
	}
}
</style>
