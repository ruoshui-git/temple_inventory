<script setup lang="ts">
import InventoryIcon from "./InventoryIcon.vue";
import DetailPopover from "./DetailPopover.vue";
import AsyncImage from "./AsyncImage.vue";

type ExpiryRow = {
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
		rows: ExpiryRow[];
		warehouseLabel?: (name: string) => string;
		loading?: boolean;
		loadingMore?: boolean;
		error?: string;
	}>(),
	{ loading: false, loadingMore: false, error: "" },
);
const emit = defineEmits<{ activate: [row: ExpiryRow]; retry: [] }>();
const format = (value: number) => Number(value || 0).toLocaleString("zh-CN");
const relative = (days?: number | null) => {
	if (days == null) return "无效期";
	if (days < 0) return `已过期 ${Math.abs(days)} 天`;
	if (days === 0) return "今天到期";
	return `剩余 ${days} 天`;
};
function activateKey(row: ExpiryRow, event: KeyboardEvent) {
	if (event.target instanceof Element && event.target.closest("[data-row-control]")) return;
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	emit("activate", row);
}
function activate(row: ExpiryRow, event: Event) {
	if (event.target instanceof Element && event.target.closest("[data-row-control]")) return;
	emit("activate", row);
}
</script>

<template>
	<div
		class="mobile-expiry-results"
		:class="{ 'is-refreshing': props.loading && props.rows.length }"
		role="list"
		aria-label="效期批次列表"
		:aria-busy="props.loading || props.loadingMore"
	>
		<div v-if="props.loading && props.rows.length" class="mobile-expiry-refresh" role="status">
			<span class="loading-spinner" aria-hidden="true"></span>正在更新记录…
		</div>
		<div
			v-if="props.loading && !props.rows.length"
			class="mobile-expiry-state loading-state"
			role="status"
		>
			<span class="loading-spinner" aria-hidden="true"></span><b>正在加载记录…</b
			><i v-for="index in 3" :key="index"></i>
		</div>
		<div v-else-if="props.error" class="mobile-expiry-state error" role="alert">
			{{ props.error }} <button type="button" @click="emit('retry')">重试</button>
		</div>
		<template v-if="props.rows.length">
			<article
				v-for="row in props.rows"
				:key="row.batch_no"
				class="mobile-expiry-result-row"
				role="listitem"
				tabindex="0"
				@click="activate(row, $event)"
				@keydown="activateKey(row, $event)"
			>
				<span class="mobile-expiry-result-image">
					<AsyncImage
						v-if="row.image"
						:src="row.image"
						:alt="row.item_name"
						class="mobile-expiry-result-image__asset"
					/>
					<InventoryIcon v-else name="box" />
				</span>
				<span class="mobile-expiry-result-copy">
					<b>{{ row.item_name }}</b>
					<small
						>{{ row.item_code }} · 批次 {{ row.batch_no }} ·
						{{ row.item_group }}</small
					>
					<span class="expiry-result-chips" data-row-control>
						<DetailPopover
							v-if="row.locations?.length"
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
									props.warehouseLabel?.(location.warehouse) ||
									location.warehouse
								}}：{{ format(location.qty) }} {{ row.stock_uom }}
							</p>
						</DetailPopover>
					</span>
				</span>
				<span
					class="mobile-expiry-result-status"
					:class="{ overdue: Number(row.days_to_expiry) < 0 }"
				>
					<b>{{ row.expiry_date || "无效期" }}</b>
					<small>{{ relative(row.days_to_expiry) }}</small>
					<strong>{{ format(row.total_qty) }} {{ row.stock_uom }}</strong>
				</span>
				<span aria-hidden="true" class="mobile-expiry-result-chevron">›</span>
			</article>
		</template>
		<p
			v-if="!props.loading && !props.loadingMore && !props.error && !props.rows.length"
			class="empty-state"
		>
			暂无符合条件的批次
		</p>
		<div v-if="props.loadingMore" class="mobile-expiry-state" role="status">
			<span class="loading-spinner loading-spinner-small" aria-hidden="true"></span
			>正在加载更多记录…
		</div>
	</div>
</template>

<style scoped>
.mobile-expiry-results {
	display: grid;
	background: #fff;
	border: 1px solid #ece8e1;
	border-radius: 9px;
}
.mobile-expiry-state {
	padding: 26px 12px;
	color: #6d747b;
	text-align: center;
}
.mobile-expiry-results {
	position: relative;
}
.mobile-expiry-results.is-refreshing > :not(.mobile-expiry-refresh) {
	opacity: 0.55;
	pointer-events: none;
}
.mobile-expiry-refresh {
	position: absolute;
	inset: 0;
	z-index: 2;
	display: flex;
	justify-content: center;
	gap: 8px;
	padding-top: 18px;
	background: rgb(255 255 255 / 62%);
	color: #704d2e;
	font-weight: 700;
	pointer-events: none;
}
.loading-state {
	display: grid;
	justify-items: center;
	gap: 8px;
	min-height: 150px;
}
.loading-state i {
	width: 92%;
	height: 32px;
	border-radius: 8px;
	background: #f0ebe3;
}
.mobile-expiry-state.error {
	color: #b42318;
}
.mobile-expiry-state button {
	margin-left: 6px;
	color: #8a571e;
}
.mobile-expiry-result-row {
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
	cursor: pointer;
}
.mobile-expiry-result-row:last-of-type {
	border-bottom: 0;
}
.mobile-expiry-result-image {
	display: grid;
	width: 62px;
	aspect-ratio: 1;
	place-items: center;
	overflow: hidden;
	border-radius: 7px;
	background: #f6f4ef;
	color: #aaa397;
}
.mobile-expiry-result-image img {
	width: 100%;
	height: 100%;
	padding: 0;
	border: 0;
	object-fit: contain;
}
.mobile-expiry-result-image :deep(.mobile-expiry-result-image__asset) {
	width: 100%;
	height: 100%;
}
.mobile-expiry-result-copy {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 3px;
}
.mobile-expiry-result-copy b,
.mobile-expiry-result-copy small {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.mobile-expiry-result-copy b {
	font-size: 13px;
}
.mobile-expiry-result-copy small {
	color: #78818b;
	font-size: 10px;
}
.expiry-result-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 3px;
}
.expiry-result-chips :deep(.detail-popover-trigger) {
	min-height: 44px;
	padding-inline: 8px;
	font-size: 10px;
}
.expired-location {
	color: #b42318;
}
.mobile-expiry-result-status {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	font-variant-numeric: tabular-nums;
}
.mobile-expiry-result-status b,
.mobile-expiry-result-status small {
	color: #ef661e;
	font-size: 10px;
}
.mobile-expiry-result-status.overdue b,
.mobile-expiry-result-status.overdue small {
	color: #c43c35;
}
.mobile-expiry-result-status strong {
	margin-top: 6px;
	color: #087a48;
	font-size: 13px;
}
.mobile-expiry-result-chevron {
	color: #a19a90;
}
</style>
