<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import ForbiddenState from "../../components/ui/ForbiddenState.vue";
import { useBackNavigation } from "../../composables/useBackNavigation";
import { routeTarget } from "../../lib/routeRegistry";
import BrowseOverflowMenu from "../../components/ui/BrowseOverflowMenu.vue";
import BackButton from "../../components/ui/BackButton.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import type { NativeWarehouses } from "./useNativeWarehouses";
import type { ReportQuery } from "../../lib/reportContract";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import PopupMenu from "../../components/ui/PopupMenu.vue";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import Overlay from "../../components/ui/Overlay.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import FormField from "../../components/ui/FormField.vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
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
const { goBack } = useBackNavigation();
const back = () => goBack(routeTarget("home"));
const { isMobile } = useResponsiveLayout();
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
				></template
			></PageHeader
		>
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
					<UiButton
						icon="refresh"
						:disabled="busy"
						:loading="loading"
						@click="c.load(true)"
						>刷新</UiButton
					>
				</BrowseOverflowMenu>
				<UiButton
					v-if="tree?.can_create && !isMobile"
					variant="primary"
					@click="
						c.select(tree.physical_root);
						c.openEditor(undefined, 'create', 'area');
					"
					>添加区域</UiButton
				>
				<BrowseSplitButton
					v-if="tree?.can_create && isMobile"
					label="添加区域"
					kind="Warehouse"
					icon="warehouse"
					:options="[]"
					@select="c.openEditor(undefined, 'create', 'area')"
				/>
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
		<ForbiddenState v-if="c.forbidden.value" @back="back" />
		<p v-else-if="error" class="utility-error" role="alert">{{ error }}</p>
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
							@click="isMobile ? emit('warehouse', row.name) : c.select(row.name)"
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
				<article
					v-if="selected && (detail || !isMobile)"
					:class="detail ? 'browse-detail-card' : 'browse-card'"
				>
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
								v-if="
									selected.can_edit &&
									!selected.protected &&
									c.reference.capabilities?.warehouse?.write === true
								"
								label="更多位置操作"
								variant="icon"
								align="end"
								class="warehouse-action-menu"
							>
								<button
									v-if="c.reference.capabilities?.warehouse?.write === true"
									type="button"
									@click="c.openEditor(selected, 'rename')"
								>
									<InventoryIcon class="menu-item-icon" name="settings" />
									重命名
								</button>
								<button
									v-if="c.reference.capabilities?.warehouse?.write === true"
									type="button"
									@click="c.openEditor(selected, 'move')"
								>
									<InventoryIcon class="menu-item-icon" name="transfer" />
									移动
								</button>
								<button
									v-if="c.reference.capabilities?.warehouse?.write === true"
									type="button"
									@click="c.toggleDisabled(selected)"
								>
									<InventoryIcon class="menu-item-icon" name="adjust" />
									{{ selected.disabled ? "启用" : "停用" }}
								</button>
								<button
									type="button"
									class="is-danger-text"
									v-if="c.reference.capabilities?.warehouse?.delete === true"
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
					<div class="warehouse-stock-summary">
						<h3>库存合计</h3>
						<p v-if="c.stockSummaryError.value" role="alert">
							{{ c.stockSummaryError.value }}
							<UiButton @click="c.loadStockSummary(selected.name)">重试</UiButton>
						</p>
						<SkeletonBlock
							v-else-if="c.stockSummaryLoading.value"
							variant="lines"
							:count="2"
						/>
						<p v-else-if="!c.stockSummary.value.length" class="muted">暂无库存</p>
						<QuantitySummary
							v-else-if="c.stockSummary.value.length"
							:metrics="[
								{
									key: 'stock',
									label: '此位置及下级位置',
									quantities: c.stockSummary.value.map((row) => ({
										uom: row.stock_uom,
										qty: row.stock_qty,
									})),
								},
							]"
						/>
					</div>
					<UiButton icon="box" @click="emit('browse', c.stockQuery.value)"
						>查看库存</UiButton
					>
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
	padding: var(--p-field-gap) var(--p-control-gap);
	border-radius: var(--p-radius-control);
}
.browse-tree-row {
	min-height: var(--p-cell-control);
	gap: var(--p-control-gap);
	padding-block: var(--p-table-cell-y);
	padding-inline-end: var(--p-table-cell-x);
	padding-inline-start: calc(var(--p-table-cell-x) + min(var(--tree-depth, 0), 4) * 10px);
}
.browse-tree-row .browse-tree-type {
	width: var(--p-table-thumbnail);
	height: var(--p-table-thumbnail);
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
		grid-template-columns: 44px var(--p-table-thumbnail) minmax(0, 1fr);
		gap: var(--p-field-gap);
		padding-block: var(--p-control-pad-y);
		padding-left: calc(min(var(--tree-depth, 0), 4) * 8px);
	}
	.browse-tree-row > button {
		min-height: 44px;
		min-width: 0;
	}
	.browse-tree-row .browse-grow {
		padding: var(--p-field-gap) var(--p-control-gap);
	}
	.warehouse-detail-actions {
		width: 100%;
	}
}
</style>
