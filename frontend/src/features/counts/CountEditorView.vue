<script setup lang="ts">
import { unitLabel } from "../../lib/units";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import PageHeader from "../../components/ui/PageHeader.vue";
import BackButton from "../../components/ui/BackButton.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import { kindIcons } from "../../lib/kindIcons";
import { warehouseLabel } from "../../lib/warehouseLabel";
import QuickExport from "../../components/QuickExport.vue";
import type { ReportQuery } from "../../lib/reportContract";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import PopupMenu from "../../components/ui/PopupMenu.vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { useConfirm } from "../../services/confirm";
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
const { isMobile } = useResponsiveLayout();
const { confirm: confirmDialog } = useConfirm();
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
	supportingDirty,
	leaveRequested,
} = c;
const initialExistingLoad = computed(
	() => loading.value && c.existingDocument.value && !state.server,
);
async function saveDraft() {
	await c.save(true);
	if (state.status === "saved" && !files.incomplete.value) showToast("已存为草稿单据");
	else if (state.status === "saved" && files.incomplete.value)
		showToast("已存为草稿单据，但附件尚未完成上传", "warning");
	else if (state.status === "matching") showToast("盘点数量与账面相同，无需保存调整");
	else if (state.status === "local") showToast("内容尚不完整，已暂存在此浏览器", "warning");
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
	if (!selected) return;
	const approved = await confirmDialog({
		title:
			selected === "delete"
				? "删除草稿单据？"
				: selected === "cancel"
					? "取消盘点？"
					: "创建修订草稿？",
		message: `${state.identity?.name || "此盘点"}。将执行 ERPNext 流程，并重新校验版本与权限。`,
		confirmLabel: selected === "delete" ? "删除草稿" : "确认",
		tone: selected === "delete" || selected === "cancel" ? "danger" : "default",
	});
	if (!approved) {
		action.value = undefined;
		return;
	}
	await c.lifecycle();
	if (action.value || state.error) {
		if (state.error) showToast(`盘点操作失败：${state.error}`, "danger");
		return;
	}
	const outcomes: Record<string, string> = {
		cancel: "盘点调整已取消",
		amend: "盘点修订草稿已创建",
		delete: "盘点草稿单据已删除",
	};
	if (selected && outcomes[selected]) showToast(outcomes[selected]);
}
async function requestLifecycle(kind: "delete" | "cancel" | "amend") {
	action.value = kind;
	await lifecycle();
}
async function reloadCount() {
	if (c.dirty.value) {
		const approved = await confirmDialog({
			title: "放弃输入并重新读取？",
			message: "未保存的盘点输入将被放弃，系统会重新读取当前记录。",
			confirmLabel: "放弃并重新读取",
			tone: "danger",
		});
		if (!approved) return;
	}
	await c.load(true);
}
const root = ref<HTMLElement>(),
	actionBar = ref<HTMLElement>();
