<script setup lang="ts">
import { computed } from "vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import BrowseSplitButton from "../../components/ui/BrowseSplitButton.vue";
import DataTable from "../../components/ui/DataTable.vue";
import FormField from "../../components/ui/FormField.vue";
import IconButton from "../../components/ui/IconButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import PopupMenu from "../../components/ui/PopupMenu.vue";
import UiButton from "../../components/ui/UiButton.vue";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import type { useActivityTypesController } from "./useActivityTypesController";
import type { ActivityTypeRow } from "../../services/activityTypes";
import { useCapabilities } from "../../composables/useCapabilities";
import { presentationText } from "../../lib/presentationLabels";

const props = defineProps<{ controller: ReturnType<typeof useActivityTypesController> }>();
const c = props.controller;
const { isMobile } = useResponsiveLayout();
const { can } = useCapabilities();
const mayCreate = computed(() => can("activity_type.create"));
const mayWrite = computed(() => can("activity_type.write"));
const mayDelete = computed(() => can("activity_type.delete"));
const filtered = computed(() => Boolean(c.search.value.trim()) || c.statusFilter.value !== "all");
const columns: DataColumn[] = [
	{ id: "label", label: "名称", kind: "primary", required: true, pinned: "start" },
	{ id: "activity_count", label: "活动数", kind: "number", align: "end" },
	{ id: "enabled", label: "状态", kind: "status" },
	{ id: "actions", label: "操作", kind: "actions" },
];
const recordRows = computed<DataTableRecord[]>(() =>
	c.visible.value.map((row) => ({ kind: "record", id: row.name, value: row })),
);
function indexOf(row: Record<string, unknown>) {
	return c.rows.value.findIndex((item) => item.name === row.name);
}
function activityType(row: Record<string, unknown>) {
	return row as unknown as ActivityTypeRow;
}
function orderDisabled(row: Record<string, unknown>, delta: -1 | 1) {
	const index = indexOf(row);
	return filtered.value || index + delta < 0 || index + delta >= c.rows.value.length;
}
</script>

