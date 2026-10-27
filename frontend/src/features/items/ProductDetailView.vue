<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import BackButton from "../../components/ui/BackButton.vue";
import { useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed } from "vue";
import type { ProductDetail } from "./useProductDetail";
import type { ReportQuery } from "../../lib/reportContract";
import ItemImage from "../../components/ItemImage.vue";
import Attachments from "../../components/Attachments.vue";
import QuickExport from "../../components/QuickExport.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import ItemConversions from "./ItemConversions.vue";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import DataTable from "../../components/ui/DataTable.vue";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { useOptionalInventoryServices } from "../../services/contracts";
import { useArrayTableSort } from "../../composables/useArrayTableSort";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import PopupMenu from "../../components/ui/PopupMenu.vue";
import { useConfirm } from "../../services/confirm";
import { showToast } from "../../services/toast";
const props = withDefaults(defineProps<{ controller: ProductDetail; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	edit: [code: string];
	back: [];
	tab: [value: string];
	browse: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	openExport: [query: ReportQuery];
	openBatch: [name: string];
	deleted: [];
}>();
const c = props.controller;
const { isMobile } = useResponsiveLayout();
const { confirm } = useConfirm();
const { stockItem: item, loading, error, tab, batches, files } = c;
const metrics = computed(() =>
	item.value
		? (
				[
					["available", "可用", "success"],
					["loaned", "借出", "warning"],
					["damaged", "损坏", "danger"],
				] as const
			).map(([key, label, tone]) => ({
				key,
				label,
				tone,
				quantities: [{ uom: item.value!.uom, qty: item.value![key] }],
			}))
		: [],
);
const warehouseReference = useOptionalReferenceData();
const services = useOptionalInventoryServices();
const lifecycleItem = computed(() => c.item.value);
const hasStock = computed(() =>
	Boolean(item.value && (item.value.available || item.value.loaned || item.value.damaged)),
);
async function toggleDisabled() {
	const current = lifecycleItem.value;
	if (!current) return;
	const disabled = !current.disabled;
	if (
		!(await confirm({
			title: disabled ? "停用物品？" : "启用物品？",
			message: disabled
				? "停用后，物品不会出现在可选物品列表中。"
				: "启用后，物品会重新出现在可选物品列表中。",
			confirmLabel: disabled ? "停用" : "启用",
		}))
	)
		return;
	try {
		await c.setDisabled(disabled);
		showToast(disabled ? "物品已停用" : "物品已启用");
	} catch (reason) {
		showToast(reason instanceof Error ? reason.message : "物品状态更新失败", "danger");
	}
}
async function removeItem() {
	const current = lifecycleItem.value;
	if (!current) return;
	if (
		!(await confirm({
			title: "删除物品？",
			message: "此操作无法撤销。",
			confirmLabel: "删除物品",
			tone: "danger",
		}))
	)
		return;
	try {
		if (await c.deleteItem()) {
			showToast("物品已删除");
			emit("deleted");
		}
	} catch (reason) {
		showToast(reason instanceof Error ? reason.message : "物品删除失败", "danger");
	}
}
const batchColumns = computed<DataColumn[]>(() => [
	{
		id: "batch_no",
		label: "批次",
		required: true,
		defaultVisible: true,
		sortable: true,
		minWidth: "160px",
	},
	{ id: "expiry", label: "效期", defaultVisible: true, sortable: true },
	{ id: "location", label: "位置", defaultVisible: true, sortable: true, minWidth: "180px" },
	{ id: "available", label: "可用量", defaultVisible: true, sortable: true },
	{ id: "loaned", label: "借出", defaultVisible: true, sortable: true },
	{ id: "damaged", label: "损坏", defaultVisible: true, sortable: true },
	{ id: "uom", label: "单位", defaultVisible: true, sortable: true },
]);
const locationColumns = computed<DataColumn[]>(() => [
	{
		id: "location",
		label: "存放位置",
		required: true,
		defaultVisible: true,
		sortable: true,
		minWidth: "180px",
	},
	{ id: "available", label: "可用", defaultVisible: true, sortable: true },
	{ id: "loaned", label: "借出", defaultVisible: true, sortable: true },
	{ id: "damaged", label: "损坏", defaultVisible: true, sortable: true },
	{ id: "uom", label: "单位", defaultVisible: true, sortable: true },
]);
const batchRows = computed<DataTableRecord[]>(() =>
	batches.value.map((batch, index) => ({
		kind: "record",
		id: `${batch.id}:${batch.location}:${index}`,
		value: { ...batch, uom: item.value?.uom || "" } as unknown as Record<string, unknown>,
	})),
);
const locationRows = computed<DataTableRecord[]>(() =>
	(item.value?.locations || []).map((place) => ({
		kind: "record",
		id: place.location,
		value: { ...place, uom: item.value?.uom || "" } as unknown as Record<string, unknown>,
	})),
);
const batchSort = useArrayTableSort(batchRows, "batch_no", [
	"batch_no",
	"expiry",
	"location",
	"available",
	"loaned",
	"damaged",
	"uom",
]);
const locationSort = useArrayTableSort(locationRows, "location", [
	"location",
	"available",
	"loaned",
	"damaged",
	"uom",
]);
const batchPrefs =
	services && warehouseReference
		? useColumnPreferences("item-detail.batches", batchColumns, warehouseReference, services)
		: undefined;
const locationPrefs =
	services && warehouseReference
		? useColumnPreferences(
				"item-detail.locations",
				locationColumns,
				warehouseReference,
				services,
			)
		: undefined;
</script>
<template>
	<section class="preview-browse-page">
		<PageHeader
			><div>
				<h1 tabindex="-1">物品详情</h1>
			</div>
			<template #back><BackButton @click="emit('back')" /></template
			><template #actions
				><QuickExport
					v-if="item"
					:query="c.exportQuery.value"
					:active="active"
					@open-full="emit('openExport', $event)" /></template
		></PageHeader>
		<SkeletonBlock v-if="loading && !item" variant="detail" :count="3" :rows="4" />
		<p v-if="error" class="notice-bar danger" role="alert">
			{{ error }} <UiButton @click="c.load">重新读取</UiButton>
		</p>
		<article v-if="item" class="browse-detail-card">
			<div class="browse-item-detail-head">
				<div class="browse-detail-image">
					<ItemImage :item="item" :fit="isMobile ? 'cover' : 'contain'" />
				</div>
				<div class="browse-grow">
					<span class="eyebrow"
						>{{ item.category ? `${item.category} · ` : "" }}{{ item.code }}</span
					>
					<h2>{{ item.name }}</h2>
					<p class="muted">按物品代码汇总的库存、借用与损坏情况</p>
					<span v-if="lifecycleItem?.disabled" class="item-disabled-badge">已停用</span>
				</div>
				<div class="item-detail-actions">
					<UiButton @click="emit('edit', item.code)">编辑物品资料</UiButton
					><PopupMenu label="物品操作" align="end" sheet
						><button
							type="button"
							:disabled="
								c.lifecycleBusy.value ||
								(lifecycleItem?.disabled === false && hasStock)
							"
							@click="toggleDisabled"
						>
							<span class="menu-item-stack"
								>{{ lifecycleItem?.disabled ? "启用物品" : "停用物品"
								}}<small
									v-if="lifecycleItem?.disabled === false && hasStock"
									class="menu-item-hint"
									>仍有库存（含借出、损坏），清零后才能停用</small
								></span
							></button
						><button
							type="button"
							class="danger"
							:disabled="c.lifecycleBusy.value || lifecycleItem?.can_delete !== true"
							@click="removeItem"
						>
							<span class="menu-item-stack"
								>删除物品<small
									v-if="lifecycleItem?.can_delete === false"
									class="menu-item-hint"
									>已被单据或其它记录引用，不能删除</small
								></span
							>
						</button></PopupMenu
					>
				</div>
			</div>
			<ItemConversions
				:item="item"
				@updated="c.conversionsUpdated"
				@dirty-change="c.conversionDirty.value = $event"
			/>
			<DisclosureSection title="物品资料与文件" :count="files.files.length">
				<dl class="browse-detail-grid">
					<div
						v-for="(value, label) in {
							物品编号: item.code,
							单位: item.uom,
							批次管理: item.tracksBatch ? '启用' : '不启用',
							记录效期: item.tracksExpiry ? '启用' : '不启用',
							条码: item.barcode || '未设置',
							说明: item.description || '无',
						}"
						:key="label"
					>
						<dt>{{ label }}</dt>
						<dd class="preview-long-text">{{ value }}</dd>
					</div>
				</dl>
				<h3>主图</h3>
				<Attachments :controller="files" images-only image-role="main" mode="display" />
				<h3>附件</h3>
				<Attachments :controller="files" image-role="attachments" mode="display" />
			</DisclosureSection>
			<div class="detail-stat-grid">
				<QuantitySummary :metrics="metrics" />
			</div>
			<nav class="browse-tabs" aria-label="物品库存视图">
				<button
					:aria-current="tab === 'overview' ? 'page' : undefined"
					@click="emit('tab', 'overview')"
				>
					库存分布</button
				><button
					v-if="item.tracksBatch"
					:aria-current="tab === 'batches' ? 'page' : undefined"
					@click="emit('tab', 'batches')"
				>
					批次信息
				</button>
			</nav>
			<div v-if="tab === 'batches'" class="browse-table-wrap">
				<DataTable
					ariaLabel="物品批次库存"
					table-class="browse-table"
					:columns="batchColumns"
					:rows="batchSort.rows.value"
					:loading="loading"
					:initialized="Boolean(item)"
					:sort-by="batchSort.sortBy.value"
					:sort-direction="batchSort.sortDirection.value"
					:column-preferences="batchPrefs"
					@sort="batchSort.setSort"
					empty-text="当前没有可显示的批次库存。"
				>
					<template #cell="{ column, row }">
						<UiButton
							v-if="column.id === 'batch_no'"
							:aria-label="`打开批次资料：${row.id}`"
							@click="emit('openBatch', String(row.id))"
							>{{ row.id }}</UiButton
						>
						<template v-else-if="column.id === 'expiry'">{{
							row.expiry || "无效期"
						}}</template>
						<template v-else-if="column.id === 'location'">{{
							warehouseLabel(
								String(row.location || ""),
								warehouseReference?.warehouses || [],
								String(row.label || ""),
							)
						}}</template>
						<template v-else>{{ row[column.id] ?? 0 }}</template>
					</template>
				</DataTable>
				<p v-if="!batches.length" class="browse-note">当前没有可显示的批次库存。</p>
			</div>
			<div v-else class="browse-table-wrap">
				<DataTable
					ariaLabel="物品库位余额"
					table-class="browse-table"
					:columns="locationColumns"
					:rows="locationSort.rows.value"
					:loading="loading"
					:initialized="Boolean(item)"
					:sort-by="locationSort.sortBy.value"
					:sort-direction="locationSort.sortDirection.value"
					:column-preferences="locationPrefs"
					@sort="locationSort.setSort"
					empty-text="此物品暂无库存。"
				>
					<template #cell="{ column, row }">
						<template v-if="column.id === 'location'">{{
							warehouseLabel(
								String(row.location || ""),
								warehouseReference?.warehouses || [],
								String(row.label || ""),
							)
						}}</template>
						<template v-else>{{ row[column.id] }}</template>
					</template>
				</DataTable>
				<p v-if="!item.locations.length" class="browse-note">此物品暂无库存。</p>
			</div>
			<DisclosureSection
				title="流动与借用历史"
				:count="`${c.movements.result.total} / ${c.loans.result.total}`"
				:summary="
					c.movements.result.rows[0]?.date_time
						? `最近 ${String(c.movements.result.rows[0].date_time).slice(0, 10)}`
						: undefined
				"
			>
				<div class="browse-card-heading">
					<h3>最近流动</h3>
					<UiButton @click="emit('browse', c.movementQuery.value)"
						>查看物品流动</UiButton
					>
				</div>
				<MovementHistoryTable
					:show-status="false"
					:rows="c.movements.result.rows"
					:total="c.movements.result.total"
					:next="c.movements.result.next"
					:loading="c.movements.result.loading"
					:initialized="c.movements.result.initialized"
					:error="c.movements.result.error"
					:stale="c.movements.result.stale"
					:sort-by="c.movements.sortBy.value"
					:sort-direction="c.movements.sortDirection.value"
					@load-more="c.movements.loadMore"
					@retry="c.movements.refresh"
					@sort="c.movements.setSort"
					@open-document="(doctype, name) => emit('openDocument', doctype, name)"
					@open-loan="(name) => emit('openLoan', name)"
				/>
				<div class="browse-card-heading">
					<h3>借用记录</h3>
					<UiButton @click="emit('browse', c.loanQuery.value)">查看物品借用</UiButton>
				</div>
				<MovementHistoryTable
					:show-status="false"
					mode="loan-allocation"
					:rows="c.loans.result.rows"
					:total="c.loans.result.total"
					:next="c.loans.result.next"
					:loading="c.loans.result.loading"
					:initialized="c.loans.result.initialized"
					:error="c.loans.result.error"
					:stale="c.loans.result.stale"
					:sort-by="c.loans.sortBy.value"
					:sort-direction="c.loans.sortDirection.value"
					@load-more="c.loans.loadMore"
					@retry="c.loans.refresh"
					@sort="c.loans.setSort"
					@open-document="(doctype, name) => emit('openDocument', doctype, name)"
					@open-loan="(name) => emit('openLoan', name)"
				/>
			</DisclosureSection>
		</article>
	</section>