const reviewShortcutTitle = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘+Enter" : "Ctrl+Enter";
function reviewShortcut(event: KeyboardEvent) {
	if (
		!(event.ctrlKey || event.metaKey) ||
		event.key !== "Enter" ||
		props.active === false ||
		busy.value ||
		reviewOpen.value ||
		document.querySelector(".preview-overlay")
	)
		return;
	const button = root.value?.querySelector<HTMLButtonElement>("[data-review-action]");
	if (!button || button.disabled) return;
	event.preventDefault();
	button.click();
}
onMounted(() => document.addEventListener("keydown", reviewShortcut));
onBeforeUnmount(() => document.removeEventListener("keydown", reviewShortcut));
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
			pristine: "",
			local: "未保存",
			browser: "已暂存在此浏览器",
			saving: "正在保存草稿单据…",
			saved: "已存为草稿单据",
			error: "保存失败，输入已保留",
			conflict: "记录已更改，输入已保留",
			deleted: "记录已删除",
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
	{ id: "warehouse", label: "位置", required: true, defaultVisible: true },
	{ id: "image", label: "图片", defaultVisible: true },
	{
		id: "item_name",
		label: "物品名称",
		required: true,
		defaultVisible: true,
	},
	{
		id: "item_code",
		label: "物品编码",
		required: true,
		defaultVisible: true,
	},
	{ id: "batch", label: "批次 / 组合", defaultVisible: true },
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
const nativePageSize = 100;
const nativePage = ref(1);
const nativePageCount = computed(() =>
	Math.max(1, Math.ceil(countTableRows.value.length / nativePageSize)),
);
const nativeVisibleRows = computed(() =>
	countTableRows.value.slice(
		(nativePage.value - 1) * nativePageSize,
		nativePage.value * nativePageSize,
	),
);
watch(countTableRows, () => {
	if (nativePage.value > nativePageCount.value) nativePage.value = nativePageCount.value;
});
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
async function nextNativeCountInput(event: KeyboardEvent) {
	event.preventDefault();
	const current = event.currentTarget as HTMLInputElement;
	const inputs = Array.from(
		current
			.closest(".native-count-card-list")
			?.querySelectorAll<HTMLInputElement>(".native-count-card-input:not(:disabled)") || [],
	);
	const index = inputs.indexOf(current);
	if (index >= 0 && index < inputs.length - 1) {
		inputs[index + 1]?.focus();
	} else if (index === inputs.length - 1 && nativePage.value < nativePageCount.value) {
		nativePage.value++;
		await nextTick();
		document
			.querySelector<HTMLInputElement>(".native-count-card-input:not(:disabled)")
			?.focus();
	}
}
async function back() {
	if (await c.requestLeave()) emit("back");
}
</script>
<template>
	<section ref="root" class="preview-form-page">
		<PageHeader class="form-page-heading">
			<div>
				<div class="operation-page-title-row">
					<h1 tabindex="-1">
						<InventoryIcon
							class="operation-kind-heading-icon"
							:name="opening ? 'document' : kindIcons.Reconcile.icon"
						/>
						{{ opening ? "期初库存" : state.identity ? "盘点记录" : "新建盘点" }}
					</h1>
					<PopupMenu
						v-if="state.identity && state.server"
						class="count-editor-overflow-menu"
						label="更多操作"
						variant="icon"
						align="end"
					>
						<a
							class="phone-erpnext-link"
							:href="`/app/stock-reconciliation/${encodeURIComponent(state.identity.name)}`"
							target="_blank"
							rel="noopener"
							>在 ERPNext 查看</a
						>
					</PopupMenu>
				</div>
				<p class="muted">按库存单位核对；留空表示尚未核对，零表示实点为零。</p>
			</div>
			<template #back><BackButton @click="back" /></template>
			<template #actions>
				<QuickExport
					v-if="!loading && c.savedExportQuery.value"
					:query="c.savedExportQuery.value"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
			</template>
		</PageHeader>
		<div
			v-if="
				!isMobile ||
				state.identity ||
				state.status !== 'pristine' ||
				loading ||
				state.server
			"
			class="form-status"
		>
			<span v-if="state.identity && !initialExistingLoad" class="form-record-tag"
				>{{ state.server?.docstatus === 0 ? "草稿单据" : "记录" }}
				{{ state.identity.name }}</span
			><span
				v-if="
					!initialExistingLoad &&
					state.status !== 'pristine' &&
					state.server?.docstatus !== 1
				"
				role="status"
				>{{ status }}</span
			><span v-if="loading && state.server" class="sr-only" role="status">正在刷新…</span
			><NativeStatusBadge v-if="state.server" :status="state.server.docstatus" /><UiButton
				v-if="
					state.identity &&
					(state.server?.docstatus === 0 || state.status === 'conflict')
				"
				:disabled="busy"
				:loading="loading"
				loading-label="正在重新读取…"
				@click="reloadCount"
				>重新读取</UiButton
			>
		</div>
		<DocumentLoadingState
			v-if="initialExistingLoad"
			label="盘点记录加载中…"
			:announce="false"
		/>
		<p v-if="state.error" class="notice-bar danger" role="alert">
			{{ state.error }}
			<UiButton v-if="c.existingDocument.value && !state.server" @click="c.load(true)"
				>重新读取</UiButton
			>
		</p>
		<p v-if="state.recoveryError" role="alert">{{ state.recoveryError }}</p>
		<section
			v-if="['conflict', 'deleted', 'forbidden'].includes(state.status)"
			class="notice-bar warning"
		>
			<p>记录不可继续保存，当前输入已保留。</p>
			<RecoverySummary
				kind="Stock Reconciliation"
				:values="values"
				:copy-text="c.recoveryText.value"
				:pending-upload-reselection="state.pendingUploadReselection"
			/>
		</section>
		<section v-if="state.status === 'matching'" class="notice-bar success">
			<h2>已核对的数量一致，无需盘点调整</h2>
			<p>未创建新的库存记录；未核对的行仍是未完成输入。</p>
			<p v-if="state.identity">
				原有草稿 {{ state.identity.name }} 保持原样。请明确删除该草稿，或继续编辑。
			</p>
			<UiButton
				v-if="state.identity && state.server?.docstatus === 0"
				@click="requestLifecycle('delete')"
				>删除原有草稿单据</UiButton
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
				class="desk-link"
				:href="`/app/stock-reconciliation/${encodeURIComponent(state.identity.name)}`"
				target="_blank"
				rel="noopener"
				>在 ERPNext 查看</a
			><UiButton v-if="state.server?.docstatus === 1" @click="requestLifecycle('cancel')"
				>取消记录</UiButton
			><UiButton
				v-if="state.server?.docstatus === 2 && !opening"
				@click="requestLifecycle('amend')"
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
				<DisclosureSection title="日期与时间" summary="账面基准使用的记录时间点">
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
						<p class="muted">账面基准使用这个明确时间点的库存记录。</p>
					</div>
				</DisclosureSection>
				<CountWorkspace
					v-if="!deskOrigin"
					:controller="c"
					@open-document="(doctype, name) => emit('openDocument', doctype, name)"
				/>
				<section v-else class="form-section">
					<h2>{{ opening ? "期初明细" : "ERPNext 盘点明细" }}</h2>
					<p>
						{{
							opening
								? "期初库存为只读库存记录。"
								: "保留 ERPNext 库位、批次分配和库存单位。"
						}}
					</p>
					<div v-if="isMobile" class="native-count-card-list">
						<p v-if="!nativeVisibleRows.length" class="data-table-state">
							此记录没有明细。
						</p>
						<article
							v-for="entry in nativeVisibleRows"
							:key="entry.id"
							class="native-count-card"
						>
							<template v-if="entry.kind === 'record'">
								<div class="native-count-card-heading">
									<div class="count-item-thumbnail">
										<ItemImage :item="deskItem(entry.value)" />
									</div>
									<div class="native-count-card-identity">
										<strong>{{
											entry.value.ti_display_item_name ||
											entry.value.item_name ||
											c.names[String(entry.value.item_code)] ||
											entry.value.item_code
										}}</strong>
										<small
											>{{ entry.value.item_code
											}}<template
												v-if="
													entry.value.batch_no ||
													entry.value.serial_and_batch_bundle
												"
											>
												·
												{{
													entry.value.batch_no ||
													entry.value.serial_and_batch_bundle
												}}</template
											></small
										>
										<small>{{
											warehouseLabel(
												String(entry.value.warehouse || ""),
												c.reference.warehouses,
											)
										}}</small>
									</div>
								</div>
								<div class="native-count-card-counts">
									<div>
										<span>账面</span
										><strong
											>{{ entry.value.current_qty ?? "未记录" }}
											{{ unitLabel(entry.value.stock_uom) }}</strong
										>
									</div>
									<label v-if="writable" class="native-count-card-entry">
										实点数量
										<input
											class="native-count-card-input"
											type="number"
											inputmode="decimal"
											enterkeyhint="next"
											min="0"
											step="any"
											v-model.number="countRow(entry.value).qty"
											:disabled="busy"
											:aria-label="`${entry.value.ti_display_item_name || entry.value.item_name || c.names[String(entry.value.item_code)] || entry.value.item_code}实点数量`"
											@keydown.enter="nextNativeCountInput"
										/>
									</label>
									<div v-else>
										<span>实点数量</span
										><strong
											>{{ entry.value.qty ?? "未核对" }}
											{{ unitLabel(entry.value.stock_uom) }}</strong
										>
									</div>
								</div>
								<details
									v-if="
										entry.value.serial_and_batch_bundle ||
										(Array.isArray(entry.value.recorded_count_allocations) &&
											entry.value.recorded_count_allocations.length)
									"
								>
									<summary class="ti-disclosure">
										<DisclosureIcon variant="inline" />查看分配
									</summary>
									<NativeCountAllocations :row="countRow(entry.value)" />
								</details>
							</template>
						</article>
						<div v-if="nativePageCount > 1" class="native-count-pagination">
							<UiButton :disabled="nativePage <= 1" @click="nativePage--"
								>上一页</UiButton
							>
							<span>{{ nativePage }} / {{ nativePageCount }}</span>
							<UiButton
								:disabled="nativePage >= nativePageCount"
								@click="nativePage++"
								>下一页</UiButton
							>
						</div>
					</div>
					<DataTable
						v-else
						ariaLabel="盘点明细"
						table-class="count-table count-native-table"
						:columns="countColumns"
						:rows="countTableRows"
						:loading="loading"
						:initialized="Boolean(state.server)"
						:column-preferences="countPrefs"
						empty-text="此记录没有明细。"
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
								unitLabel(row.stock_uom)
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
								inputmode="decimal"
								enterkeyhint="next"
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
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" />查看分配
								</summary>
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
					<p v-if="!state.confirmationVersion" class="count-action-summary">
						{{ reviewedRows.length }}/{{ rows.length }} 行已核对
					</p>
					<UiButton
						v-if="!state.confirmationVersion"
						:disabled="busy || supportingDirty"
						@click="saveDraft"
						>保存草稿</UiButton
					>
					<UiButton
						v-if="!state.confirmationVersion && c.canSubmit.value"
						variant="primary"
						data-review-action
						:title="reviewShortcutTitle"
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
						v-if="state.identity && state.server?.docstatus === 0"
						:disabled="busy || !writable"
						variant="danger"
						@click="requestLifecycle('delete')"
						>删除草稿单据</UiButton
					>
				</div>
				<DisclosureSection title="盘点备注" summary="填写盘点说明">
					<label v-if="writable" class="preview-field"
						>盘点备注<textarea v-model="values.ti_notes" rows="3" :disabled="busy" />
					</label>
					<p v-else class="preview-long-text">{{ values.ti_notes || "未填写" }}</p>
				</DisclosureSection>
				<DisclosureSection title="活动、人员与附件" summary="关联背景与记录人员">
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
				</DisclosureSection>
				<p v-if="showError && !valid" role="alert" class="notice-bar warning">
					请先读取当前账面基准，并至少核对一行。输入已保留。
				</p>
			</form>
		</div>
		<Overlay v-if="reviewOpen" title="核对并确认盘点" @close="!busy && (reviewOpen = false)"
			><CountSummary v-if="!deskOrigin" :rows="rows" />
			<p v-if="!deskOrigin" class="count-confirmation-note">
				未核对的行仍保留在本次范围中，但不会进入盘点调整。
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
					{{ row.actual_qty ?? "待核对" }} {{ unitLabel(row.stock_uom) }} · 差异
					{{ row.actual_qty === null ? "待核对" : row.actual_qty - row.baseline_qty }}
					<span v-if="row.reason"> · 原因 {{ row.reason }}</span>
				</p>
				<p v-if="!reviewedRows.length" class="muted">尚无已核对行。</p>
			</div>
			<div v-else v-for="(row, index) in values.items" :key="String(row.name || index)">
				<p>
					{{ row.item_code }} ·
					{{ warehouseLabel(row.warehouse, c.reference.warehouses) }} ·
					{{ row.batch_no || "库存明细" }} · 账面 {{ row.current_qty ?? "未记录" }} ·
					实点 {{ row.qty }} {{ unitLabel(row.stock_uom) }}
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
@media (hover: hover) {
	.count-native-table tbody tr:hover {
		background: var(--p-soft);
	}
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
.native-count-card-list {
	display: grid;
	gap: 8px;
}
.native-count-card {
	min-width: 0;
	padding: 10px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
}
.native-count-card-heading {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 10px;
}
.native-count-card-identity {
	display: grid;
	min-width: 0;
	gap: 2px;
}
.native-count-card-identity strong,
.native-count-card-identity small {
	display: -webkit-box;
	overflow: hidden;
	-webkit-box-orient: vertical;
	word-break: break-word;
}
.native-count-card-identity strong {
	-webkit-line-clamp: 2;
}
.native-count-card-identity small {
	color: var(--p-muted);
	-webkit-line-clamp: 1;
}
.native-count-card-counts {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(116px, 0.9fr);
	align-items: center;
	gap: 10px;
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid var(--p-border);
}
.native-count-card-counts > div,
.native-count-card-entry {
	display: grid;
	gap: 3px;
}
.native-count-card-counts span,
.native-count-card-entry {
	color: var(--p-muted);
	font-size: 0.78rem;
}
.native-count-card-input {
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
	min-height: 44px;
	padding: 4px 8px;
}
.native-count-pagination {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
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
		position: fixed;
		left: 16px;
		right: 16px;
		bottom: calc(var(--preview-nav-height, 84px) + 8px + env(safe-area-inset-bottom));
		z-index: var(--p-z-sticky-content);
		align-items: center;
		padding: 8px;
		border: 1px solid var(--p-border);
		border-radius: 14px;
		background: var(--p-surface);
		box-shadow: 0 -4px 12px rgb(20 30 25 / 7%);
	}
	.count-action-summary {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--p-small);
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
