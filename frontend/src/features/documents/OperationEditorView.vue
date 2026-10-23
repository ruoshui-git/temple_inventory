<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import PageHeader from "../../components/ui/PageHeader.vue";
import QuickExport from "../../components/QuickExport.vue";
import type { ReportQuery } from "../../lib/reportContract";
import { computed, nextTick, ref, watch } from "vue";
import type { OperationEditor } from "./useOperationEditor";
import { operationLabels } from "./operationCodec";
import OperationLines from "./OperationLines.vue";
import AllocationSummary from "./AllocationSummary.vue";
import TransactionContext from "./TransactionContext.vue";
import Attachments from "../../components/Attachments.vue";
import UiButton from "../../components/ui/UiButton.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import Overlay from "../../components/ui/Overlay.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import { warehouseLabel } from "../../lib/warehouseLabel";
import RemoteSelect from "../../components/ui/RemoteSelect.vue";
import { useExpandedEditor } from "../../composables/useExpandedEditor";
import { useFocusVisibility } from "../../composables/useFocusVisibility";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { useInventoryServices } from "../../services/contracts";
import { newReportQuery } from "../../lib/reportContract";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import { enumPresentationLabel } from "../../lib/presentationLabels";
import DocumentLoadingState from "../../components/ui/DocumentLoadingState.vue";
import { showToast } from "../../services/toast";
const props = withDefaults(defineProps<{ controller: OperationEditor; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	back: [];
	leave: [];
	openExport: [query: ReportQuery];
}>();
const c = props.controller;
const {
	draft,
	state,
	activityLabel,
	reference,
	loading,
	busy,
	writable,
	dirty,
	files,
	issues,
	showError,
	reviewOpen,
	action,
} = c;
const supplementOpen = ref(false);
watch(
	() =>
		files.files
			.filter((file) => ["error", "reselect"].includes(file.state))
			.map((file) => `${file.id}:${file.state}`)
			.join("|"),
	(value) => {
		if (value) supplementOpen.value = true;
	},
);
const formRoot = ref<HTMLElement>(),
	reviewBar = ref<HTMLElement>(),
	lineEditor = ref<InstanceType<typeof OperationLines>>();
const { expanded, toggle } = useExpandedEditor(formRoot, () => props.active !== false);
const { isDesktop, isMobile } = useResponsiveLayout();
const previewCollapsed = ref(false);
const mobileReviewOpen = ref(false);
let previousPreviewCollapsed = false;
watch(expanded, async (value, previous) => {
	if (value) {
		previousPreviewCollapsed = previewCollapsed.value;
		previewCollapsed.value = false;
	} else if (previous && previousPreviewCollapsed) {
		await nextTick();
		previewCollapsed.value = true;
		await nextTick();
		formRoot.value?.querySelector<HTMLElement>(".preview-edge-rail")?.focus({
			preventScroll: true,
		});
	}
});
watch(isMobile, (mobile) => {
	if (mobile) {
		previewCollapsed.value = false;
		mobileReviewOpen.value = false;
	}
});
useFocusVisibility(
	formRoot,
	reviewBar,
	() => true,
	() => props.active !== false,
);
const receive = computed(() => draft.value.kind === "Receive"),
	title = computed(
		() => operationLabels[draft.value.kind] || String(state.server?.purpose || "库存记录"),
	);
const { supportingDirty, leaveRequested: leaveOpen } = c;
const reloadOpen = ref(false),
	loanChoice = ref("");
const services = useInventoryServices();
const editing = computed(
	() => state.status === "conflict" || !state.server || state.server.editable === true,
);
const initialExistingLoad = computed(
	() => loading.value && c.existingDocument.value && !state.server,
);
const itemCount = computed(() => new Set(draft.value.items.map((line) => line.code)).size);
const totals = computed(() => {
	const values = new Map<string, number>();
	for (const line of draft.value.items)
		values.set(line.uom, (values.get(line.uom) || 0) + Number(line.qty || 0));
	return [...values].map(([unit, qty]) => `${qty} ${unit}`).join(" · ");
});
const statusLabels = {
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
};
async function review() {
	await c.review();
	if (!issues.value.length) return;
	const issue = issues.value[0];
	if (issue?.lineId) {
		await lineEditor.value?.revealIssue(issue);
		return;
	}
	await nextTick();
	const field = issue?.field
		? formRoot.value?.querySelector<HTMLElement>(`[data-field="${issue.field}"]`)
		: undefined;
	const target = field?.matches("input, select, button")
		? field
		: field?.querySelector<HTMLElement>("input, select, button");
	target?.focus();
}
async function addLoan() {
	try {
		await c.appendLoan(loanChoice.value);
	} catch (reason) {
		state.error = reason instanceof Error ? reason.message : "借用读取失败";
	}
}
async function loans(search: string, start: number, signal: AbortSignal) {
	const query = newReportQuery("loans");
	query.view = "records";
	query.search = search;
	query.loanStatus = "outstanding";
	const page = await services.report(query, { start, page_length: 30 }, signal);
	return {
		rows: page.rows.map((row) => ({
			value: String(row.document || row.original_loan),
			label: `${row.borrower || ""} · ${row.document || row.original_loan}`,
			detail: String(row.activity_title || ""),
		})),
		total: page.matched_count,
		next: page.next_start,
	};
}
async function back() {
	if (await c.requestLeave()) emit("back");
}
async function saveDraft() {
	await c.save(true);
	if (state.status === "saved" && !files.incomplete.value) showToast("已存为草稿单据");
	else if (state.status === "saved" && files.incomplete.value)
		showToast("已存为草稿单据，但附件尚未完成上传", "warning");
	else if (state.status === "local") showToast("内容尚不完整，已暂存在此浏览器", "warning");
	else if (state.error) showToast(`草稿保存失败：${state.error}`, "danger");
}
async function confirm() {
	await c.confirm();
	if (state.status === "submitted") showToast("库存单据已提交");
	else if (state.error) showToast(`提交失败：${state.error}`, "danger");
}
async function lifecycle() {
	const selected = action.value;
	await c.lifecycle();
	if (action.value || state.error) {
		if (state.error) showToast(`操作失败：${state.error}`, "danger");
		return;
	}
	const outcomes: Record<string, string> = {
		cancel: "库存单据已取消",
		amend: "修订草稿已创建",
		delete: "库存草稿已删除",
		duplicate: "新库存草稿已创建",
	};
	if (selected && outcomes[selected]) showToast(outcomes[selected]);
}
</script>
<template>
	<section
		id="operation-editor-preview"
		ref="formRoot"
		class="preview-form-page"
		:class="{ 'workspace-expanded': expanded }"
	>
		<PageHeader class="form-page-heading"
			><div>
				<h1 tabindex="-1">{{ title }}</h1>
				<p class="muted">核对物品、数量、批次与库位，复核后确认。</p>
			</div>
			<template #back><UiButton variant="ghost" @click="back">返回</UiButton></template
			><template #actions
				><QuickExport
					v-if="!loading && c.savedExportQuery.value"
					:query="c.savedExportQuery.value"
					:active="active"
					@open-full="emit('openExport', $event)" /></template
		></PageHeader>
		<DocumentLoadingState
			v-if="initialExistingLoad"
			label="库存单据加载中…"
			:announce="false"
		/>
		<div class="form-status">
			<span v-if="state.identity && !initialExistingLoad" class="form-record-tag"
				>{{ state.server?.docstatus === 0 ? "草稿单据" : "记录" }}
				{{ state.identity.name }}</span
			><span v-if="!initialExistingLoad && state.status !== 'pristine'" role="status">{{
				statusLabels[state.status]
			}}</span
			><span v-if="loading && state.server" class="sr-only" role="status">正在刷新…</span
			><NativeStatusBadge v-if="state.server" :status="state.server.docstatus" /><UiButton
				v-if="state.identity && !busy"
				@click="dirty ? (reloadOpen = true) : c.load(true)"
				>重新读取</UiButton
			>
		</div>
		<p v-if="state.error" class="notice-bar danger" role="alert">
			{{ state.error }}
			<UiButton v-if="c.existingDocument.value && !state.server" @click="c.load(true)"
				>重新读取</UiButton
			>
		</p>
		<p v-if="state.recoveryError" class="notice-bar warning" role="alert">
			{{ state.recoveryError }}
		</p>
		<div
			v-if="['conflict', 'deleted', 'forbidden'].includes(state.status)"
			class="notice-bar warning"
		>
			<p>当前输入保留在下方；请复制后核对原记录。</p>
			<RecoverySummary
				:kind="
					String(state.values.ti_movement_kind || state.values.purpose || 'Stock Entry')
				"
				:values="state.values"
				:copy-text="c.recoveryText.value"
				:pending-upload-reselection="state.pendingUploadReselection"
			/>
		</div>
		<div v-if="!loading && state.server && !writable" class="form-actions">
			<a
				:href="`/app/${state.server.doctype === 'Stock Entry' ? 'stock-entry' : 'stock-reconciliation'}/${encodeURIComponent(state.server.name)}`"
				target="_blank"
				rel="noopener"
				>在 ERPNext 查看</a
			><UiButton
				v-if="
					state.server.docstatus === 1 &&
					(state.server.permissions as Record<string, boolean>)?.cancel
				"
				@click="action = 'cancel'"
				>取消记录</UiButton
			><UiButton
				v-if="
					state.server.docstatus === 2 &&
					(state.server.permissions as Record<string, boolean>)?.amend
				"
				@click="action = 'amend'"
				>创建修订草稿</UiButton
			><UiButton
				v-if="(state.server.permissions as Record<string, boolean>)?.duplicate"
				@click="action = 'duplicate'"
				>复制为新草稿</UiButton
			>
		</div>
		<form
			v-if="!c.existingDocument.value || state.server"
			novalidate
			class="form-layout async-result-region"
			:class="{
				'is-refreshing': loading && state.server,
				'workspace-review-collapsed': previewCollapsed && isDesktop && !expanded,
			}"
			:aria-busy="loading && state.server ? 'true' : undefined"
			@submit.prevent="review"
		>
			<div class="form-main surface">
				<template v-if="editing">
					<section class="form-section form-date-section">
						<label class="preview-field"
							>操作日期<input
								v-model="draft.postingDate"
								data-field="postingDate"
								:aria-invalid="
									showError &&
									issues.some((issue) => issue.field === 'postingDate')
								"
								type="date"
								:disabled="
									!writable || busy || draft.timeMode === 'current'
								" /></label
						><label class="preview-field"
							>时间方式<select
								v-model="draft.timeMode"
								:disabled="!writable || busy"
							>
								<option value="current">确认时的当前时间</option>
								<option value="manual">指定历史时间</option>
							</select></label
						><label v-if="draft.timeMode === 'manual'" class="preview-field"
							>操作时间<input
								v-model="draft.postingTime"
								data-field="postingTime"
								:aria-invalid="
									showError &&
									issues.some((issue) => issue.field === 'postingTime')
								"
								type="time"
								step="1"
								:disabled="!writable || busy"
						/></label>
						<p v-if="draft.timeMode === 'manual'" class="muted">
							可用数量按指定日期和时间核对。
						</p>
					</section>
					<section
						v-if="draft.kind === 'Loan' || draft.kind === 'Return' || draft.loanName"
						class="form-section"
					>
						<h2>{{ draft.kind === "Loan" ? "借用对象" : "归还来源" }}</h2>
						<div class="form-fields">
							<template v-if="draft.kind === 'Loan'"
								><label class="preview-field"
									>借用人 / 团体<input
										v-model="draft.borrower"
										data-field="borrower"
										:aria-invalid="
											showError &&
											issues.some((issue) => issue.field === 'borrower')
										"
										:disabled="!writable || busy" /></label
								><SearchSelect
									label="借出存放库位"
									data-field="loanDestination"
									:invalid="
										showError &&
										issues.some((issue) => issue.field === 'loanDestination')
									"
									:model-value="draft.loanDestination"
									@update:model-value="c.setLoanDestination"
									:options="
										reference.leasedLeaves.map((name) => ({
											value: name,
											label: warehouseLabel(name, reference.warehouses),
											detail:
												reference.warehouses.find(
													(row) => row.name === name,
												)?.path || '',
										}))
									"
									:disabled="!writable || busy" /></template
							><template v-else
								><RemoteSelect
									label="关联借用记录"
									v-model="loanChoice"
									:load="loans"
									:disabled="!writable || busy"
								/><UiButton
									:disabled="!loanChoice || !writable || busy"
									@click="addLoan"
									>加入此借用</UiButton
								>
								<p>
									{{ draft.borrower }} · {{ activityLabel
									}}<br />可加入同一借用方和活动的多笔借用；遗失使用单独操作。
								</p></template
							>
						</div>
					</section>
				</template>
				<dl v-else class="preview-info-grid form-section">
					<div>
						<dt>操作日期</dt>
						<dd>{{ draft.postingDate }}</dd>
					</div>
					<div>
						<dt>操作时间（站点时间）</dt>
						<dd>{{ draft.postingTime }}</dd>
					</div>
					<div v-if="draft.borrower">
						<dt>借用方</dt>
						<dd>{{ draft.borrower }}</dd>
					</div>
					<div v-if="draft.kind === 'Loan'">
						<dt>借出存放库位</dt>
						<dd>
							{{
								reference.warehouses.find(
									(row) => row.name === draft.loanDestination,
								)?.label || draft.loanDestination
							}}
						</dd>
					</div>
				</dl>
				<p v-if="draft.amendedFrom" class="preview-long-text">
					修订来源：{{ draft.amendedFrom }}
				</p>
				<section class="form-section operation-section">
					<div class="operation-heading-row">
						<h2>操作物资</h2>
						<UiButton
							class="preview-full-workspace-action"
							variant="ghost"
							:icon="expanded ? 'contract' : 'expand'"
							icon-only
							:label="expanded ? '退出完整工作区' : '展开完整工作区'"
							:aria-pressed="!!expanded"
							@click="toggle"
						/>
					</div>
					<p class="muted">
						{{
							receive
								? "按库位 → 物品 → 批次明细填写，数量由明细合计。"
								: "核对库位、现有批次与可处理数量。"
						}}
					</p>
					<OperationLines
						ref="lineEditor"
						:draft="draft"
						:mode="editing ? 'edit' : 'display'"
						:disabled="!writable || busy"
						:show-error="showError"
						:expanded="expanded"
						:active="active"
						@expand="toggle"
					/>
				</section>
				<DisclosureSection
					v-model:open="supplementOpen"
					title="补充记录"
					summary="活动、人员、备注与凭证附件"
				>
					<div class="form-grid">
						<TransactionContext
							:draft="draft"
							:activity-label="activityLabel"
							:disabled="!writable || busy"
							:mode="editing ? 'edit' : 'display'"
							@dirty-change="supportingDirty = $event"
						/><label v-if="editing" class="preview-field full-width"
							>备注<textarea
								v-model="draft.note"
								rows="3"
								:disabled="!writable || busy"
							/>
						</label>
						<div v-else class="preview-long-text">{{ draft.note }}</div>
					</div>
					<div class="attachment-area">
						<h3>凭证附件 <small class="muted">可选</small></h3>
						<Attachments
							:controller="files"
							:disabled="!writable || busy"
							:mode="editing ? 'edit' : 'display'"
						/>
					</div>
					<fieldset v-if="editing" class="people-fields" :disabled="!writable || busy">
						<legend>现场人员（可选）</legend>
						<div class="form-grid">
							<label class="preview-field"
								>记录人<input v-model="draft.recorder" /></label
							><label class="preview-field"
								>经手人<input v-model="draft.handler" /></label
							><label class="preview-field"
								>鉴证人<input v-model="draft.reviewer"
							/></label>
						</div>
					</fieldset>
					<dl v-else class="preview-info-grid">
						<div
							v-for="(value, label) in {
								记录人: draft.recorder,
								经手人: draft.handler,
								鉴证人: draft.reviewer,
							}"
							:key="label"
						>
							<dt>{{ label }}</dt>
							<dd>{{ value || "未填写" }}</dd>
						</div>
					</dl>
				</DisclosureSection>
				<div v-if="showError && issues.length" role="alert" class="notice-bar warning">
					<p v-for="issue in issues.filter((row) => !row.lineId)" :key="issue.field">
						{{ issue.message }}
					</p>
					<p>{{ issues.length }} 处待完善，输入已保留。</p>
				</div>
				<div
					v-if="writable || state.confirmationVersion"
					ref="reviewBar"
					class="form-actions preview-document-actions"
				>
					<p class="muted">
						{{ draft.items.length }} 行 · {{ totals || "尚未添加物品" }}
					</p>
					<UiButton
						v-if="!state.confirmationVersion"
						:disabled="busy || supportingDirty"
						@click="saveDraft"
						>保存草稿</UiButton
					><UiButton
						v-if="!state.confirmationVersion && c.canSubmit.value"
						variant="primary"
						type="submit"
						:disabled="busy || supportingDirty"
						:loading="busy"
						>复核并确认</UiButton
					><UiButton
						v-else-if="state.confirmationVersion"
						variant="primary"
						:loading="busy"
						@click="confirm"
						>检查上次确认结果</UiButton
					><small class="muted">复核并确认后才变更库存。</small
					><UiButton
						v-if="
							state.identity &&
							(state.server?.permissions as Record<string, boolean>)?.delete
						"
						:disabled="!writable || busy"
						@click="action = 'delete'"
						>删除草稿单据</UiButton
					>
				</div>
			</div>
			<aside id="operation-review-panel" class="form-review surface">
				<button
					v-if="isDesktop && !expanded"
					type="button"
					class="preview-edge-rail"
					:aria-expanded="!previewCollapsed"
					aria-controls="operation-review-content"
					:aria-label="previewCollapsed ? '展开确认前检查' : '收起确认前检查到边缘'"
					@click="previewCollapsed = !previewCollapsed"
				>
					<InventoryIcon :name="previewCollapsed ? 'chevron-left' : 'chevron-right'" />
					<span v-if="previewCollapsed" class="preview-edge-rail-label">确认前检查</span>
				</button>
				<details
					class="review-preview-disclosure"
					:open="isDesktop || mobileReviewOpen"
					@toggle="mobileReviewOpen = ($event.currentTarget as HTMLDetailsElement).open"
				>
					<summary class="review-preview-summary ti-disclosure">
						<DisclosureIcon variant="inline" />
						确认前检查 · {{ totals || "尚未添加物品" }} · {{ itemCount }} 种物品
					</summary>
					<div
						id="operation-review-content"
						class="review-preview-content"
						:aria-hidden="previewCollapsed ? 'true' : undefined"
						:inert="previewCollapsed || undefined"
					>
						<span class="eyebrow">确认前检查</span>
						<h2>操作汇总</h2>
						<div class="review-metric">
							<strong>{{ totals || "尚未添加物品" }}</strong
							><span>各单位分别合计</span>
						</div>
						<p class="review-scope">
							{{ itemCount }} 种物品 · {{ draft.items.length }} 条明细
						</p>
						<div class="review-lines-disclosure">
							<AllocationSummary :draft="draft" collapsible />
						</div>
						<p v-if="draft.kind === 'Loan'">
							借用方：{{ draft.borrower || "待填写" }}
						</p>
						<p v-if="draft.activity">活动：{{ activityLabel }}</p>
						<p v-if="draft.postingDate">日期：{{ draft.postingDate }}</p>
						<p class="muted">确认前请核对物品、数量和库位。复核并确认后才变更库存。</p>
					</div>
				</details>
			</aside>
		</form>
		<Overlay
			v-if="reviewOpen"
			:title="`检查并确认${title}`"
			@close="!busy && (reviewOpen = false)"
			><p>
				{{ draft.postingDate }} ·
				{{ draft.timeMode === "current" ? "确认时的当前时间" : draft.postingTime }}
			</p>
			<p>{{ itemCount }} 种物品 · {{ draft.items.length }} 条明细 · {{ totals }}</p>
			<AllocationSummary :draft="draft" /><TransactionContext
				:draft="draft"
				:activity-label="activityLabel"
				mode="display"
			/>
			<dl class="preview-info-grid">
				<div
					v-for="(value, label) in {
						借用方: draft.borrower,
						记录人: draft.recorder,
						经手人: draft.handler,
						鉴证人: draft.reviewer,
					}"
					:key="label"
				>
					<dt>{{ label }}</dt>
					<dd>{{ value || "未填写" }}</dd>
				</div>
			</dl>
			<div class="preview-long-text">{{ draft.note }}</div>
			<p>{{ files.files.length }} 份附件。确认后此记录及附件不可直接修改。</p>
			<p v-if="state.error" class="notice-bar danger" role="alert">{{ state.error }}</p>
			<template #footer
				><UiButton :disabled="busy" @click="reviewOpen = false">返回检查</UiButton
				><UiButton variant="primary" :loading="busy" @click="confirm"
					>确认提交</UiButton
				></template
			></Overlay
		>
		<Overlay v-if="reloadOpen" title="放弃当前输入并重新读取？" @close="reloadOpen = false"
			><p>重新读取会替换当前页面的输入。可先复制保留。</p>
			<template #footer
				><RecoverySummary
					:kind="
						String(
							state.values.ti_movement_kind || state.values.purpose || 'Stock Entry',
						)
					"
					:values="state.values"
					:copy-text="c.recoveryText.value"
				/>
				<UiButton @click="reloadOpen = false">继续编辑</UiButton
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
		<Overlay v-if="leaveOpen" title="离开当前编辑？" @close="c.finishLeave('stay')"
			><p>未完成输入仅能在此浏览器恢复；待上传文件需要重新选择。</p>
			<template #footer
				><UiButton @click="c.finishLeave('stay')">继续编辑</UiButton
				><UiButton @click="c.finishLeave('retain')">保留输入并离开</UiButton
				><UiButton variant="danger" @click="c.finishLeave('discard')"
					>放弃输入并离开</UiButton
				></template
			></Overlay
		>
		<Overlay
			v-if="action"
			:title="
				action === 'cancel'
					? '取消此记录？'
					: action === 'delete'
						? '删除此草稿单据？'
						: action === 'duplicate'
							? '复制为新草稿？'
							: '创建修订草稿？'
			"
			@close="!busy && (action = undefined)"
			><p>
				{{ state.identity?.name }}。{{
					action === "cancel"
						? "将通过 ERPNext 取消流程恢复库存，相关依赖仍会校验。"
						: action === "delete"
							? "仅删除此草稿单据，已创建的物品、分类和单位仍保留。"
							: action === "duplicate"
								? "另建草稿单据，保留物品、明细与单位换算；附件需重新添加。请核对当前库存与入账时间。"
								: "保留原记录，另建带修订来源的新草稿。"
				}}
			</p>
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
