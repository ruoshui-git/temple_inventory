<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import BackButton from "../../components/ui/BackButton.vue";
import type { NativeWarehouses } from "./useNativeWarehouses";
import type { ReportQuery } from "../../lib/reportContract";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import ItemLine from "../../components/ui/ItemLine.vue";
import ItemImage from "../../components/ItemImage.vue";
import DataTable from "../../components/ui/DataTable.vue";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { exportFields } from "../../lib/exportColumns";
import { useOptionalInventoryServices } from "../../services/contracts";
import AsyncRegion from "../../components/ui/AsyncRegion.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import PopupMenu from "../../components/ui/PopupMenu.vue";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import Overlay from "../../components/ui/Overlay.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import QuickExport from "../../components/QuickExport.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import FormField from "../../components/ui/FormField.vue";
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import { unitLabel } from "../../lib/units";
import { computed, ref } from "vue";
import { compareTableValues, nextTableSort } from "../../composables/useArrayTableSort";
import { warehouseColumnDefinitions } from "./warehouseColumns";
const props = withDefaults(
	defineProps<{ controller: NativeWarehouses; detail?: boolean; active?: boolean }>(),
	{ active: true },
);
const emit = defineEmits<{
	warehouse: [name: string];
	item: [code: string];
	back: [];
	browse: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	openExport: [query: ReportQuery];
	newCount: [warehouse: string];
	newOperation: [kind: string, warehouse: string];
}>();
const c = props.controller;
const {
	tree,
	selected,
	visibleRows,
	expanded,
	loading,
	error,
	search,
	dialogOpen,
	busy,
	formError,
	form,
	recoveryError,
	editing,
	deleteBusy,
	deleteError,
} = c;
const stockTable = c.stock.mainTable;
const services = useOptionalInventoryServices();
const stockSort = ref({ field: "item_name", direction: "asc" as "asc" | "desc" });
const stockColumns = warehouseColumnDefinitions;
const stockPreferences = services
	? useColumnPreferences(
			"warehouse.detail.stock",
			computed(() => stockColumns),
			c.reference,
			services,
		)
	: undefined;
