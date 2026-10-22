<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import { warehouseLabel } from "../../lib/warehouseLabel";
import QuickExport from "../../components/QuickExport.vue";
import type { ReportQuery } from "../../lib/reportContract";
import { computed, nextTick, ref } from "vue";
import type { CountEditor } from "./useCountEditor";
import CountWorkspace from "./CountWorkspace.vue";
import CountSummary from "./CountSummary.vue";
import NativeCountAllocations from "./NativeCountAllocations.vue";
import TransactionContext from "../documents/TransactionContext.vue";
import UiButton from "../../components/ui/UiButton.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import Overlay from "../../components/ui/Overlay.vue";
import Attachments from "../../components/Attachments.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import ItemImage from "../../components/ItemImage.vue";
import { useFocusVisibility } from "../../composables/useFocusVisibility";
import DataTable from "../../components/ui/DataTable.vue";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { showToast } from "../../services/toast";
import { useOptionalInventoryServices } from "../../services/contracts";
import { enumPresentationLabel } from "../../lib/presentationLabels";
import DocumentLoadingState from "../../components/ui/DocumentLoadingState.vue";
const props = withDefaults(defineProps<{ controller: CountEditor; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	back: [];
	newCount: [];
	openExport: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
}>();
const c = props.controller;
const {
	values,
	rows,
	state,
	activityLabel,
	loading,
	busy,
	writable,
	valid,
	files,
	deskOrigin,
	opening,
	finished,
	showError,
	reviewOpen,
	action,
	candidates,
	supportingDirty,
	reloadOpen,
	leaveRequested,
} = c;
const initialExistingLoad = computed(
	() => loading.value && c.existingDocument.value && !state.server,
);
async function saveDraft() {
	await c.save(true);
	if (state.status === "saved" && !files.incomplete.value) showToast("盘点草稿已保存到库存单据");
	else if (state.status === "saved" && files.incomplete.value)
		showToast("盘点草稿已保存，但附件尚未完成上传", "warning");
	else if (state.status === "matching") showToast("盘点数量与账面相同，无需保存调整");
	else if (state.status === "local")
		showToast("输入已保留在此浏览器，尚未保存到服务器", "warning");
	else if (state.error) showToast(`盘点草稿保存失败：${state.error}`, "danger");
}
async function review() {
	await c.review();
	if (!showError.value || valid.value) return;
	await nextTick();
	root.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
async function confirm() {
	await c.confirm();
	if (state.status === "submitted") showToast("盘点调整已提交");
	else if (state.error) showToast(`盘点确认失败：${state.error}`, "danger");
}
async function lifecycle() {
	const selected = action.value;
	await c.lifecycle();
	if (action.value || state.error) {
		if (state.error) showToast(`盘点操作失败：${state.error}`, "danger");
		return;
	}
	const outcomes: Record<string, string> = {
		cancel: "盘点调整已取消",
		amend: "盘点修订草稿已创建",
		delete: "盘点原生草稿已删除",
	};
	if (selected && outcomes[selected]) showToast(outcomes[selected]);
}
const root = ref<HTMLElement>(),
	actionBar = ref<HTMLElement>();
useFocusVisibility(
	root,
	actionBar,
	() => true,
	() => props.active !== false,
);
const context = computed(() => ({
	kind: "Reconcile",
	get activity() {
		return values.value.ti_activity;
	},
	set activity(value: string) {
		values.value.ti_activity = value;
	},
	source: "",
	purpose: "",
	loanName: "",
}));
const reviewedRows = computed(() => rows.value.filter((row) => row.review_state === "Reviewed"));
const status = computed(
	() =>
		({
			matching: "已核对，无需调整",
			local: "此浏览器未完成输入",
			saving: "正在保存原生草稿…",
			saved: "原生草稿已保存",
			error: "保存失败，输入已保留",
			conflict: "原生记录已更改，输入已保留",
			deleted: "原生记录已删除",
			forbidden: "无权访问原记录",
			submitted: "已提交",
			cancelled: "已取消",
		})[state.status],
);
function deskItem(row: Record<string, unknown>) {
	const code = String(row.item_code || "");
	return {
		code,
		name: String(row.ti_display_item_name || row.item_name || c.names[code] || code),
		image: String(row.ti_display_image || row.image || c.images[code] || ""),
		category: "",
		uom: String(row.stock_uom || ""),
		tracksBatch: Boolean(row.batch_no || row.serial_and_batch_bundle),
		tracksExpiry: false,
		locations: [],
		available: 0,
		loaned: 0,
		damaged: 0,
	};
}
const countColumns = computed<DataColumn[]>(() => [
	{ id: "warehouse", label: "位置", required: true, defaultVisible: true, minWidth: "150px" },
	{ id: "image", label: "图片", defaultVisible: true, minWidth: "72px" },
	{
		id: "item_name",
		label: "物品名称",
		required: true,
		defaultVisible: true,
		minWidth: "180px",
	},
	{
		id: "item_code",
		label: "物品编码",
		required: true,
		defaultVisible: true,
		minWidth: "140px",
	},
	{ id: "batch", label: "批次 / 组合", defaultVisible: true, minWidth: "150px" },
	{ id: "stock_uom", label: "库存单位", defaultVisible: true },
	{ id: "current_qty", label: "账面数量", defaultVisible: true, align: "end" },
	{ id: "qty", label: "实点数量", required: true, defaultVisible: true, align: "end" },
	{ id: "allocations", label: "批次分配", defaultVisible: true },
]);
const countTableRows = computed<DataTableRecord[]>(() =>
	values.value.items.map((row, index) => ({
		kind: "record",
		id: String(row.name || index),
		value: row as unknown as Record<string, unknown>,
	})),
);
const services = useOptionalInventoryServices();
const countPrefs = services
	? useColumnPreferences(
			`count-editor.${String(values.value.name || values.value.doctype || "draft")}`,
			countColumns,
			c.reference,
			services,
		)
	: undefined;
function countRow(row: Record<string, unknown>) {
	return row as unknown as (typeof values.value.items)[number];
}
async function back() {
	if (await c.requestLeave()) emit("back");
}
</script>
<template>
	<section ref="root" class="preview-form-page">
		<PageHeader class="form-page-heading"
			><div>
				<h1 tabindex="-1">
					{{ opening ? "期初库存" : state.identity ? "盘点记录" : "新建盘点" }}
				</h1>
				<p class="muted">按库存单位核对；留空表示尚未核对，零表示实点为零。</p>
			</div>
			<template #back><UiButton @click="back">返回</UiButton></template
			><template #actions
				><QuickExport
					v-if="!loading && c.savedExportQuery.value"
					:query="c.savedExportQuery.value"
					:active="active"
					@open-full="emit('openExport', $event)" /></template
		></PageHeader>
		<div class="form-status">
			<span v-if="!initialExistingLoad" class="form-record-tag">{{
				state.identity
					? `${enumPresentationLabel("doctype", state.identity.doctype)} · ${state.identity.name}`
					: c.existingDocument.value
						? "正在读取原生记录"
						: "尚未创建原生记录"
			}}</span
			><span role="status">{{ initialExistingLoad ? "正在读取原生记录…" : status }}</span
			><span v-if="loading && state.server" class="async-refresh-status" role="status"
				>正在刷新…</span
			><NativeStatusBadge v-if="state.server" :status="state.server.docstatus" /><UiButton
				v-if="state.identity"
				:disabled="busy"
				@click="c.dirty.value ? (reloadOpen = true) : c.load(true)"
				>重新读取</UiButton
			>
		</div>
		<DocumentLoadingState
			v-if="initialExistingLoad"
			label="正在读取盘点记录…"
			:announce="false"
		/>
		<p v-if="state.error" class="notice-bar danger" role="alert">
			{{ state.error }}
			<UiButton v-if="c.existingDocument.value && !state.server" @click="c.load(true)"
				>重新读取</UiButton
			>
		</p>
		<p v-if="state.recoveryError" role="alert">{{ state.recoveryError }}</p>
		<section v-if="candidates.length" class="surface form-section">
			<h2>此浏览器的未完成盘点</h2>
			<p>仅在当前浏览器和账户可用，未改变库存。</p>
			<div v-for="candidate in candidates" :key="candidate.editorId">
				<p>{{ candidate.updatedAt }} · {{ candidate.identity?.name || "本地输入" }}</p>
				<RecoverySummary
					kind="Stock Reconciliation"
					:values="candidate.values"
					:copy-text="JSON.stringify(candidate.values, null, 2)"
					:pending-upload-reselection="candidate.pendingUploadReselection"
				>
					<UiButton @click="c.recover(candidate)">检查并恢复</UiButton>
				</RecoverySummary>
			</div>
		</section>
		<section
			v-if="['conflict', 'deleted', 'forbidden'].includes(state.status)"
			class="notice-bar warning"
		>
			<p>原生记录不可继续保存，当前输入已保留。</p>
			<RecoverySummary
				kind="Stock Reconciliation"
				:values="values"
				:copy-text="c.recoveryText.value"
				:pending-upload-reselection="state.pendingUploadReselection"
			/>
		</section>
		<section v-if="state.status === 'matching'" class="notice-bar success">
			<h2>已核对的数量一致，无需库存调整</h2>
			<p>未创建新的原生记录；未核对的行仍是未完成输入。</p>
			<p v-if="state.identity">
				原有草稿 {{ state.identity.name }} 保持原样。请明确删除该草稿，或继续编辑。
			</p>
			<UiButton
				v-if="
					state.identity &&
					(state.server?.permissions as Record<string, boolean>)?.delete
				"
				@click="action = 'delete'"
				>删除原有原生草稿</UiButton
			>
			<p v-if="files.files.length">无需调整的盘点没有附件父记录，请移除附件后结束。</p>
			<UiButton
				v-if="!state.identity"
				:disabled="!!files.files.length || !valid"
				@click="c.finishMatching"
				>结束本次核对</UiButton
			>
		</section>
		<p v-if="finished" role="status">
			本次核对已结束。<UiButton @click="emit('newCount')">新建盘点</UiButton>
		</p>
		<div v-if="state.identity" class="form-actions">
			<a
				:href="`/app/stock-reconciliation/${encodeURIComponent(state.identity.name)}`"
				target="_blank"
				rel="noopener"
				>在 ERPNext 查看</a
			><UiButton
				v-if="
					state.server?.docstatus === 1 &&
					(state.server.permissions as Record<string, boolean>)?.cancel
				"
				@click="action = 'cancel'"
				>取消原生记录</UiButton
			><UiButton
				v-if="
					state.server?.docstatus === 2 &&
					!opening &&
					(state.server.permissions as Record<string, boolean>)?.amend
				"
				@click="action = 'amend'"
				>创建修订草稿</UiButton
			>
		</div>
		<div
			v-if="!c.existingDocument.value || state.server"
			class="count-form-shell async-result-region"
			:class="{ 'is-refreshing': loading && state.server }"
			:aria-busy="loading && state.server ? 'true' : undefined"
		>
			<form class="form-main surface count-form-main" novalidate @submit.prevent="review">
				<details class="form-section">
					<summary>日期与时间</summary>
					<div class="form-date-section">
						<label v-if="writable" class="preview-field"
							>操作日期<input
								type="date"
								v-model="values.posting_date"
								:disabled="busy" /></label
						><label v-if="writable" class="preview-field"
							>操作时间<input
								type="time"
								step="1"
								v-model="values.posting_time"
								:disabled="busy"
						/></label>
						<p v-else>{{ values.posting_date }} {{ values.posting_time }}</p>
						<p class="muted">账面基准使用这个明确时间点的原生库存记录。</p>
					</div>
				</details>
				<CountWorkspace
					v-if="!deskOrigin"
					:controller="c"
					@open-document="(doctype, name) => emit('openDocument', doctype, name)"
				/>
				<section v-else class="form-section">
					<h2>{{ opening ? "原生期初明细" : "ERPNext 原生盘点明细" }}</h2>
					<p>
						{{
							opening
								? "期初库存为只读原生记录。"
								: "保留 ERPNext 原生库位、批次分配和库存单位。"
						}}
					</p>
					<DataTable
						ariaLabel="原生盘点明细"
						table-class="count-table count-native-table"
						:columns="countColumns"
						:rows="countTableRows"
						:column-preferences="countPrefs"
						empty-text="此原生记录没有明细。"
					>
						<template #cell="{ column, row }">
							<template v-if="column.id === 'warehouse'">{{
								warehouseLabel(String(row.warehouse || ""), c.reference.warehouses)
							}}</template>
							<div v-else-if="column.id === 'image'" class="count-item-thumbnail">
								<ItemImage :item="deskItem(row)" />
							</div>
							<strong v-else-if="column.id === 'item_name'">{{
								row.ti_display_item_name ||
								row.item_name ||
								c.names[String(row.item_code)] ||
								row.item_code
							}}</strong>
							<template v-else-if="column.id === 'item_code'">{{
								row.item_code
							}}</template>
							<template v-else-if="column.id === 'batch'">{{
								row.batch_no || row.serial_and_batch_bundle || "—"
							}}</template>
							<template v-else-if="column.id === 'stock_uom'">{{
								row.stock_uom
							}}</template>
							<template v-else-if="column.id === 'current_qty'">{{
								row.current_qty ?? "未记录"
							}}</template>
							<input
								v-else-if="column.id === 'qty' && writable"
								class="count-actual-input"
								type="number"
								min="0"
								step="any"
								v-model.number="countRow(row).qty"
								:disabled="busy"
								:aria-label="`${row.ti_display_item_name || row.item_name || c.names[String(row.item_code)] || row.item_code}实点数量`"
							/>
							<template v-else-if="column.id === 'qty'">{{ row.qty }}</template>
							<details
								v-else-if="
									column.id === 'allocations' &&
									(row.serial_and_batch_bundle ||
										(Array.isArray(row.recorded_count_allocations) &&
											row.recorded_count_allocations.length))
								"
							>
								<summary>查看分配</summary>
								<NativeCountAllocations :row="countRow(row)" />
							</details>
							<span v-else-if="column.id === 'allocations'">—</span>
						</template>
					</DataTable>
				</section>
				<div
					v-if="writable || state.confirmationVersion"
					ref="actionBar"
					class="count-desk-actions"
				>
					<UiButton
						v-if="!state.confirmationVersion"
						:disabled="busy || supportingDirty"
						@click="saveDraft"
						>保存草稿</UiButton
					>
					<UiButton
						v-if="!state.confirmationVersion && c.canSubmit.value"
						variant="primary"
						:disabled="busy || supportingDirty"
						@click="review"
						>核对并确认</UiButton
					>
					<UiButton
						v-if="state.confirmationVersion"
						variant="primary"
						:loading="busy"
						@click="confirm"
						>检查上次确认结果</UiButton
					>
					<UiButton
						v-if="
							state.identity &&
							(state.server?.permissions as Record<string, boolean>)?.delete
						"
						:disabled="busy || !writable"
						variant="danger"
						@click="action = 'delete'"
						>删除原生草稿</UiButton
					>
				</div>
				<details class="form-section count-document-notes">
					<summary>盘点备注（可选）</summary>
					<label v-if="writable" class="preview-field"
						>盘点备注<textarea v-model="values.ti_notes" rows="3" :disabled="busy" />
					</label>
					<p v-else class="preview-long-text">{{ values.ti_notes || "未填写" }}</p>
				</details>
				<details class="form-section">
					<summary>活动、人员与附件</summary>
					<TransactionContext
						:draft="context"
						:activity-label="activityLabel"
						:mode="writable ? 'edit' : 'display'"
						:disabled="busy"
						@dirty-change="supportingDirty = $event"
					/><Attachments
						:controller="files"
						:mode="writable ? 'edit' : 'display'"
						:disabled="!writable || busy"
					/>
					<div v-if="writable" class="form-fields">
						<label class="preview-field"
							>记录人<input
								v-model="values.ti_recorder_name"
								:disabled="busy" /></label
						><label class="preview-field"
							>经手人<input
								v-model="values.ti_handler_name"
								:disabled="busy" /></label
						><label class="preview-field"
							>鉴证人<input v-model="values.ti_reviewer_name" :disabled="busy"
						/></label>
					</div>
					<div v-else>
						<p>
							记录人：{{ values.ti_recorder_name || "未填写" }} · 经手人：{{
								values.ti_handler_name || "未填写"
							}}
							· 鉴证人：{{ values.ti_reviewer_name || "未填写" }}
						</p>
					</div>
				</details>
				<p v-if="showError && !valid" role="alert" class="notice-bar warning">
					请先读取当前账面基准，并至少核对一行。输入已保留。
				</p>
			</form>
		</div>
		<Overlay v-if="reviewOpen" title="核对并确认盘点" @close="!busy && (reviewOpen = false)"
			><CountSummary v-if="!deskOrigin" :rows="rows" />
			<p v-if="!deskOrigin" class="count-confirmation-note">
				未核对的行仍保留在本次范围中，但不会进入库存调整。
			</p>
			<p v-if="!deskOrigin && values.ti_notes" class="preview-long-text">
				盘点备注：{{ values.ti_notes }}
			</p>
			<p>{{ values.posting_date }} {{ values.posting_time }}</p>
			<div v-if="!deskOrigin" class="count-confirmation-rows">
				<p v-for="row in reviewedRows" :key="c.countKey(row)">
					{{ c.names[row.item_code] || row.item_code }} ·
					{{ warehouseLabel(row.warehouse, c.reference.warehouses) }} ·
					{{ row.batch_no || "无批次" }} · 账面 {{ row.baseline_qty }} · 实点
					{{ row.actual_qty ?? "待核对" }} {{ row.stock_uom }} · 差异
					{{ row.actual_qty === null ? "待核对" : row.actual_qty - row.baseline_qty }}
					<span v-if="row.reason"> · 原因 {{ row.reason }}</span>
				</p>
				<p v-if="!reviewedRows.length" class="muted">尚无已核对行。</p>
			</div>
			<div v-else v-for="(row, index) in values.items" :key="String(row.name || index)">
				<p>
					{{ row.item_code }} ·
					{{ warehouseLabel(row.warehouse, c.reference.warehouses) }} ·
					{{ row.batch_no || "原生明细" }} · 账面 {{ row.current_qty ?? "未记录" }} ·
					实点 {{ row.qty }} {{ row.stock_uom }}
				</p>
				<NativeCountAllocations :row="row" />
			</div>
			<TransactionContext :draft="context" :activity-label="activityLabel" mode="display" />
			<p>
				记录人：{{ values.ti_recorder_name || "未填写" }} · 经手人：{{
					values.ti_handler_name || "未填写"
				}}
				· 鉴证人：{{ values.ti_reviewer_name || "未填写" }}
			</p>
			<p v-if="deskOrigin && values.ti_notes" class="preview-long-text">
				{{ values.ti_notes }}
			</p>
			<p v-if="state.error" class="notice-bar danger" role="alert">{{ state.error }}</p>
			<template #footer
				><UiButton :disabled="busy" @click="reviewOpen = false">返回检查</UiButton
				><UiButton
					variant="primary"
					:disabled="c.hasDifferences.value && !c.canSubmit.value"
					:loading="busy"
					@click="confirm"
					>确认提交</UiButton
				></template
			></Overlay
		>
		<Overlay v-if="reloadOpen" title="放弃输入并重新读取？" @close="reloadOpen = false">
			<RecoverySummary
				kind="Stock Reconciliation"
				:values="values"
				:copy-text="c.recoveryText.value"
				:pending-upload-reselection="state.pendingUploadReselection"
			/>
			<template #footer
				><UiButton @click="reloadOpen = false">继续编辑</UiButton
				><UiButton
					variant="danger"
					@click="
						reloadOpen = false;
						c.load(true);
					"
					>放弃并重新读取</UiButton
				></template
			></Overlay
		>
		<Overlay v-if="leaveRequested" title="离开当前盘点？" @close="c.finishLeave('stay')"
			><p>未完成输入仅能在此浏览器恢复，未上传文件需要重新选择。</p>
			<template #footer
				><UiButton @click="c.finishLeave('stay')">继续盘点</UiButton
				><UiButton @click="c.finishLeave('retain')">保留输入并离开</UiButton
				><UiButton variant="danger" @click="c.finishLeave('discard')"
					>放弃输入并离开</UiButton
				></template
			></Overlay
		>
		<Overlay
			v-if="action"
			:title="
				action === 'delete'
					? '删除原生草稿？'
					: action === 'cancel'
						? '取消原生盘点？'
						: '创建修订草稿？'
			"
			@close="!busy && (action = undefined)"
			><p>{{ state.identity?.name }}。将执行 ERPNext 原生流程，并重新校验版本与权限。</p>
			<p v-if="state.error" class="notice-bar danger" role="alert">{{ state.error }}</p>
			<template #footer
				><UiButton :disabled="busy" @click="action = undefined">返回</UiButton
				><UiButton variant="danger" :loading="busy" @click="lifecycle"
					>确认</UiButton
				></template
			></Overlay
		>
	</section>
</template>

<style scoped>
.count-form-shell {
	min-width: 0;
}
.count-form-main {
	gap: 12px !important;
	padding: 0 !important;
	border: 0;
	box-shadow: none;
	background: transparent;
}
.count-form-main > .form-section {
	padding: 8px 10px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	background: var(--p-surface);
}
.count-form-main > .form-section > summary {
	min-height: 44px;
	align-content: center;
	font-weight: 650;
	cursor: pointer;
}
.count-table-scroll {
	max-width: 100%;
	overflow: auto;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
}
.count-native-table {
	width: 100%;
	min-width: 850px;
	border-collapse: collapse;
}
.count-native-table th,
.count-native-table td {
	padding: 5px 8px;
	border-bottom: 1px solid var(--p-border);
	text-align: left;
	vertical-align: middle;
}
.count-native-table th {
	position: sticky;
	top: 0;
	z-index: 1;
	background: var(--p-surface);
}
.count-native-table tbody tr:hover {
	background: var(--p-soft);
}
.count-native-table .count-item-cell {
	min-width: 220px;
}
.count-native-table .count-item-content {
	display: flex;
	align-items: center;
	gap: 8px;
}
.count-native-table .count-item-content strong,
.count-native-table .count-item-content small {
	display: block;
}
.count-native-table .count-item-content strong {
	max-width: 250px;
	overflow-wrap: anywhere;
}
.count-native-table .count-item-content small {
	color: var(--p-muted);
}
.count-native-table .count-actual-input {
	box-sizing: border-box;
	width: 104px;
	max-width: 120px;
	min-height: var(--p-control);
	padding: 3px 7px;
}
.count-desk-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
.count-desk-actions :deep(button) {
	flex: 0 0 auto;
	white-space: nowrap;
	word-break: keep-all;
}
.count-item-thumbnail {
	width: var(--p-table-thumbnail);
	height: var(--p-table-thumbnail);
	flex: 0 0 var(--p-table-thumbnail);
	overflow: hidden;
}
@media (max-width: 1023px) {
	.count-native-table th,
	.count-native-table td {
		padding: 5px 8px;
	}
	.count-native-table .count-actual-input {
		width: 112px;
		min-height: 44px;
	}
	.count-desk-actions {
		position: sticky;
		bottom: calc(var(--p-mobile-nav-height, 56px) + env(safe-area-inset-bottom));
		z-index: 3;
		padding: 8px;
		background: var(--p-surface);
	}
	.count-desk-actions :deep(button) {
		min-height: 44px;
		flex: 1;
	}
	.count-item-thumbnail {
		width: var(--p-table-thumbnail);
		height: var(--p-table-thumbnail);
		flex-basis: var(--p-table-thumbnail);
	}
}
</style>
