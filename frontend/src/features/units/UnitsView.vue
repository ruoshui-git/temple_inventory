<script setup lang="ts">
import { computed, ref } from "vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import DataTable from "../../components/ui/DataTable.vue";
import FormField from "../../components/ui/FormField.vue";
import Overlay from "../../components/ui/Overlay.vue";
import PopupMenu from "../../components/ui/PopupMenu.vue";
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import UiButton from "../../components/ui/UiButton.vue";
import type { DataColumn, DataTableEntry, DataTableRecord } from "../../lib/dataTable";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { useArrayTableSort } from "../../composables/useArrayTableSort";
import type { useUnitsController } from "./useUnitsController";
import type { UnitRow } from "../../services/units";
import { useCapabilities } from "../../composables/useCapabilities";
import ForbiddenState from "../../components/ui/ForbiddenState.vue";
import { useBackNavigation } from "../../composables/useBackNavigation";
import { routeTarget } from "../../lib/routeRegistry";
import BrowseResultSummary from "../../components/ui/BrowseResultSummary.vue";
import BrowseEmpty from "../../components/ui/BrowseEmpty.vue";
import { presentationText } from "../../lib/presentationLabels";
import { unitGroupExpanded } from "../../lib/unitBrowse";

const props = defineProps<{ controller: ReturnType<typeof useUnitsController> }>();
const c = props.controller;
const { goBack } = useBackNavigation();
const back = () => goBack(routeTarget("stock"));
const { isMobile } = useResponsiveLayout();
const { can } = useCapabilities();
const mayCreate = computed(() => can("uom.create"));
const mayWrite = computed(() => can("uom.write"));
const mayDelete = computed(() => can("uom.delete"));
// The server refuses to disable a unit that Items still use.
function inUse(row: Record<string, unknown>) {
	return Boolean(row.enabled) && Number(row.item_count) + Number(row.conversion_count) > 0;
}
function usedByItems(row: Record<string, unknown>) {
	return Number(row.item_count) + Number(row.conversion_count) > 0;
}
function isRemainder(row: Record<string, unknown>) {
	return row.unitRemainder === true;
}
function usage(row: Record<string, unknown>) {
	return `库存单位物品 ${row.item_count} 项，物品单位换算 ${row.conversion_count} 项`;
}
const columns: DataColumn[] = [
	{ id: "label", label: "显示名称", kind: "primary", required: true, pinned: "start" },
	{ id: "name", label: "单位名称", kind: "code" },
	{ id: "category", label: "单位类别", kind: "text" },
	{ id: "must_be_whole_number", label: "整数", kind: "chip" },
	{ id: "enabled", label: "状态", kind: "status" },
	{ id: "item_count", label: "使用物品", kind: "number", align: "end" },
	{ id: "conversion_count", label: "换算", kind: "number", align: "end" },
	{ id: "actions", label: "操作", kind: "actions" },
];
const recordRows = computed<DataTableRecord[]>(() =>
	c.visible.value.map((row) => ({
		kind: "record",
		id: row.name,
		value: row,
	})),
);
const sorting = useArrayTableSort(recordRows, "category", [
	"label",
	"name",
	"category",
	"must_be_whole_number",
	"enabled",
	"item_count",
	"conversion_count",
]);
const expandedGroups = ref(new Set<string>());
const collapsedGroups = ref(new Set<string>());
const expandedUnused = ref(new Set<string>());
const groupedRows = computed<DataTableEntry[]>(() => {
	const groups = new Map<string, DataTableRecord[]>();
	for (const row of sorting.rows.value) {
		const category = String(row.value.category || "未分类");
		const entries = groups.get(category) || [];
		entries.push(row);
		groups.set(category, entries);
	}
	const result: DataTableEntry[] = [];
	const allRows = c.rows?.value || c.visible.value;
	const allCategories = new Map<string, number>();
	for (const row of allRows) {
		const category = String(row.category || "未分类");
		allCategories.set(
			category,
			(allCategories.get(category) || 0) +
				Number(row.item_count) +
				Number(row.conversion_count),
		);
	}
	const defaultExpanded = new Set(
		[...allCategories.entries()]
			.filter(([, itemCount]) => itemCount > 0)
			.map(([group]) => `category:${group}`),
	);
	if (!defaultExpanded.size) {
		const firstCategory = allCategories.has("未分类")
			? "未分类"
			: [...allCategories.keys()].sort((a, b) => a.localeCompare(b, "zh-CN"))[0];
		if (firstCategory) defaultExpanded.add(`category:${firstCategory}`);
	}
	const filtering = Boolean(
		c.search.value.trim() ||
		c.categoryFilter.value ||
		c.wholeFilter.value !== "all" ||
		c.statusFilter.value !== "all",
	);
	for (const category of [...groups.keys()].sort((a, b) => a.localeCompare(b, "zh-CN"))) {
		const rows = groups.get(category) || [];
		const id = `category:${category}`;
		const expanded = unitGroupExpanded(
			id,
			defaultExpanded,
			filtering,
			expandedGroups.value,
			collapsedGroups.value,
		);
		result.push({
			kind: "group",
			id,
			label: category,
			labelColumn: "label",
			countColumn: "label",
			depth: 0,
			count: rows.length,
			countLabel: "个单位",
			expanded,
			hasChildren: rows.length > 0,
			value: { category },
		});
		if (expanded) {
			const usedRows = rows.filter((row) => usedByItems(row.value));
			const unusedRows = rows.filter((row) => !usedByItems(row.value));
			if (filtering) result.push(...rows);
			else {
				result.push(...usedRows);
				if (unusedRows.length) {
					const remainderId = `unused:${category}`;
					const expandedRemainder = expandedUnused.value.has(remainderId);
					result.push({
						kind: "record",
						id: remainderId,
						value: {
							unitRemainder: true,
							category,
							remaining: unusedRows.length,
							expanded: expandedRemainder,
						},
					});
					if (expandedRemainder) result.push(...unusedRows);
				}
			}
		}
	}
	return result;
});
function toggleGroup(id: string) {
	const group = groupedRows.value.find((entry) => entry.kind === "group" && entry.id === id);
	const expanded = group?.kind === "group" && group.expanded;
	if (expanded) {
		collapsedGroups.value = new Set([...collapsedGroups.value, id]);
		expandedGroups.value.delete(id);
	} else {
		expandedGroups.value = new Set([...expandedGroups.value, id]);
		collapsedGroups.value.delete(id);
	}
}
function toggleUnused(category: string) {
	const id = `unused:${category}`;
	const next = new Set(expandedUnused.value);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	expandedUnused.value = next;
}
function remainderLabel(row: Record<string, unknown>) {
	return `${row.expanded ? "收起" : "显示"}其余 ${row.remaining} 个单位`;
}
const filterCount = computed(
	() =>
		Number(Boolean(c.categoryFilter.value)) +
		Number(c.wholeFilter.value !== "all") +
		Number(c.statusFilter.value !== "all"),
);
const filterLabels = computed(() => ({
	category: c.categoryFilter.value === "__uncategorized" ? "无分类" : c.categoryFilter.value,
	whole: c.wholeFilter.value === "whole" ? "整数" : "可小数",
	status: c.statusFilter.value === "enabled" ? "启用" : "停用",
}));
</script>

