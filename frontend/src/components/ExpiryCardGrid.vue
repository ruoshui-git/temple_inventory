<script setup lang="ts">
import { ref } from "vue";
import { formatExpiryDuration } from "../lib/duration";
import ImageForwardCard from "./ImageForwardCard.vue";
import InventoryIcon from "./InventoryIcon.vue";
import DetailPopover from "./DetailPopover.vue";
import UiLoadingBoundary from "./UiLoadingBoundary.vue";

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
const contentRoot = ref<HTMLElement>();
const format = (value: number) =>
	new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(Number(value || 0));
function activateKey(row: ExpiryCardRow, event: KeyboardEvent) {
	if (props.loading && props.rows.length) return;
	if (event.target instanceof Element && event.target.closest("[data-card-control]")) return;
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	emit("activate", row);
}
function activate(row: ExpiryCardRow, event: Event) {
	if (props.loading && props.rows.length) return;
	if (event.target instanceof Element && event.target.closest("[data-card-control]")) return;
	emit("activate", row);
}
</script>

<template>
	<div
		ref="contentRoot"
		class="expiry-card-grid"
		:class="{ 'compact-mobile': compactMobile }"
		:aria-busy="loading || loadingMore"
	>
		<UiLoadingBoundary
			v-if="loading"
			:busy="true"
			:mode="rows.length ? 'refresh' : 'initial'"
			:region="contentRoot"
			:dim-region="true"
			:block-interactions="false"
		/>
		<div v-if="loading && !rows.length" class="expiry-loading-state" aria-hidden="true">
			<b>正在加载记录…</b><i v-for="index in 3" :key="index"></i>
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
			:inert="loading ? true : undefined"
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
	gap: var(--ti-density-gap);
	padding: calc(var(--ti-density-gap) / 2);
}
.expiry-card-grid > .ui-loading-boundary {
	display: none;
}
.expiry-loading-state {
	display: grid;
	grid-column: 1 / -1;
	justify-items: center;
	gap: var(--ti-space-2);
	min-height: 190px;
}
.expiry-loading-state i {
	width: min(92%, 360px);
	height: 42px;
	border-radius: var(--ti-radius-control);
	background: var(--ti-accent-soft);
}
.expiry-loading-more,
.expiry-card-state {
	grid-column: 1 / -1;
	padding: var(--ti-space-6);
	text-align: center;
	color: var(--ti-muted);
}
.expiry-loading-more {
	padding: calc(var(--ti-density-gap) / 2);
	color: var(--ti-accent);
}
.expiry-card-state.error {
	color: var(--ti-danger);
}
.expiry-batch-card {
	display: flex;
	min-width: 0;
	flex-direction: column;
	overflow: hidden;
	border: 1px solid var(--border-color, var(--ti-border));
	border-radius: var(--ti-radius-card);
	background: var(--ti-surface);
	color: inherit;
	cursor: pointer;
}
.expiry-batch-card:hover,
.expiry-batch-card:focus-visible {
	border-color: var(--ti-border-strong);
	box-shadow: var(--ti-shadow-card);
	outline: none;
}
.expiry-batch-card.overdue {
	border-left: 3px solid var(--ti-danger);
}
.expiry-batch-card.soon {
	border-left: 3px solid var(--ti-warning);
}
.expiry-batch-card :deep(.image-forward-card__media) {
	width: 100%;
	aspect-ratio: 1;
	background: var(--ti-surface-raised);
}
.expiry-batch-card :deep(.image-forward-card__body) {
	min-width: 0;
	padding: var(--ti-density-row-gap);
}
.expiry-batch-card h3 {
	margin: 2px 0;
	font-size: var(--ti-font-body);
	line-height: 1.3;
}
.expiry-batch-card p,
.expiry-batch-card small {
	margin: 2px 0;
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
}
.expiry-batch-card strong {
	font-size: var(--ti-font-section);
}
.expiry-date {
	margin-top: var(--ti-space-2) !important;
}
.location-line {
	display: block;
}
.expiry-chip-row {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: var(--ti-space-1);
}
.expiry-chip-row :deep(.detail-popover-trigger),
.expiry-batch-card :deep(.detail-popover-trigger) {
	min-height: var(--ti-density-control);
}
.expired-location {
	color: var(--ti-danger);
}
.loading-spinner-small {
	display: inline-block;
	width: 16px;
	height: 16px;
	margin-right: var(--ti-space-1);
	vertical-align: -3px;
	border-width: 2px;
}
@media (max-width: 1023px) {
	.expiry-card-grid.compact-mobile {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--ti-density-gap);
		padding: var(--ti-space-1) 0 var(--ti-space-3);
		background: var(--ti-canvas);
	}
	.compact-mobile .expiry-batch-card :deep(.image-forward-card__media) {
		aspect-ratio: 1.08;
	}
	.compact-mobile .expiry-batch-card :deep(.image-forward-card__body) {
		padding: calc(var(--ti-density-gap) / 2);
	}
	.compact-mobile .expiry-batch-card h3 {
		font-size: var(--ti-font-small);
	}
	.compact-mobile .expiry-batch-card p,
	.compact-mobile .expiry-batch-card small {
		font-size: var(--ti-font-small);
	}
}
</style>