const warehouseExportVisible = computed(() =>
	stockPreferences?.visible.value.length
		? stockPreferences.visible.value
		: stockColumns
				.filter((column) => column.defaultVisible !== false || column.required)
				.map((column) => String(column.id)),
);
const warehouseExportOrder = computed(() =>
	stockPreferences?.order.value.length
		? stockPreferences.order.value
		: stockColumns.map((column) => String(column.id)),
);
const warehouseExportColumns = computed(() =>
	exportFields(stockColumns, warehouseExportOrder.value, warehouseExportVisible.value),
);
const warehouseExportTitle = computed(
	() => `库房清单 · ${selected.value?.full_label || selected.value?.label || "实体仓库"}`,
);
const stockRows = computed<DataTableRecord[]>(() => {
	const values = [...(stockTable.value?.rows || [])].sort((a, b) => {
		const left = a[stockSort.value.field],
			right = b[stockSort.value.field];
		const comparison = compareTableValues(left, right);
		return stockSort.value.direction === "asc" ? comparison : -comparison;
	});
	return values.map((row) => ({ kind: "record", id: String(row.id), value: row }));
});
function sortStock(field: string) {
	stockSort.value = nextTableSort(field, stockSort.value.field, stockSort.value.direction);
}
function physicalType(value: string) {
	return (
		({ area: "区域", room: "房间", shelf: "货位", system: "系统" } as Record<string, string>)[
			value
		] || "位置"
	);
}
function kindIcon(value: string) {
	return (
		({ area: "area", room: "room", shelf: "shelf" } as Record<string, string>)[value] ||
		"warehouse"
	);
}
function toggle(name: string) {
	const next = new Set(expanded.value);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	expanded.value = next;
}
function addChild(row: { name: string }, kind: "area" | "room" | "shelf") {
	c.select(row.name);
	c.openEditor(undefined, "create", kind);
}
function parentLabel(name?: string) {
	if (!name || name === tree.value?.physical_root) return "实体仓库";
	const parent = tree.value?.rows.find((row) => row.name === name);
	return parent?.full_label || parent?.label || "实体仓库";
}
</script>
<template>
	<ReturnToTop :active="active" />
	<section class="browse-page">
		<PageHeader v-if="detail"
			><div>
				<h1 tabindex="-1">{{ detail ? selected?.full_label || "位置详情" : "仓库" }}</h1>
			</div>
			<template #back
				><BackButton v-if="detail" label="返回" @click="emit('back')" /></template
			><template #actions
				><UiButton
					:disabled="busy"
					:loading="loading"
					loading-label="正在刷新仓库…"
					@click="c.load"
					>刷新</UiButton
				>
				<QuickExport
					v-if="c.canUseSelection.value"
					:query="c.stockQuery.value"
					:title="warehouseExportTitle"
					table="locations"
					:columns="warehouseExportColumns"
					:active="active"
				/> </template
		></PageHeader>
		<BrowseToolbar
			v-if="!detail"
			title="仓库"
			:summary="`仓库 · ${visibleRows.length} 个节点`"
			v-model:search="search"
			search-label="搜索仓库"
			:active="active"
		>
			<template #subtitle>{{ visibleRows.length }} 个节点</template>
			<template #actions>
				<BrowseOverflowMenu>
					<UiButton :disabled="busy" :loading="loading" @click="c.load">刷新</UiButton>
					<QuickExport
						v-if="c.canUseSelection.value"
						:query="c.stockQuery.value"
						:title="warehouseExportTitle"
						table="locations"
						:columns="warehouseExportColumns"
						:active="active"
					/>
				</BrowseOverflowMenu>
				<UiButton
					v-if="tree?.can_create"
					variant="primary"
					@click="
						c.select(tree.physical_root);
						c.openEditor(undefined, 'create', 'area');
					"
					>添加区域</UiButton
				>
			</template>
		</BrowseToolbar>
		<div v-if="loading && !tree" class="browse-warehouse-layout" aria-hidden="true">
			<div class="browse-warehouse-tree surface form-section">
				<SkeletonBlock variant="list" :rows="7" />
			</div>
			<div class="surface form-section">
				<SkeletonBlock variant="detail" :count="3" :rows="5" />
			</div>
		</div>
		<p v-if="error" class="utility-error" role="alert">{{ error }}</p>
		<BrowseResultSummary
			v-if="!detail && tree"
			:label="`${visibleRows.length} 个仓库节点`"
			:metrics="[]"
		/>
		<p v-if="recoveryError" class="utility-error" role="alert">{{ recoveryError }}</p>
		<p v-if="deleteError" class="notice-bar danger" role="alert">{{ deleteError }}</p>
		<template v-if="tree && !error">
			<div :class="{ 'browse-warehouse-layout': !detail }">
				<div v-if="!detail" class="browse-warehouse-tree">
					<div class="browse-card-heading">
						<div>
							<h2>位置结构</h2>
						</div>
					</div>
					<div
						v-for="row in visibleRows"
						:key="row.name"
						:data-browse-row="'warehouse:' + row.name"
						class="browse-tree-row"
						:class="{ 'is-selected': selected?.name === row.name }"
						:style="{ '--tree-depth': Math.min(row.depth, 4) }"
						role="group"
						:aria-label="row.label"
					>
						<button
							v-if="row.is_group"
							class="browse-link warehouse-toggle"
							:aria-label="(expanded.has(row.name) ? '收起' : '展开') + row.label"
							:aria-expanded="expanded.has(row.name)"
							@click="toggle(row.name)"
						>
							<DisclosureIcon variant="inline" /></button
						><span v-else class="warehouse-toggle" aria-hidden="true"></span>
						<span class="browse-tree-type" aria-hidden="true"
							><InventoryIcon :name="kindIcon(row.kind)"
						/></span>
						<button
							class="browse-grow browse-link"
							type="button"
							:aria-pressed="selected?.name === row.name"
							@click="c.select(row.name)"
						>
							<strong :title="row.full_label">{{
								row.local_label || row.label
							}}</strong
							><small
								>{{ physicalType(row.kind)
								}}{{ row.disabled ? " · 已停用" : "" }}</small
							>
						</button>
					</div>
					<p
						v-if="
							tree.needs_first_room || !tree.rows.some((row) => row.kind === 'room')
						"
						class="browse-empty compact"
					>
						<UiButton
							v-if="tree.can_create"
							variant="primary"
							@click="c.openEditor(undefined, 'create', 'room')"
							>添加第一个房间</UiButton
						>
					</p>
					<p v-else-if="!visibleRows.length" class="browse-empty compact">
						没有符合搜索的位置。
					</p>
				</div>
				<article v-if="selected" :class="detail ? 'browse-detail-card' : 'browse-card'">
					<div class="browse-card-heading">
						<div>
							<h2>{{ selected.full_label }}</h2>
							<p v-if="selected.path && selected.path !== selected.name">
								{{ selected.path }}
							</p>
							<p v-if="selected.short_label">简称 {{ selected.short_label }}</p>
						</div>
						<div class="warehouse-detail-actions">
							<UiButton v-if="deleteBusy" variant="danger" :loading="true" disabled
								>正在删除位置…</UiButton
							>
							<UiButton
								v-if="selected.kind === 'area' && tree.can_create"
								variant="primary"
								@click="addChild(selected, 'room')"
								>添加房间</UiButton
							>
							<UiButton
								v-else-if="selected.kind === 'room' && tree.can_create"
								variant="primary"
								@click="addChild(selected, 'shelf')"
								>添加货位</UiButton
							>
							<UiButton
								v-else-if="
									selected.kind === 'shelf' &&
									selected.can_edit &&
									!selected.protected
								"
								variant="primary"
								@click="c.subdivide(selected)"
								>细分</UiButton
							>
							<UiButton
								v-if="selected.kind === 'area' && tree.can_create"
								@click="addChild(selected, 'area')"
								>添加区域</UiButton
							>
							<UiButton
								v-if="
									selected.missing_direct &&
									selected.can_edit &&
									!selected.protected
								"
								@click="c.repair(selected)"
								>缺少直接存放位置 · 补建</UiButton
							>
							<PopupMenu
								v-if="selected.can_edit && !selected.protected"
								label="更多位置操作"
								variant="icon"
								align="end"
								class="warehouse-action-menu"
							>
								<button type="button" @click="c.openEditor(selected, 'rename')">
									<InventoryIcon class="menu-item-icon" name="settings" />
									重命名
								</button>
								<button type="button" @click="c.openEditor(selected, 'move')">
									<InventoryIcon class="menu-item-icon" name="transfer" />
									移动
								</button>
								<button type="button" @click="c.toggleDisabled(selected)">
									<InventoryIcon class="menu-item-icon" name="adjust" />
									{{ selected.disabled ? "启用" : "停用" }}
								</button>
								<button
									type="button"
									class="is-danger-text"
									:disabled="deleteBusy"
									@click="c.deleteLocation(selected)"
								>
									<InventoryIcon class="menu-item-icon" name="trash" />
									{{ deleteBusy ? "正在删除…" : "删除" }}
								</button>
							</PopupMenu>
							<DisclosureSection title="ERPNext 信息" summary="系统字段与层级信息">
								<dl class="browse-detail-grid">
									<div>
										<dt>名称</dt>
										<dd>
											<code>{{ selected.name }}</code>
										</dd>
									</div>
									<div v-if="selected.owner">
										<dt>直接存放位置</dt>
										<dd>
											<code>{{ selected.owner }}</code>
										</dd>
									</div>
								</dl>
							</DisclosureSection>
						</div>
					</div>
					<dl class="browse-detail-grid">
						<div>
							<dt>物理类型</dt>
							<dd>{{ physicalType(selected.kind) }}</dd>
						</div>
						<div>
							<dt>上级</dt>
							<dd>{{ parentLabel(selected.parent) }}</dd>
						</div>
						<div>
							<dt>状态</dt>
							<dd>{{ selected.disabled ? "停用" : "启用" }}</dd>
						</div>
					</dl>
					<p v-if="c.stock.result.error" role="alert">
						{{ c.stock.result.error }}
						<UiButton @click="c.stock.refresh">重试库存</UiButton>
					</p>
					<AsyncRegion
						:loading="c.stock.result.loading"
						:initialized="Boolean(stockTable?.initialized)"
						:stale="Boolean(stockTable?.initialized)"
						:error="c.stock.result.error"
						label="此范围库存刷新中。"
					>
						<template #skeleton><SkeletonBlock variant="lines" :count="3" /></template>
						<QuantitySummary
							v-if="stockTable?.initialized"
							:metrics="[
								{
									key: 'stock',
									label: '当前范围库存',
									quantities: c.stock.result.summary.map((row) => ({
										uom: String(row.stock_uom),
										qty: Number(row.stock_qty),
									})),
								},
							]"
						/>
						<div
							v-if="stockTable?.rows.length"
							class="browse-rank-list warehouse-stock-cards"
						>
							<button
								v-for="row in stockTable.rows"
								:key="String(row.id)"
								:data-browse-row="'stock:' + String(row.id)"
								class="browse-rank-row"
								@click="emit('item', String(row.item_code))"
							>
								<div class="browse-grow">
									<ItemLine
										:item="{
											code: String(row.item_code),
											name: String(row.item_name || row.item_code),
											image: String(row.image || ''),
										}"
									/>
									<dl class="ti-fields">
										<div>
											<dt>编号</dt>
											<dd>{{ row.item_code }}</dd>
										</div>
										<div>
											<dt>库位</dt>
											<dd
												:title="
													warehousePath(
														row.warehouse,
														c.reference.warehouses,
														row.warehouse_label,
													)
												"
											>
												{{
													warehouseLabel(
														row.warehouse,
														c.reference.warehouses,
														row.warehouse_label,
													)
												}}
											</dd>
										</div>
										<div v-if="row.batch_no">
											<dt>批次</dt>
											<dd>{{ row.batch_no }}</dd>
										</div>
									</dl>
								</div>
								<b
									>{{ row.stock_qty }}
									<small>{{ unitLabel(String(row.stock_uom || "")) }}</small></b
								>
							</button>
						</div>
						<BrowseResultSummary
							v-if="stockTable?.rows.length"
							:label="`${stockRows.length} 项物品库存`"
							:metrics="[]"
						/>
						<DataTable
							v-if="stockTable?.rows.length"
							ariaLabel="仓库物品库存"
							:columns="stockColumns"
							:rows="stockRows"
							:column-preferences="stockPreferences"
							:sort-by="stockSort.field"
							:sort-direction="stockSort.direction"
							class="warehouse-stock-table"
							@sort="sortStock"
						>
							<template #cell="{ column, row }">
								<ItemImage
									v-if="column.id === 'image'"
									:item="{
										code: String(row.item_code),
										name: String(row.item_name || row.item_code),
										image: String(row.image || ''),
									}"
									:thumbnail-size="24"
									:target-size="24"
								/>
								<button
									v-else-if="column.id === 'item_name'"
									class="browse-link warehouse-item-name"
									@click="emit('item', String(row.item_code))"
								>
									<strong>{{ row.item_name || row.item_code }}</strong>
								</button>
								<span
									v-else-if="column.id === 'item_code'"
									class="warehouse-nowrap"
									>{{ row.item_code }}</span
								>
								<span
									v-else-if="column.id === 'warehouse_label'"
									:title="
										String(
											row.warehouse_path ||
												warehousePath(
													row.warehouse,
													c.reference.warehouses,
													row.warehouse_label,
												),
										)
									"
									>{{
										warehouseLabel(
											row.warehouse,
											c.reference.warehouses,
											row.warehouse_label,
										)
									}}</span
								>
								<span v-else-if="column.id === 'warehouse_path'">{{
									row.warehouse_path || "—"
								}}</span>
								<span v-else-if="column.id === 'warehouse_native_name'">{{
									row.warehouse_native_name || "—"
								}}</span>
								<span v-else-if="column.id === 'batch_no'">{{
									row.batch_no || "—"
								}}</span>
								<span
									v-else-if="column.id === 'stock_qty'"
									class="warehouse-nowrap tabular-nums"
									>{{
										`${row.stock_qty} ${unitLabel(String(row.stock_uom || ""))}`
									}}</span
								>
								<span v-else-if="column.id === 'stock_uom'">{{
									unitLabel(String(row.stock_uom || ""))
								}}</span>
							</template>
						</DataTable>
						<p
							v-else-if="
								stockTable?.initialized &&
								!c.stock.result.loading &&
								!c.stock.result.error
							"
							class="browse-empty compact"
						>
							此范围暂无库存。
						</p>
						<p v-if="stockTable?.error" role="alert">{{ stockTable.error }}</p>
						<UiButton
							v-if="stockTable?.next !== null && stockTable?.next !== undefined"
							:disabled="stockTable.loading || c.stock.result.stale"
							:loading="stockTable.loading"
							loading-label="正在加载库存…"
							@click="c.stock.loadTable(stockTable, true)"
							>加载更多库存 · {{ stockTable.rows.length }} /
							{{ stockTable.total }}</UiButton
						>
					</AsyncRegion>
					<div class="browse-actions">
						<UiButton
							v-for="action in c.operationActions.value"
							:key="action.kind"
							:icon="action.icon"
							@click="emit('newOperation', action.kind, selected.name)"
							>{{ action.label }}</UiButton
						>
						<UiButton
							:disabled="!c.canUseSelection.value"
							icon="box"
							@click="emit('browse', c.stockQuery.value)"
							>查看完整库存范围</UiButton
						><UiButton
							v-if="c.canCount.value"
							icon="count"
							@click="emit('newCount', selected.name)"
							>盘点此库位</UiButton
						>
					</div>
					<template v-if="detail"
						><h2>最近流动</h2>
						<MovementHistoryTable
							:show-status="false"
							:rows="c.history.result.rows"
							:total="c.history.result.total"
							:next="c.history.result.next"
							:loading="c.history.result.loading"
							:initialized="c.history.result.initialized"
							:error="c.history.result.error"
							:stale="c.history.result.stale"
							:sort-by="c.history.sortBy.value"
							:sort-direction="c.history.sortDirection.value"
							include-item
							@load-more="c.history.loadMore"
							@retry="c.history.refresh"
							@sort="c.history.setSort"
							@open-document="(doctype, name) => emit('openDocument', doctype, name)"
							@open-loan="emit('openLoan', $event)"
							@open-item="emit('item', $event)"
					/></template>
				</article>
			</div>
		</template>
		<Overlay
			v-if="dialogOpen && active"
			:title="
				c.action.value === 'move'
					? '移动位置'
					: c.action.value === 'rename'
						? '重命名位置'
						: `添加${physicalType(form.kind)}`
			"
			:dismissible="!busy"
			@close="c.close"
			><p v-if="formError" class="utility-error" role="alert">{{ formError }}</p>
			<p v-if="recoveryError" role="alert">{{ recoveryError }}</p>
			<form
				id="native-warehouse-form"
				class="browse-dialog"
				novalidate
				@submit.prevent="c.save"
			>
				<FormField
					v-if="c.action.value !== 'move'"
					label="名称"
					required
					:error="c.validation.errors['warehouse-label']"
					><template #default="{ fieldAttrs }"
						><input
							data-warehouse-name
							v-model="form.label"
							v-bind="fieldAttrs"
							autocomplete="off" /></template
				></FormField>
				<FormField
					v-if="c.action.value !== 'move'"
					label="简称"
					hint="填写后会在位置路径中显示简称。"
					><template #default="{ fieldAttrs }"
						><input
							v-model="form.short_label"
							v-bind="fieldAttrs"
							autocomplete="off" /></template
				></FormField>
				<FormField
					v-if="c.action.value !== 'rename'"
					:label="c.action.value === 'move' ? '新上级位置' : '上级位置'"
					required
					:error="c.validation.errors['warehouse-parent']"
				>
					<template #default="{ fieldAttrs }"
						><SearchSelect
							v-model="form.parent"
							:label="c.action.value === 'move' ? '新上级位置' : '上级位置'"
							external-label
							:options="c.parentOptions.value"
							v-bind="fieldAttrs"
					/></template>
				</FormField>
				<p v-if="c.action.value === 'move'">可选上级仅显示符合此位置类型的启用节点。</p>
			</form>
			<template #footer
				><UiButton :disabled="busy" @click="c.close">取消</UiButton
				><UiButton
					variant="primary"
					type="submit"
					form="native-warehouse-form"
					:disabled="busy"
					>{{ busy ? "正在保存…" : "保存仓库资料" }}</UiButton
				></template
			>
		</Overlay>
	</section>
</template>
<style scoped>
.browse-grow {
	min-width: 0;
	overflow-wrap: anywhere;
}
.browse-tree-row .browse-grow {
	display: block;
	text-align: left;
}
.browse-grow strong,
.browse-grow small {
	display: block;
}
.warehouse-detail-actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: var(--p-space-3);
}
.warehouse-toggle {
	flex: 0 0 32px;
	width: 32px;
	min-height: 32px;
}
.browse-tree-row .browse-tree-type {
	width: 32px;
	height: 32px;
}
.browse-tree-row .browse-grow {
	padding: var(--p-space-2);
	border-radius: var(--p-radius-control);
}
.browse-tree-row.is-selected .browse-grow {
	background: var(--p-soft);
}
@media (max-width: 1023px) {
	.browse-card-heading {
		flex-direction: column;
		align-items: flex-start;
	}
	.browse-tree-row {
		display: grid;
		grid-template-columns: 32px 32px minmax(0, 1fr);
		gap: var(--p-space-2);
		padding-left: calc(min(var(--tree-depth, 0), 4) * 8px);
	}
	.browse-tree-row > button {
		min-height: 40px;
		min-width: 0;
	}
	.warehouse-detail-actions {
		width: 100%;
	}
}
</style>