<template>
	<div class="app-shell units-page">
		<BrowseToolbar
			title="单位"
			summary="管理计量单位与显示名称"
			v-model:search="c.search.value"
			search-label="搜索单位名称或显示名称"
			:filter-count="filterCount"
		>
			<template #actions>
				<UiButton v-if="!isMobile && mayCreate" variant="primary" @click="c.openCreate"
					>新建单位</UiButton
				>
				<BrowseSplitButton
					v-else-if="mayCreate"
					label="新建单位"
					kind="Unit"
					icon="box"
					:options="[]"
					@select="c.openCreate"
				/>
			</template>
			<template #chips="{ editFilter }">
				<BrowseChip
					v-if="c.categoryFilter.value"
					:label="`单位类别：${filterLabels.category}`"
					@edit="editFilter('category')"
					@remove="c.categoryFilter.value = ''"
				/>
				<BrowseChip
					v-if="c.wholeFilter.value !== 'all'"
					:label="`整数：${filterLabels.whole}`"
					@edit="editFilter('whole')"
					@remove="c.wholeFilter.value = 'all'"
				/>
				<BrowseChip
					v-if="c.statusFilter.value !== 'all'"
					:label="`状态：${filterLabels.status}`"
					@edit="editFilter('status')"
					@remove="c.statusFilter.value = 'all'"
				/>
			</template>
			<template #filters>
				<div class="browse-filter-fields units-filter-fields">
					<label class="form-field"
						>单位类别<select v-model="c.categoryFilter.value">
							<option value="">全部类别</option>
							<option value="__uncategorized">无分类</option>
							<option
								v-for="row in c.categories.value"
								:key="row.name"
								:value="row.name"
							>
								{{ row.name }}
							</option>
						</select></label
					>
					<label class="form-field"
						>整数<select v-model="c.wholeFilter.value">
							<option value="all">全部</option>
							<option value="whole">整数</option>
							<option value="fractional">可小数</option>
						</select></label
					>
					<label class="form-field"
						>状态<select v-model="c.statusFilter.value">
							<option value="all">全部</option>
							<option value="enabled">启用</option>
							<option value="disabled">停用</option>
						</select></label
					>
				</div>
			</template>
		</BrowseToolbar>
		<BrowseResultSummary
			v-if="c.forbidden?.value !== true && c.initialized.value"
			:label="`${c.visible.value.length} 个单位`"
			:metrics="[]"
		/>
		<ForbiddenState v-if="c.forbidden?.value === true" @back="back" />
		<p v-else-if="c.refreshError.value" class="notice-bar danger" role="alert">
			{{ c.refreshError.value }}
			<UiButton :loading="c.loading.value" @click="c.refresh">重新读取</UiButton>
		</p>
		<DataTable
			v-if="!isMobile && c.forbidden?.value !== true"
			ariaLabel="计量单位"
			:columns="columns"
			:rows="groupedRows"
			:loading="c.loading.value"
			:initialized="c.initialized.value"
			:loading-text="presentationText.loading"
			:sort-by="sorting.sortBy.value"
			:sort-direction="sorting.sortDirection.value"
			empty-text="没有匹配的单位"
			@retry="c.refresh"
			@sort="sorting.setSort"
			@toggle-group="toggleGroup"
		>
			<template #cell="{ column, row }">
				<UiButton
					v-if="isRemainder(row) && column.id === 'label'"
					class="units-rest-toggle"
					variant="ghost"
					@click.stop="toggleUnused(String(row.category))"
					>{{ remainderLabel(row) }}</UiButton
				>
				<template v-else-if="isRemainder(row)"></template>
				<template v-else-if="column.id === 'must_be_whole_number'">{{
					row.must_be_whole_number ? "整数" : "可小数"
				}}</template>
				<template v-else-if="column.id === 'enabled'">{{
					row.enabled ? "启用" : "停用"
				}}</template>
				<PopupMenu
					v-else-if="column.id === 'actions' && (mayWrite || mayDelete)"
					label="单位操作"
					variant="icon"
					align="end"
				>
					<UiButton v-if="mayWrite" icon="settings" @click="c.openEdit(row as never)"
						>编辑</UiButton
					>
					<UiButton
						v-if="mayWrite"
						icon="warning"
						:disabled="inUse(row)"
						@click="c.toggleEnabled(row as never)"
					>
						<span class="menu-item-label">{{ row.enabled ? "停用" : "启用" }}</span
						><small v-if="inUse(row)" class="unit-delete-reason"
							>正在使用：{{ usage(row) }}</small
						>
					</UiButton>
					<UiButton
						v-if="mayDelete"
						icon="disposal"
						variant="danger"
						:disabled="!row.deletable"
						:title="row.deletable ? undefined : String(row.delete_reason)"
						@click="c.remove(row as never)"
					>
						<span class="menu-item-label">删除</span
						><small v-if="!row.deletable" class="unit-delete-reason">{{
							row.delete_reason
						}}</small>
					</UiButton>
				</PopupMenu>
				<template v-else>{{ row[String(column.id)] }}</template>
			</template>
		</DataTable>
		<div
			v-else-if="c.forbidden?.value !== true"
			class="units-phone-rows"
			aria-label="计量单位"
		>
			<template v-for="entry in groupedRows" :key="entry.id">
				<button
					v-if="entry.kind === 'group'"
					type="button"
					class="units-phone-group"
					:aria-expanded="entry.expanded"
					@click="toggleGroup(entry.id)"
				>
					<DisclosureIcon variant="inline" />
					{{ entry.label }} <small>{{ entry.count }} 个单位</small>
				</button>
				<article v-else-if="isRemainder(entry.value)" class="units-rest-row">
					<UiButton
						class="units-rest-toggle"
						variant="ghost"
						@click="toggleUnused(String(entry.value.category))"
						>{{ remainderLabel(entry.value) }}</UiButton
					>
				</article>
				<article v-else :key="entry.id" class="units-phone-card">
					<template v-for="row in [entry.value]" :key="String(row.name)">
						<div class="units-phone-identity">
							<strong>{{ row.label }}</strong>
							<code>{{ row.name }}</code>
						</div>
						<div class="units-phone-details">
							<span>{{ row.must_be_whole_number ? "整数" : "可小数" }}</span>
							<span>{{ row.enabled ? "启用" : "停用" }}</span>
							<span>单位类别 {{ row.category || "—" }}</span>
							<span>使用物品 {{ row.item_count }}</span>
							<span>换算 {{ row.conversion_count }}</span>
						</div>
						<PopupMenu
							label="单位操作"
							variant="icon"
							align="end"
							class="units-phone-actions"
							v-if="mayWrite || mayDelete"
						>
							<UiButton
								v-if="mayWrite"
								icon="settings"
								@click="c.openEdit(row as never)"
								>编辑</UiButton
							>
							<UiButton
								v-if="mayWrite"
								icon="warning"
								:disabled="inUse(row)"
								@click="c.toggleEnabled(row as never)"
							>
								<span class="menu-item-label">{{
									row.enabled ? "停用" : "启用"
								}}</span
								><small v-if="inUse(row)" class="unit-delete-reason"
									>正在使用：{{ usage(row) }}</small
								>
							</UiButton>
							<UiButton
								v-if="mayDelete"
								icon="disposal"
								variant="danger"
								:disabled="!row.deletable"
								:title="row.deletable ? undefined : String(row.delete_reason)"
								@click="c.remove(row as never)"
							>
								<span class="menu-item-label">删除</span
								><small v-if="!row.deletable" class="unit-delete-reason">{{
									row.delete_reason
								}}</small>
							</UiButton>
						</PopupMenu>
					</template>
				</article>
			</template>
			<BrowseEmpty
				v-if="!c.visible.value.length && c.initialized.value"
				text="没有匹配的单位"
			/>
		</div>
		<Overlay
			v-if="c.dialog.value"
			:title="c.editing.value ? '编辑单位' : '新建单位'"
			initial-focus="[data-unit-name]"
			:dismissible="!c.saving.value"
			@close="c.dialog.value = false"
		>
			<form id="unit-form" class="unit-form" novalidate @submit.prevent="c.save">
				<FormField
					v-if="!c.editing.value"
					label="单位名称"
					required
					:error="c.validation.errors['unit-name']"
				>
					<template #default="{ fieldAttrs }"
						><input
							v-bind="fieldAttrs"
							v-model="c.name.value"
							data-unit-name
							autocomplete="off"
					/></template>
				</FormField>
				<FormField
					label="显示名称"
					hint="留空时使用单位名称作为显示名称"
					:error="c.labelError.value"
				>
					<template #default="{ fieldAttrs }"
						><input v-bind="fieldAttrs" v-model="c.label.value" autocomplete="off"
					/></template>
				</FormField>
				<label class="unit-checkbox"
					><input v-model="c.whole.value" type="checkbox" /> 必须为整数</label
				>
				<FormField label="单位类别">
					<template #default="{ fieldAttrs }">
						<select v-bind="fieldAttrs" v-model="c.category.value">
							<option value="">未分类</option>
							<option
								v-for="option in c.categories.value"
								:key="option.name"
								:value="option.name"
							>
								{{ option.name }}
							</option>
						</select>
					</template>
				</FormField>
				<div v-if="mayWrite" class="unit-category-create">
					<input
						v-model="c.categoryName.value"
						aria-label="新单位类别名称"
						placeholder="新单位类别名称"
					/>
					<UiButton :disabled="!c.categoryName.value.trim()" @click="c.addCategory"
						>创建类别</UiButton
					>
				</div>
				<label v-if="c.editing.value" class="unit-checkbox"
					><input v-model="c.enabled.value" type="checkbox" /> 启用</label
				>
				<p v-if="c.error.value" role="alert">{{ c.error.value }}</p>
			</form>
			<template #footer>
				<UiButton :disabled="c.saving.value" @click="c.dialog.value = false">{{
					presentationText.dismiss
				}}</UiButton>
				<UiButton
					variant="primary"
					type="submit"
					form="unit-form"
					:loading="c.saving.value"
					>{{ presentationText.save }}</UiButton
				>
			</template>
		</Overlay>
	</div>
