<script setup lang="ts">
import LoadingIndicator from "../../components/LoadingIndicator.vue";
import FloatingActionMenu from "../../components/FloatingActionMenu.vue";
import QuantitySummary from "../../components/QuantitySummary.vue";
import UiButton from "../../components/UiButton.vue";
import { type WarehousesController } from "./useWarehousesController";

const props = defineProps<{ controller: WarehousesController }>();
const {
	boot,
	loading,
	error,
	search,
	dialog,
	saving,
	repairing,
	quantityTotals,
	summaryLoading,
	summaryMetrics,
	form,
	expanded,
	list,
	dialogElement,
	labelInput,
	rowRefs,
	previousFocus,
	summaryTimer,
	rawRows,
	rows,
	filtered,
	roots,
	visibleRows,
	context,
	actions,
	physicalRoot,
	parentOptions,
	matchingParents,
	selectedParent,
	dialogTitle,
	nameLabel,
	remember,
	toggle,
	open,
	defaultParent,
	start,
	chooseParent,
	closeDialog,
	onDialogKeydown,
	load,
	loadSummary,
	repairMetadata,
	save,
} = props.controller;
</script>
<template>
	<section class="app-shell wide-shell warehouse-page" :aria-busy="loading">
		<header>
			<label class="warehouse-search compact-search-field"
				>搜索仓库<input
					v-model="search"
					type="search"
					placeholder="搜索仓库、房间或货位"
					aria-label="搜索仓库、房间或货位"
			/></label>
			<div class="warehouse-heading-actions">
				<UiButton
					v-for="action in actions"
					:key="action.kind"
					variant="secondary"
					size="compact"
					:disabled="action.disabled"
					@click="start(action.kind)"
					>{{ action.label }}</UiButton
				>
			</div>
		</header>
		<LoadingIndicator v-if="loading && !visibleRows.length" text="正在加载仓库…" /><template
			v-else
			><p v-if="error" class="error" role="alert">
				{{ error }} <button type="button" @click="load">重试</button>
			</p>
			<section
				v-if="boot?.is_manager && boot?.warehouse_metadata_issues?.length"
				class="warehouse-metadata-repair"
				aria-labelledby="warehouse-metadata-title"
			>
				<h2 id="warehouse-metadata-title">仓库显示信息待修复</h2>
				<div v-for="issue in boot.warehouse_metadata_issues" :key="issue.warehouse">
					<p>
						<strong>{{ issue.warehouse_name }}</strong
						>：{{ issue.message }}
					</p>
					<button
						type="button"
						:disabled="Boolean(repairing)"
						@click="repairMetadata(issue.warehouse)"
					>
						{{ repairing === issue.warehouse ? "正在修复…" : "修复显示信息" }}
					</button>
				</div>
			</section>
			<QuantitySummary :metrics="summaryMetrics" :loading="summaryLoading" />
			<p v-if="!loading && !error && !visibleRows.length" class="empty-state">
				暂无可查看的仓库。
			</p>
			<div
				v-if="loading && visibleRows.length"
				class="warehouse-refresh-overlay"
				role="status"
			>
				<span class="loading-spinner" aria-hidden="true"></span>正在更新仓库…
			</div>
			<div
				v-if="!loading || visibleRows.length"
				ref="list"
				class="warehouse-list"
				tabindex="-1"
				role="tree"
				aria-label="仓库层级"
			>
				<div
					v-for="row in visibleRows"
					:key="row.name"
					:ref="(el) => remember(el, row.name)"
					class="warehouse-row"
					role="treeitem"
					:aria-level="row.displayDepth + 1"
					:style="{ paddingInlineStart: `${12 + row.displayDepth * 24}px` }"
				>
					<button
						v-if="filtered.some((child) => child.parentName === row.name)"
						type="button"
						class="warehouse-disclosure"
						:aria-expanded="expanded.has(row.name)"
						:aria-label="`${expanded.has(row.name) ? '收起' : '展开'} ${row.localLabel}`"
						@click.stop="toggle(row)"
					>
						{{ expanded.has(row.name) ? "−" : "+" }}</button
					><span v-else class="warehouse-disclosure" aria-hidden="true"></span
					><button type="button" class="warehouse-row-main" @click="open(row)">
						<span>{{ row.localLabel }}</span
						><small v-if="row.breadcrumb !== row.localLabel">{{
							row.breadcrumb
						}}</small></button
					><span
						v-if="!row.canOperate && row.semanticType === 'room'"
						class="warehouse-status"
						>暂不可操作</span
					>
				</div>
			</div>
		</template>
		<FloatingActionMenu
			class="mobile-page-actions"
			v-if="actions.length"
			:disabled="actions.every((action) => action.disabled || action.loading)"
			label="添加仓库位置"
			:actions="actions"
			@select="start"
		/>
		<div v-if="dialog" class="drawer-backdrop" role="presentation">
			<section
				ref="dialogElement"
				class="drawer warehouse-dialog"
				role="dialog"
				aria-modal="true"
				:aria-label="dialogTitle"
			>
				<form @submit.prevent="save">
					<h2>{{ dialogTitle }}</h2>
					<p v-if="dialog === 'warehouse'">
						仓库用于组织下级房间和货位，不能直接存放库存。
					</p>
					<p v-else-if="dialog === 'room'">会自动创建“无货位”，可立即用于收发库存。</p>
					<p v-else>货位是实际存放库存的位置。</p>
					<fieldset class="parent-picker">
						<legend>上级仓库</legend>
						<p v-if="selectedParent" class="selected-parent">
							已选：{{ selectedParent.pickerLabel }}
						</p>
						<label
							>搜索上级<input
								v-model="form.parentSearch"
								type="search"
								placeholder="搜索仓库或路径"
								aria-label="搜索上级仓库"
						/></label>
						<div class="parent-options" role="listbox" aria-label="可选上级仓库">
							<p v-if="!matchingParents.length" class="field-hint">
								没有匹配的上级仓库。
							</p>
							<button
								v-for="row in matchingParents"
								:key="row.name"
								type="button"
								role="option"
								:aria-selected="form.parent === row.name"
								:class="{ selected: form.parent === row.name }"
								:style="{ paddingInlineStart: `${12 + row.pickerDepth * 18}px` }"
								@click="chooseParent(row.name)"
							>
								<span>{{ row.localLabel }}</span
								><small>{{ row.pickerLabel }}</small>
							</button>
						</div>
					</fieldset>
					<label
						>{{ nameLabel }}<input ref="labelInput" v-model="form.label" required
					/></label>
					<div class="detail-actions">
						<button class="primary" :disabled="saving || !form.parent">
							{{ saving ? "正在保存…" : "保存" }}</button
						><button type="button" @click="closeDialog">取消</button>
					</div>
				</form>
			</section>
		</div>
	</section>
