<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import BackButton from "../../components/ui/BackButton.vue";
import { useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed } from "vue";
import type { ProductDetail } from "./useProductDetail";
import type { ReportQuery } from "../../lib/reportContract";
import ItemGallery from "../../components/ItemGallery.vue";
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
import PopupMenu from "../../components/ui/PopupMenu.vue";
import { useConfirm } from "../../services/confirm";
import { showToast } from "../../services/toast";
import UnitText from "../../components/ui/UnitText.vue";
import {
	productBatchColumns,
	productLocationColumns,
	productSerialColumns,
} from "./itemDetailColumns";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { exportFields } from "../../lib/exportColumns";
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
function serialMovementName(value: unknown) {
	return value && typeof value === "object" && "name" in value
		? String((value as { name: unknown }).name)
		: "";
}
function openSerialMovement(value: unknown) {
	if (!value || typeof value !== "object" || !("doctype" in value) || !("name" in value)) return;
	const movement = value as { doctype: string; name: string };
	emit("openDocument", movement.doctype, movement.name);
}
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
const trackingLabel = computed(() => {
	if (!item.value) return "";
	if (c.item.value?.has_serial_no) return "序列号";
	if (item.value.tracksBatch && item.value.tracksExpiry) return "批次 + 效期";
	if (item.value.tracksBatch) return "批次";
	return "不追踪";
});
const nonImageFiles = computed(() =>
	files.files.filter((file) => !file.type.startsWith("image/")),
);
const nonImageFilesController = computed(() => ({ ...files, files: nonImageFiles.value }));
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
const batchColumns = computed<DataColumn[]>(() => productBatchColumns);
const locationColumns = computed<DataColumn[]>(() => productLocationColumns);
const serialColumns = computed<DataColumn[]>(() => productSerialColumns);
const serialTableRows = computed<DataTableRecord[]>(() =>
	c.serialRows.value.map((serial) => ({
		kind: "record",
		id: String(serial.serial),
		value: serial,
	})),
);
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
		value: {
			...place,
			serial_nos: (c.item.value?.stock || [])
				.filter((row) => row.warehouse === place.location)
				.flatMap((row) => String(row.serial_nos || "").split("、"))
				.filter(Boolean)
				.sort()
				.join("、"),
			uom: item.value?.uom || "",
		} as unknown as Record<string, unknown>,
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
				computed(() => (c.item.value?.has_serial_no ? ["serial_nos"] : [])),
			)
		: undefined;