</template>

<style scoped>
.units-page {
	padding-bottom: calc(32px + env(safe-area-inset-bottom, 0px));
}
.unit-delete-reason {
	display: block;
	flex: 1 0 100%;
	max-width: none;
	padding-inline-start: 26px;
	white-space: normal;
	color: var(--p-muted);
	font-weight: 400;
}
.menu-item-label {
	white-space: nowrap;
}
.unit-form {
	display: grid;
	gap: 16px;
}
.units-phone-rows {
	display: grid;
	gap: 8px;
	margin-top: 12px;
}
.units-phone-card {
	position: relative;
	display: grid;
	gap: 8px;
	padding: 12px 56px 12px 14px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
}
.units-phone-group {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 44px;
	padding-inline: 8px;
	border: 0;
	background: transparent;
	color: var(--p-ink);
	text-align: left;
	font-weight: 650;
}
.units-phone-group small {
	color: var(--p-muted);
	font-weight: 400;
}
.units-rest-row {
	display: grid;
	grid-column: 1 / -1;
}
.units-rest-toggle {
	min-height: 44px;
	justify-content: flex-start;
	color: var(--p-accent);
}
.units-phone-identity {
	display: grid;
	gap: 3px;
	min-width: 0;
}
.units-phone-identity strong {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.units-phone-identity code {
	color: var(--p-muted);
	font-size: var(--p-small);
}
.units-phone-details {
	display: flex;
	flex-wrap: wrap;
	gap: 5px 12px;
	color: var(--p-muted);
	font-size: var(--p-small);
}
.units-phone-actions {
	position: absolute;
	inset-block-start: 8px;
	inset-inline-end: 8px;
}
.unit-checkbox {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 36px;
}
</style>