</template>
<style scoped>
.warehouse-page header {
	align-items: center;
	gap: 18px;
}
.warehouse-heading-actions {
	display: flex;
	gap: 8px;
	margin-left: auto;
}
.mobile-page-actions {
	display: none;
}
.warehouse-search {
	display: flex;
	align-items: center;
	gap: 8px;
}
.warehouse-search input {
	margin: 0;
	min-width: 220px;
}
@media (max-width: 1023px) {
	.warehouse-heading-actions {
		display: none;
	}
	.mobile-page-actions {
		display: flex;
	}
}
.warehouse-metadata-repair {
	margin: 12px 0;
	padding: 12px;
	border-inline-start: 4px solid #a66b35;
	background: #fffaf2;
}
.warehouse-metadata-repair h2,
.warehouse-metadata-repair p {
	margin: 0 0 8px;
}
.warehouse-metadata-repair > div {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}
.warehouse-metadata-repair button {
	flex: none;
}
.warehouse-list {
	overflow: auto;
	max-height: 70dvh;
	background: #fff;
	border-radius: 14px;
	box-shadow: 0 2px 10px #1720330c;
}
.warehouse-row {
	display: flex;
	align-items: center;
	gap: 6px;
	min-height: 58px;
	border-bottom: 1px solid #eee8db;
}
.warehouse-row-main {
	display: flex;
	flex: 1;
	flex-direction: column;
	align-items: flex-start;
	gap: 2px;
	min-height: 44px;
	padding: 8px;
	border: 0;
	background: transparent;
	text-align: left;
}
.warehouse-row-main small {
	color: #6b6257;
	font-size: 12px;
}
.warehouse-disclosure {
	width: 32px;
	min-width: 32px;
	padding: 6px;
	border: 0;
	background: transparent;
}
.warehouse-status {
	color: #805022;
	font-size: 12px;
	margin-right: 12px;
}
.warehouse-page {
	position: relative;
}
.warehouse-refresh-overlay {
	position: absolute;
	inset: 76px 0 0;
	z-index: 2;
	display: flex;
	justify-content: center;
	gap: 8px;
	padding-top: 18px;
	background: rgb(247 245 239 / 62%);
	color: #704d2e;
	font-weight: 700;
	pointer-events: none;
}
.warehouse-dialog {
	max-width: 460px;
	margin: auto;
}
.warehouse-dialog form {
	display: grid;
	gap: 12px;
}
.warehouse-dialog p {
	margin: 0;
}
.parent-picker {
	display: grid;
	gap: 8px;
	margin: 0;
}
.parent-picker label {
	display: grid;
	gap: 4px;
}
.selected-parent {
	font-weight: 700;
}
.parent-options {
	max-height: 210px;
	overflow: auto;
	border: 1px solid #ded7ca;
	border-radius: 10px;
}
.parent-options button {
	display: flex;
	width: 100%;
	min-height: 46px;
	flex-direction: column;
	align-items: flex-start;
	justify-content: center;
	border: 0;
	border-bottom: 1px solid #eee8db;
	border-radius: 0;
	background: #fff;
	text-align: left;
}
.parent-options button.selected {
	background: #eee8db;
	color: #40250f;
	font-weight: 700;
}
.parent-options small {
	color: #6b6257;
	font-weight: 400;
}
@media (max-width: 620px) {
	.warehouse-page header {
		display: block;
	}
	.warehouse-search {
		margin-top: 12px;
	}
	.warehouse-search input {
		min-width: 0;
		width: 100%;
	}
	.warehouse-list {
		max-height: none;
	}
	.warehouse-dialog {
		margin: 0 12px;
	}
	.warehouse-row {
		min-height: 64px;
	}
}
</style>
