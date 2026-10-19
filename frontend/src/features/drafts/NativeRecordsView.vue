<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import { watch } from "vue";
import type { NativeRecordsController, NativeRecord } from "./useNativeRecords";
import type { RecoverySnapshot } from "../../lib/browserRecovery";
import type { ReportQuery } from "../../lib/reportContract";
import { movementLabels } from "../../lib/filterPresentation";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import CompactFilters from "../../components/filters/CompactFilters.vue";
import QuickExport from "../../components/QuickExport.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
const props = withDefaults(
	defineProps<{
		controller: NativeRecordsController;
		mode: "drafts" | "counts";
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	openDocument: [doctype: string, name: string];
	recover: [entry: RecoverySnapshot];
	newCount: [];
	openExport: [query: ReportQuery];
}>();
const c = props.controller;
const {
	query,
	scope,
	rows,
	loading,
	initialized,
	stale,
	total,
	next,
	error,
	routeError,
	deleteTarget,
	deleteBusy,
	deleteError,
	localEntries,
	localError,
	localTarget,
	extraChips,
} = c;
watch(
	() => props.active,
	(value) => {
		if (!value) {
			deleteTarget.value = undefined;
			localTarget.value = undefined;
		}
	},
);
function open(row: NativeRecord) {
	emit("openDocument", String(row.doctype), String(row.document));
}
function localTitle(entry: RecoverySnapshot) {
	if (entry.editorKind === "Stock Entry")
		return movementLabels[String(entry.values.kind || "")] || "库存操作";
	return (
		(
			{
				"Stock Reconciliation": "盘点",
				Item: "物品",
				"Inventory Activity": "活动",
				Warehouse: "仓库资料",
			} as Record<string, string>
		)[entry.editorKind] || entry.editorKind
	);
}
const quantities = (row: NativeRecord) =>
	row.whole.quantities.map((value) => `${value.qty} ${value.uom}`).join(" · ");
</script>
<template>
	<section class="preview-page preview-browse-page">
		<PageHeader
			><div>
				<h1 tabindex="-1">{{ mode === "drafts" ? "草稿" : "盘点调整" }}</h1>
				<p class="browse-subtitle">
					{{
						mode === "drafts"
							? "原生草稿可在 ERPNext 和本应用继续填写，尚未改变库存。"
							: "仅显示实际保存的原生盘点调整；数量一致的盘点不产生记录。"
					}}
				</p>
			</div>
			<template #actions
				><UiButton
					@click="
						c.load();
						c.readLocal();
					"
					>刷新</UiButton
				>
				<QuickExport
					:query="query"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
				<UiButton
					v-if="
						mode === 'counts' &&
						c.reference.capabilities['Stock Reconciliation']?.create
					"
					variant="primary"
					@click="emit('newCount')"
					>开始盘点</UiButton
				></template
			></PageHeader
		>
		<p v-if="routeError" class="utility-error" role="alert">{{ routeError }}</p>
		<template v-else>
			<PeriodFilter
				v-model="scope.period"
				:today="c.reference.siteDate"
				label="记账日期"
				:active="active"
				:context="mode"
			/>
			<CompactFilters
				v-model="scope"
				:movement="mode === 'drafts'"
				records
				:active="active"
				:context="mode"
				:result-count="initialized ? total : undefined"
				:extra-count="extraChips.length"
				@clear="c.clear"
			>
				<label v-if="mode === 'counts'" class="preview-field"
					>状态<select v-model="query.statuses">
						<option :value="[1]">已提交</option>
						<option :value="[0]">草稿</option>
						<option :value="[2]">已取消</option>
						<option :value="[0, 1, 2]">全部状态</option>
					</select></label
				>
			</CompactFilters>
			<div v-if="extraChips.length" class="compact-filter-chips">
				<UiButton
					v-for="chip in extraChips"
					:key="chip.key"
					:disabled="chip.fixed"
					@click="Object.assign(query, chip.reset)"
					>{{ chip.label }}{{ chip.fixed ? "" : " ×" }}</UiButton
				>
			</div>
			<div class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="query.search"
						type="search"
						:placeholder="
							mode === 'drafts' ? '搜索草稿、物品或活动' : '搜索盘点记录或物品'
						"
						aria-label="搜索记录"
				/></label>
				<label class="preview-field"
					>排序<select v-model="query.sortBy">
						<option value="date">记账日期</option>
						<option value="modified">更新时间</option>
						<option value="identity">编号</option>
					</select></label
				>
				<label class="preview-field"
					>顺序<select v-model="query.sort">
						<option value="desc">降序</option>
						<option value="asc">升序</option>
					</select></label
				>
				<span v-if="initialized" class="browse-result-count">{{ total }} 份原生记录</span>
			</div>
			<p v-if="loading" role="status">
				{{ stale ? "正在更新，当前结果待核对…" : "正在读取原生记录…" }}
			</p>
			<p v-if="error" class="utility-error" role="alert">
				{{ error }} <UiButton @click="c.load(!!rows.length && !stale)">重试</UiButton>
			</p>
			<div
				v-if="rows.length"
				class="browse-table-wrap preview-drafts-table"
				data-browse-scroll="records"
				:aria-busy="loading"
			>
				<table class="browse-table">
					<thead>
						<tr>
							<th>记录</th>
							<th>类型 / 状态</th>
							<th>活动 / 借用人</th>
							<th>整份记录</th>
							<th>记账日期</th>
							<th>操作</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="row in rows"
							:key="row.id"
							:data-browse-row="String(row.doctype) + ':' + String(row.document)"
						>
							<td>
								<button class="browse-row-link" @click="open(row)">
									<strong>{{ row.document }}</strong
									><small>{{ row.doctype }}</small>
								</button>
							</td>
							<td>
								{{ movementLabels[String(row.kind)] || row.kind }} ·
								{{
									Number(row.docstatus) === 0
										? "草稿"
										: Number(row.docstatus) === 2
											? "已取消"
											: "已提交"
								}}
							</td>
							<td>{{ row.activity_title || row.borrower || "—" }}</td>
							<td>
								{{ row.whole.line_count }} 行 ·
								{{ row.whole.item_count }} 种物品<small class="record-quantity">{{
									quantities(row)
								}}</small
								><small
									v-if="row.allocation_count !== row.whole.line_count"
									class="record-quantity"
									>符合筛选的明细：{{ row.allocation_count }}</small
								>
							</td>
							<td>{{ row.date }} {{ String(row.time || "").slice(0, 5) }}</td>
							<td>
								<div class="browse-row-actions">
									<button class="browse-link" @click="open(row)">
										{{ row.whole.editable ? "继续填写" : "查看记录" }}</button
									><button
										v-if="row.whole.can_delete"
										class="browse-link is-danger-text"
										:disabled="!c.canDelete(row)"
										@click="
											deleteError = '';
											deleteTarget = row;
										"
									>
										删除
									</button>
								</div>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<div v-else-if="initialized && !loading && !error" class="browse-empty">
				<h2>没有符合条件的原生记录</h2>
				<p>调整筛选或开始新的操作。</p>
			</div>
			<UiButton v-if="next !== null" :disabled="loading || stale" @click="c.load(true)"
				>加载更多</UiButton
			>
		</template>
		<section v-if="mode === 'drafts'" class="surface form-section browser-recovery-list">
			<h2>此浏览器的未完成输入</h2>
			<p>
				仅当前浏览器与账户可用，未保存为原生草稿，也没有预留或改变库存。重新打开后需核对原记录，再选择恢复。待上传文件须重新选择。
			</p>
			<p v-if="localError" class="utility-error" role="alert">{{ localError }}</p>
			<p v-else-if="!localEntries.length">没有保留的未完成输入。</p>
			<article
				v-for="entry in localEntries"
				:key="entry.editorId"
				class="browser-recovery-entry"
			>
				<div>
					<strong>{{ localTitle(entry) }}</strong
					><small
						>{{
							entry.identity?.name ||
							entry.values.editingCode ||
							entry.values.editingActivity ||
							entry.values.editingWarehouse ||
							"尚无原生记录"
						}}
						· {{ entry.updatedAt }}</small
					>
				</div>
				<div class="browse-row-actions">
					<UiButton v-if="c.localSupported(entry)" @click="emit('recover', entry)"
						>打开并核对</UiButton
					><UiButton variant="danger" @click="localTarget = entry">放弃此输入</UiButton>
				</div>
				<details>
					<summary>查看恢复摘要</summary>
					<RecoverySummary
						:kind="entry.editorKind"
						:values="entry.values"
						:copy-text="JSON.stringify(entry.values, null, 2)"
						:pending-upload-reselection="entry.pendingUploadReselection"
					/>
				</details>
			</article>
		</section>
		<Overlay
			v-if="deleteTarget && active"
			title="删除这份原生草稿？"
			:dismissible="!deleteBusy"
			@close="!deleteBusy && (deleteTarget = undefined)"
			><p>
				将删除
				{{ deleteTarget.document }}。已保留的浏览器输入会单独保留；此操作不会改变库存。
			</p>
			<p v-if="deleteError" role="alert" class="utility-error">{{ deleteError }}</p>
			<template #footer
				><UiButton :disabled="deleteBusy" @click="deleteTarget = undefined"
					>保留草稿</UiButton
				><UiButton variant="danger" :disabled="deleteBusy" @click="c.removeNative">{{
					deleteBusy ? "正在删除…" : "删除草稿"
				}}</UiButton></template
			></Overlay
		>
		<Overlay
			v-if="localTarget && active"
			title="放弃这份浏览器输入？"
			@close="localTarget = undefined"
			><p>仅移除此版本的未完成输入。请先复制需要保留的内容。</p>
			<template #footer
				><UiButton @click="localTarget = undefined">保留输入</UiButton
				><UiButton variant="danger" @click="c.removeLocal">放弃此输入</UiButton></template
			></Overlay
		>
	</section>
</template>
<style scoped>
.record-quantity,
.browser-recovery-entry small {
	display: block;
	color: var(--p-muted);
}
.browser-recovery-list {
	margin-top: var(--p-section-gap, 24px);
}
.browser-recovery-entry {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	padding-block: 16px;
	border-top: 1px solid var(--p-border);
}
.browser-recovery-entry > div:first-child {
	flex: 1 1 240px;
	min-width: 0;
	overflow-wrap: anywhere;
}
.browser-recovery-entry details {
	flex-basis: 100%;
	min-width: 0;
}
</style>