<template>
	<div class="app-shell activity-types-page">
		<BrowseToolbar
			title="活动类型"
			summary="管理活动类型、排序与停用"
			v-model:search="c.search.value"
			search-label="搜索活动类型名称"
			:filter-count="Number(c.statusFilter.value !== 'all')"
		>
			<template #actions>
				<UiButton v-if="!isMobile && mayCreate" variant="primary" @click="c.openCreate"
					>新建类型</UiButton
				>
				<BrowseSplitButton
					v-else-if="mayCreate"
					label="新建类型"
					kind="Activity"
					icon="calendar"
					:options="[]"
					@select="c.openCreate"
				/>
			</template>
			<template #chips="{ editFilter }">
				<BrowseChip
					v-if="c.statusFilter.value !== 'all'"
					:label="`状态：${c.statusFilter.value === 'enabled' ? '启用' : '停用'}`"
					@edit="editFilter('status')"
					@remove="c.statusFilter.value = 'all'"
				/>
			</template>
			<template #filters>
				<div class="browse-filter-fields activity-types-filter-fields">
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
		<p v-if="c.refreshError.value" class="notice-bar danger" role="alert">
			{{ c.refreshError.value }}
			<UiButton :loading="c.loading.value" @click="c.refresh">重新读取</UiButton>
		</p>
		<DataTable
			v-if="!isMobile"
			ariaLabel="活动类型"
			:columns="columns"
			:rows="recordRows"
			:loading="c.loading.value"
			:initialized="c.initialized.value"
			empty-text="没有匹配的活动类型"
			@retry="c.refresh"
		>
			<template #cell="{ column, row }">
				<template v-if="column.id === 'enabled'">{{
					row.enabled ? "启用" : "停用"
				}}</template>
				<template v-else-if="column.id === 'actions'">
					<div v-if="mayWrite || mayDelete" class="activity-type-actions">
						<IconButton
							v-if="mayWrite"
							label="上移"
							:disabled="orderDisabled(row, -1)"
							@click="c.move(activityType(row), -1)"
							>↑</IconButton
						>
						<IconButton
							v-if="mayWrite"
							label="下移"
							:disabled="orderDisabled(row, 1)"
							@click="c.move(activityType(row), 1)"
							>↓</IconButton
						>
						<PopupMenu
							v-if="mayWrite || mayDelete"
							label="活动类型操作"
							variant="icon"
							align="end"
						>
							<UiButton
								v-if="mayWrite"
								icon="settings"
								@click="c.openEdit(activityType(row))"
								>编辑</UiButton
							>
							<UiButton
								v-if="mayDelete"
								icon="disposal"
								variant="danger"
								:disabled="!row.deletable"
								:title="row.deletable ? undefined : String(row.delete_reason)"
								@click="c.remove(activityType(row))"
								><span class="menu-item-label">删除</span
								><small
									v-if="!row.deletable"
									class="activity-type-delete-reason"
									>{{ row.delete_reason }}</small
								></UiButton
							>
						</PopupMenu>
					</div>
				</template>
				<template v-else>{{ row[String(column.id)] }}</template>
			</template>
		</DataTable>
		<div v-else class="activity-types-phone-rows" aria-label="活动类型">
			<article
				v-for="(row, index) in c.visible.value"
				:key="row.name"
				class="activity-types-phone-row"
			>
				<div class="activity-types-phone-identity">
					<strong>{{ row.label }}</strong>
				</div>
				<div class="activity-types-phone-details">
					<span>活动数 {{ row.activity_count }}</span
					><span>{{ row.enabled ? "启用" : "停用" }}</span>
				</div>
				<div v-if="mayWrite || mayDelete" class="activity-types-phone-actions">
					<IconButton
						v-if="mayWrite"
						label="上移"
						:disabled="filtered || index === 0"
						@click="c.move(row, -1)"
						>↑</IconButton
					>
					<IconButton
						v-if="mayWrite"
						label="下移"
						:disabled="filtered || index === c.visible.value.length - 1"
						@click="c.move(row, 1)"
						>↓</IconButton
					>
					<PopupMenu
						v-if="mayWrite || mayDelete"
						label="活动类型操作"
						variant="icon"
						align="end"
					>
						<UiButton v-if="mayWrite" icon="settings" @click="c.openEdit(row)"
							>编辑</UiButton
						>
						<UiButton
							v-if="mayDelete"
							icon="disposal"
							variant="danger"
							:disabled="!row.deletable"
							:title="row.deletable ? undefined : row.delete_reason"
							@click="c.remove(row)"
						>
							<span class="menu-item-label">删除</span
							><small v-if="!row.deletable" class="activity-type-delete-reason">{{
								row.delete_reason
							}}</small>
						</UiButton>
					</PopupMenu>
				</div>
			</article>
			<p v-if="!c.visible.value.length && c.initialized.value" class="muted">
				没有匹配的活动类型。
			</p>
			<p v-if="c.loading.value && !c.initialized.value" class="muted" role="status">
				{{ presentationText.loading }}
			</p>
		</div>
		<Overlay
			v-if="c.dialog.value"
			:title="c.editing.value ? '编辑活动类型' : '新建类型'"
			initial-focus="[data-activity-type-label]"
			:dismissible="!c.saving.value"
			@close="c.dialog.value = false"
		>
			<form
				id="activity-type-form"
				class="activity-type-form"
				novalidate
				@submit.prevent="c.save"
			>
				<FormField label="名称" required>
					<template #default="{ fieldAttrs }"
						><input
							v-bind="fieldAttrs"
							v-model="c.label.value"
							data-activity-type-label
							autocomplete="off"
					/></template>
				</FormField>
				<label class="activity-type-checkbox"
					><input v-model="c.enabled.value" type="checkbox" />启用</label
				>
				<p class="activity-type-help">停用后，此类型的活动不能再被新记录选择。</p>
				<p v-if="c.error.value" role="alert">{{ c.error.value }}</p>
			</form>
			<template #footer>
				<UiButton :disabled="c.saving.value" @click="c.dialog.value = false"
					>取消</UiButton
				>
				<UiButton
					variant="primary"
					type="submit"
					form="activity-type-form"
					:loading="c.saving.value"
					>保存</UiButton
				>
			</template>
		</Overlay>
	</div>
</template>

<style scoped>
.activity-types-page {
	padding-bottom: var(--p-space-8);
}
.activity-type-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 2px;
}
.activity-type-delete-reason {
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
.activity-types-phone-rows {
	display: grid;
	gap: var(--p-space-2);
	margin-top: var(--p-space-3);
}
.activity-types-phone-row {
	position: relative;
	display: grid;
	gap: var(--p-space-2);
	padding: var(--p-space-3) var(--p-space-3);
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
}
.activity-types-phone-identity {
	display: grid;
	gap: 3px;
	min-width: 0;
	padding-inline-end: 112px;
}
.activity-types-phone-identity strong {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.activity-types-phone-details {
	display: flex;
	flex-wrap: wrap;
	gap: 5px var(--p-space-3);
	color: var(--p-muted);
	font-size: var(--p-small);
}
.activity-types-phone-actions {
	position: absolute;
	inset-block-start: 8px;
	inset-inline-end: 8px;
	display: flex;
	align-items: center;
}
.activity-type-form {
	display: grid;
	gap: var(--p-space-4);
}
.activity-type-checkbox {
	display: flex;
	align-items: center;
	gap: var(--p-space-2);
	min-height: 36px;
}
.activity-type-help {
	color: var(--p-muted);
}
</style>
