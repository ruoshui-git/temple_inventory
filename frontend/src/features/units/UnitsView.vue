<script setup lang="ts">
import { computed } from "vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import DataTable from "../../components/ui/DataTable.vue";
import FormField from "../../components/ui/FormField.vue";
import Overlay from "../../components/ui/Overlay.vue";
import PopupMenu from "../../components/ui/PopupMenu.vue";
import UiButton from "../../components/ui/UiButton.vue";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import type { useUnitsController } from "./useUnitsController";

const props = defineProps<{ controller: ReturnType<typeof useUnitsController> }>();
const c = props.controller;
const { isMobile } = useResponsiveLayout();
// The server refuses to disable a unit that Items still use.
function inUse(row: Record<string, unknown>) {
	return Boolean(row.enabled) && Number(row.item_count) + Number(row.conversion_count) > 0;
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
const tableRows = computed<DataTableRecord[]>(() =>
	c.visible.value.map((row) => ({
		kind: "record",
		id: row.name,
		value: row as unknown as Record<string, unknown>,
	})),
);
</script>

<template>
	<div class="app-shell units-page">
		<BrowseToolbar
			title="单位"
			summary="管理计量单位与显示名称"
			v-model:search="c.search.value"
			search-label="搜索单位名称或显示名称"
		>
			<template #actions
				><UiButton variant="primary" @click="c.openCreate">新建单位</UiButton></template
			>
		</BrowseToolbar>
		<p v-if="c.refreshError.value" class="notice-bar danger" role="alert">
			{{ c.refreshError.value }}
			<UiButton :loading="c.loading.value" @click="c.refresh">重新读取</UiButton>
		</p>
		<DataTable
			v-if="!isMobile"
			ariaLabel="计量单位"
			:columns="columns"
			:rows="tableRows"
			:loading="c.loading.value"
			:initialized="c.initialized.value"
			empty-text="没有匹配的单位"
			@retry="c.refresh"
		>
			<template #cell="{ column, row }">
				<template v-if="column.id === 'must_be_whole_number'">{{
					row.must_be_whole_number ? "整数" : "可小数"
				}}</template>
				<template v-else-if="column.id === 'enabled'">{{
					row.enabled ? "启用" : "停用"
				}}</template>
				<PopupMenu
					v-else-if="column.id === 'actions'"
					label="单位操作"
					variant="icon"
					align="end"
				>
					<UiButton icon="settings" @click="c.openEdit(row as never)">编辑</UiButton>
					<UiButton
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
		<div v-else class="units-phone-rows" aria-label="计量单位">
			<article v-for="row in c.visible.value" :key="row.name" class="units-phone-row">
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
				<PopupMenu label="单位操作" variant="icon" align="end" class="units-phone-actions">
					<UiButton icon="settings" @click="c.openEdit(row)">编辑</UiButton>
					<UiButton icon="warning" :disabled="inUse(row)" @click="c.toggleEnabled(row)">
						<span class="menu-item-label">{{ row.enabled ? "停用" : "启用" }}</span
						><small v-if="inUse(row)" class="unit-delete-reason"
							>正在使用：{{ usage(row) }}</small
						>
					</UiButton>
					<UiButton
						icon="disposal"
						variant="danger"
						:disabled="!row.deletable"
						:title="row.deletable ? undefined : row.delete_reason"
						@click="c.remove(row)"
					>
						<span class="menu-item-label">删除</span
						><small v-if="!row.deletable" class="unit-delete-reason">{{
							row.delete_reason
						}}</small>
					</UiButton>
				</PopupMenu>
			</article>
			<p v-if="!c.visible.value.length && c.initialized.value" class="muted">
				没有匹配的单位。
			</p>
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
				<div class="unit-category-create">
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
				<UiButton :disabled="c.saving.value" @click="c.dialog.value = false"
					>取消</UiButton
				>
				<UiButton
					variant="primary"
					type="submit"
					form="unit-form"
					:loading="c.saving.value"
					>保存</UiButton
				>
			</template>
		</Overlay>
	</div>
</template>

<style scoped>
.units-page {
	padding-bottom: 32px;
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
.units-phone-row {
	position: relative;
	display: grid;
	gap: 8px;
	padding: 12px 56px 12px 14px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
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