</template>

<style scoped>
.item-detail-actions {
	display: flex;
	align-items: center;
	gap: 8px;
}
.item-disabled-badge {
	display: inline-flex;
	border-radius: 999px;
	padding: 2px 8px;
	color: var(--p-color-warning-800);
	background: var(--p-color-warning-100);
	font-size: 0.8rem;
}
@media (max-width: 1023px) {
	.browse-detail-card {
		margin-top: 8px;
	}
	.browse-item-detail-head {
		row-gap: 8px;
		margin-bottom: 12px;
	}
	.browse-item-detail-head h2 {
		margin-block: 2px 4px;
	}
	.browse-item-detail-head .muted {
		margin: 0;
	}
	.browse-detail-image {
		height: 140px;
		overflow: visible;
	}
	.browse-detail-image :deep(.item-image-button),
	.browse-detail-image :deep(.preview-item-image) {
		position: relative;
		width: 100%;
		height: 100%;
		aspect-ratio: 1;
	}
	.browse-detail-image :deep(.preview-image-detail) {
		display: block;
		width: 100%;
		aspect-ratio: 1;
	}
	.browse-detail-image :deep(.preview-image-enlarge) {
		position: absolute;
		right: 4px;
		bottom: 4px;
		z-index: 1;
	}
	.browse-detail-image :deep(.item-image-button .image-magnifier) {
		position: absolute;
		right: 8px;
		bottom: 24px;
		z-index: 1;
	}
	.detail-stat-grid :deep(.quantity-summary) {
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
	}
	.detail-stat-grid :deep(.quantity-summary > *) {
		min-width: 0;
		padding: 8px 6px;
	}
}
</style>