const productExportColumns = computed(() => {
	const visible = batchPrefs?.visible.value.length
		? batchPrefs.visible.value
		: productBatchColumns
				.filter((column) => column.defaultVisible !== false || column.required)
				.map((column) => String(column.id));
	const order = batchPrefs?.order.value.length
		? batchPrefs.order.value
		: productBatchColumns.map((column) => String(column.id));
	return exportFields(productBatchColumns, order, [...new Set([...visible, "uom"])]);
});
</script>
<template>
	<section class="browse-page">
		<PageHeader
			><div>
				<h1 tabindex="-1">物品详情</h1>
			</div>
			<template #back><BackButton @click="emit('back')" /></template
			><template #actions
				><QuickExport
					v-if="item"
					:query="c.exportQuery.value"
					table="locations"
					:columns="productExportColumns"
					title="物品详情"
					:active="active"
				/>
				<UiButton v-if="item" @click="emit('edit', item.code)">编辑物品资料</UiButton>
				<PopupMenu v-if="item" label="物品操作" align="end" sheet>
					<button
						type="button"
						:disabled="
							c.lifecycleBusy.value ||
							(lifecycleItem?.disabled === false && hasStock)
						"
						@click="toggleDisabled"
					>
						{{ lifecycleItem?.disabled ? "启用物品" : "停用物品" }}
					</button>
					<button
						type="button"
						class="danger"
						:disabled="c.lifecycleBusy.value || lifecycleItem?.can_delete !== true"
						@click="removeItem"
					>
						删除物品
					</button>
				</PopupMenu>
			</template></PageHeader
		>
		<SkeletonBlock v-if="loading && !item" variant="detail" :count="3" :rows="4" />
		<p v-if="error" class="notice-bar danger" role="alert">
			{{ error }} <UiButton @click="c.load">重新读取</UiButton>
		</p>
		<article v-if="item" class="browse-detail-card item-detail-card">
			<div class="item-detail-top">
				<ItemGallery class="browse-detail-image" :item="item" :attachments="files.files" />
				<div class="item-detail-facts">
					<div class="browse-grow">
						<span class="eyebrow"
							>{{ item.category ? `${item.category} · ` : "" }}{{ item.code }}</span
						>
						<h2>{{ item.name }}</h2>
						<span v-if="lifecycleItem?.disabled" class="item-disabled-badge"
							>已停用</span
						>
					</div>
					<div class="detail-stat-grid"><QuantitySummary :metrics="metrics" /></div>
					<dl class="browse-detail-grid item-facts-grid">
						<div v-if="item.barcode">
							<dt>条码</dt>
							<dd>{{ item.barcode }}</dd>
						</div>
						<div>
							<dt>单位</dt>
							<dd>
								<UnitText :name="item.uom" /><ItemConversions
									:item="item"
									inline
									@updated="c.conversionsUpdated"
									@dirty-change="c.conversionDirty.value = $event"
								/>
							</dd>
						</div>
						<div>
							<dt>追踪</dt>
							<dd>{{ trackingLabel }}</dd>
						</div>
						<div v-if="item.description">
							<dt>说明</dt>
							<dd class="content-long-text">{{ item.description }}</dd>
						</div>
					</dl>
				</div>
			</div>
			<DisclosureSection
				v-if="nonImageFiles.length"
				title="附件"
				:count="nonImageFiles.length"
			>
				<Attachments
					:controller="nonImageFilesController"
					image-role="attachments"
					mode="display"
				/>
			</DisclosureSection>
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
					批次信息</button
				><button
					v-if="c.item.value?.has_serial_no"
					:aria-current="tab === 'serials' ? 'page' : undefined"
					@click="emit('tab', 'serials')"
				>
					序列号
				</button>
			</nav>
			<section v-if="tab === 'serials'" class="browse-table-wrap" aria-label="物品序列号">
				<div class="browse-card-heading">
					<label class="form-field"
						>搜索序列号<input v-model="c.serialSearch.value" type="search"
					/></label>
					<label class="form-field"
						>状态<select v-model="c.serialStatus.value">
							<option value="Active">在库 / 借出 / 损坏</option>
							<option value="Loaned">借出</option>
							<option value="Damaged">损坏</option>
							<option value="Inactive">已出库</option>
							<option value="all">全部状态</option>
						</select></label
					>
				</div>
				<p v-if="c.serialError.value" class="notice-bar danger" role="alert">
					{{ c.serialError.value }}
					<UiButton @click="c.loadSerials(true)">重试</UiButton>
				</p>
				<DataTable
					v-if="!isMobile"
					ariaLabel="物品序列号"
					table-class="browse-table"
					:columns="serialColumns"
					:rows="serialTableRows"
					:loading="c.serialLoading.value"
					:initialized="true"
					empty-text="没有符合条件的序列号。"
				>
					<template #cell="{ column, row }">
						<UiButton
							v-if="column.id === 'last_movement' && row.last_movement"
							@click="openSerialMovement(row.last_movement)"
							>{{ serialMovementName(row.last_movement) }}</UiButton
						>
						<template v-else>{{ row[column.id] || "—" }}</template>
					</template>
				</DataTable>
				<ul v-else class="item-serial-rows">
					<li v-for="serial in c.serialRows.value" :key="String(serial.serial)">
						<strong>{{ serial.serial }}</strong
						><span>{{ serial.status }} · {{ serial.location || "—" }}</span>
						<UiButton
							v-if="serial.last_movement"
							@click="openSerialMovement(serial.last_movement)"
							>最近流动：{{ serialMovementName(serial.last_movement) }}</UiButton
						>
					</li>
				</ul>
				<UiButton
					v-if="c.serialNext.value !== null"
					:disabled="c.serialLoading.value"
					@click="c.loadSerials(false)"
					>加载更多</UiButton
				>
			</section>
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
						<template v-else-if="column.id === 'uom' || column.id === 'stock_uom'"
							><UnitText :name="row[column.id]"
						/></template>
						<template v-else>{{ row[column.id] ?? 0 }}</template>
					</template>
				</DataTable>
				<p v-if="!batches.length" class="browse-note">当前没有可显示的批次库存。</p>
			</div>
			<div v-else-if="tab === 'overview'" class="browse-table-wrap">
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
						<template v-else-if="column.id === 'uom' || column.id === 'stock_uom'"
							><UnitText :name="row[column.id]"
						/></template>
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
.item-detail-top {
	display: grid;
	grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
	gap: var(--p-space-6);
	align-items: start;
}
.item-detail-facts {
	min-width: 0;
}
.item-detail-top > .browse-detail-image {
	width: 100%;
	flex: initial;
	border-radius: 0;
	overflow: visible;
}
.item-facts-grid {
	margin-top: var(--p-space-3);
}
.item-facts-grid dd {
	overflow-wrap: anywhere;
}
.item-facts-grid dd :deep(.item-conversions) {
	margin-top: 4px;
}
.item-detail-card > :deep(.browse-tabs) {
	margin-top: var(--p-space-4);
}
.item-disabled-badge {
	display: inline-flex;
	border-radius: 999px;
	padding: 2px 8px;
	color: var(--p-warning);
	background: var(--p-warning-bg);
	font-size: 0.8rem;
}
@media (max-width: 1023px) {
	.item-detail-top {
		grid-template-columns: minmax(0, 1fr);
		gap: var(--p-space-3);
	}
	.browse-detail-card {
		margin-top: 8px;
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
