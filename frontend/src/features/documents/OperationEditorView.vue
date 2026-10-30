<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import { RouterLink } from "vue-router";
import { personDestination } from "../../lib/nativeNavigation";
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import PageHeader from "../../components/ui/PageHeader.vue";
import BackButton from "../../components/ui/BackButton.vue";
import QuickExport from "../../components/QuickExport.vue";
import type { ReportQuery } from "../../lib/reportContract";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { OperationEditor } from "./useOperationEditor";
import { operationLabels } from "../../lib/presentationLabels";
import OperationLines from "./OperationLines.vue";
import AllocationSummary from "./AllocationSummary.vue";
import TransactionContext from "./TransactionContext.vue";
import Attachments from "../../components/Attachments.vue";
import UiButton from "../../components/ui/UiButton.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import { kindIcons } from "../../lib/kindIcons";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import Overlay from "../../components/ui/Overlay.vue";
import FormField from "../../components/ui/FormField.vue";
import { useFormValidation } from "../../composables/useFormValidation";
import { useConfirm } from "../../services/confirm";
import { useVirtualKeyboard } from "../../composables/useVirtualKeyboard";
import { useExpandedEditor } from "../../composables/useExpandedEditor";
import { useFocusVisibility } from "../../composables/useFocusVisibility";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { useInventoryServices } from "../../services/contracts";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import { unitLabel, sortByUnit } from "../../lib/units";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/formatQuantity";
import { operationSectionLocation } from "./operationModel";
import { useReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
import DocumentLoadingState from "../../components/ui/DocumentLoadingState.vue";
import { showToast } from "../../services/toast";
import PopupMenu from "../../components/ui/PopupMenu.vue";
import {
	borrowerLoanPageState,
	type BorrowerLoanPageState,
	type OutstandingBorrowerSummary,
	type OutstandingLoanSummary,
} from "./creationFormPresentation";
const props = withDefaults(defineProps<{ controller: OperationEditor; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	back: [];
	leave: [];
	openExport: [query: ReportQuery];
}>();
const c = props.controller;
function personRole(label: string): "recorder" | "handler" | "reviewer" | undefined {
	return ({ 记录人: "recorder", 经手人: "handler", 鉴证人: "reviewer" } as const)[
		label as "记录人" | "经手人" | "鉴证人"
	];
}
const reference = useReferenceData();
const {
	draft,
	state,
	activityLabel,
	loading,
	hydrating,
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
const visualViewport = window.visualViewport;
function syncOperationViewport() {
	const root = formRoot.value;
	if (!root || !visualViewport) return;
	root.style.setProperty("--operation-visual-width", `${visualViewport.width}px`);
	root.style.setProperty("--operation-visual-height", `${visualViewport.height}px`);
	root.style.setProperty("--operation-visual-left", `${visualViewport.offsetLeft}px`);
	root.style.setProperty("--operation-visual-top", `${visualViewport.offsetTop}px`);
}
onMounted(() => {
	syncOperationViewport();
	visualViewport?.addEventListener("resize", syncOperationViewport);
	visualViewport?.addEventListener("scroll", syncOperationViewport);
});
onBeforeUnmount(() => {
	visualViewport?.removeEventListener("resize", syncOperationViewport);
	visualViewport?.removeEventListener("scroll", syncOperationViewport);
});
const { expanded, toggle } = useExpandedEditor(formRoot, () => props.active !== false);
const { isDesktop, isMobile } = useResponsiveLayout();
const { keyboardOpen } = useVirtualKeyboard();
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
		formRoot.value?.querySelector<HTMLElement>(".form-review-edge-rail")?.focus({
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
const reviewShortcutTitle = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘+Enter" : "Ctrl+Enter";
function reviewShortcut(event: KeyboardEvent) {
	if (
		!(event.ctrlKey || event.metaKey) ||
		event.key !== "Enter" ||
		props.active === false ||
		busy.value ||
		reviewOpen.value ||
		document.querySelector(".ui-overlay")
	)
		return;
	const button = formRoot.value?.querySelector<HTMLButtonElement>("[data-review-action]");
	if (!button || button.disabled) return;
	event.preventDefault();
	button.click();
}
onMounted(() => document.addEventListener("keydown", reviewShortcut));
onBeforeUnmount(() => document.removeEventListener("keydown", reviewShortcut));
const services = useInventoryServices();
const { confirm: confirmDialog } = useConfirm();
const validation = useFormValidation();
const subtitles: Record<string, string> = {
	Receive: "登记新到物资及其存放位置。",
	Issue: "从现有库存领用或发出物资。",
	Transfer: "在实体库位之间移动物资。",
	Loan: "登记借出物资及借用方。",
	Return: "按未结清借用登记归还结果。",
	Damage: "登记需要处理的受损物资。",
	Loss: "登记不再计入库存的物资。",
	Repair: "将已修复物资放回实体库位。",
	Disposal: "登记受损物资的报废处理。",
};

const borrowerGroups = ref<OutstandingBorrowerSummary[]>([]),
	groupLoans = ref<Record<string, BorrowerLoanPageState>>({}),
	expandedBorrower = ref(""),
	loanListOpen = ref(true),
	loanSearch = ref(""),
	outstandingLoading = ref(false),
	borrowerGroupsNext = ref<number | null>(null),
	borrowerSuggestions = ref<string[]>([]);
let borrowerSearchTimer: ReturnType<typeof setTimeout> | undefined;
onMounted(async () => {
	if (draft.value.kind === "Loan") {
		try {
			const result = await services.call<{ value: string }[]>("people.borrowers");
			borrowerSuggestions.value = result.map((row) => row.value);
		} catch {
			borrowerSuggestions.value = [];
		}
	}
	if (draft.value.kind === "Return") await loadOutstandingLoanGroups();
});
onBeforeUnmount(() => clearTimeout(borrowerSearchTimer));
async function loadOutstandingLoanGroups(append = false) {
	outstandingLoading.value = true;
	try {
		const result = await services.call<{
			rows: OutstandingBorrowerSummary[];
			next: number | null;
		}>("native_api.outstanding_loan_groups", {
			search: loanSearch.value,
			start: append ? borrowerGroupsNext.value || 0 : 0,
			page_length: 30,
		});
		borrowerGroups.value = append ? [...borrowerGroups.value, ...result.rows] : result.rows;
		borrowerGroupsNext.value = result.next;
		if (!append) {
			groupLoans.value = {};
			expandedBorrower.value = "";
		}
	} catch (reason) {
		state.error = reason instanceof Error ? reason.message : "未结清借用加载失败";
	} finally {
		outstandingLoading.value = false;
	}
}
function scheduleBorrowerSearch() {
	clearTimeout(borrowerSearchTimer);
	borrowerSearchTimer = setTimeout(() => void loadOutstandingLoanGroups(), 250);
}
async function loadBorrowerLoans(group: OutstandingBorrowerSummary, append = false) {
	const groupState = borrowerLoanPageState(groupLoans.value, group.borrower);
	if (groupState.loading || (groupState.next === null && groupState.rows.length)) return;
	groupState.loading = true;
	try {
		const result = await services.call<{
			rows: OutstandingLoanSummary[];
			next: number | null;
		}>("native_api.outstanding_loans", {
			borrower: group.borrower,
			search: loanSearch.value,
			start: append ? groupState.next || 0 : 0,
			page_length: 10,
		});
		groupState.rows = append ? [...groupState.rows, ...result.rows] : result.rows;
		groupState.next = result.next;
	} catch (reason) {
		state.error = reason instanceof Error ? reason.message : "未结清借用加载失败";
	} finally {
		groupState.loading = false;
	}
}
async function toggleBorrower(group: OutstandingBorrowerSummary) {
	if (expandedBorrower.value === group.borrower) {
		expandedBorrower.value = "";
		return;
	}
	expandedBorrower.value = group.borrower;
	if (!groupLoans.value[group.borrower]?.rows.length) await loadBorrowerLoans(group);
}
const selectedLoanNames = computed(
	() => [...new Set(draft.value.items.map((line) => line.loanName).filter(Boolean))] as string[],
);
validation.register(
	"borrower",
	() => draft.value.borrower,
	[
		(value) =>
			draft.value.kind !== "Loan" || String(value || "").trim() ? true : "请填写借用方",
	],
	() => formRoot.value?.querySelector<HTMLElement>('[data-field="borrower"]')?.focus(),
);
validation.register(
	"returnBorrower",
	() => selectedLoanNames.value.length,
	[(value) => (draft.value.kind !== "Return" || value ? true : "请选择未结清的原借用记录")],
	() =>
		formRoot.value?.querySelector<HTMLElement>('[data-field="returnBorrower"] input')?.focus(),
);
watch(selectedLoanNames, (names) => {
	loanListOpen.value = names.length === 0;
});
function removeLoan(name: string) {
	draft.value.items = draft.value.items.filter((line) => line.loanName !== name);
	if (!draft.value.items.some((line) => line.loanName)) {
		draft.value.loanName = "";
		draft.value.borrower = "";
		draft.value.activity = "";
	}
}
async function addLoan(name: string) {
	try {
		await c.appendLoan(name);
		loanListOpen.value = false;
	} catch (reason) {
		state.error = reason instanceof Error ? reason.message : "借用读取失败";
	}
}
const editing = computed(
	() => state.status === "conflict" || !state.server || state.server.editable === true,
);
const readOnly = computed(() => !editing.value);
const canOfferPicker = computed(
	() => draft.value.kind !== "Return" && !draft.value.items.some((line) => !!line.loanName),
);
const initialExistingLoad = computed(
	() => loading.value && c.existingDocument.value && !state.server,
);
const hasEditorMenuItems = computed(() =>
	Boolean((state.identity && state.server) || (!loading.value && c.savedExportQuery.value)),
);
const itemCount = computed(() => new Set(draft.value.items.map((line) => line.code)).size);
function stockUnit(line: (typeof draft.value.items)[number]) {
	return String(
		line.nativeFields?.stock_uom ||
			line.uom ||
			c.stock.find((item) => item.code === line.code)?.uom ||
			line.entryUom ||
			"",
	);
}
function unitTotal(unit: string, qty: number) {
	return formatQuantityWithUnit(qty, unit);
}
const totals = computed(() => {
	const values = new Map<string, number>();
	for (const line of draft.value.items) {
		const unit = stockUnit(line);
		values.set(unit, (values.get(unit) || 0) + Number(line.qty || 0));
	}
	return sortByUnit([...values], ([unit]) => unit)
		.map(([unit, qty]) => unitTotal(unit, qty))
		.join(" · ");
});
const locationTotals = computed(() => {
	const groups = new Map<string, typeof draft.value.items>();
	for (const line of draft.value.items) {
		const location = operationSectionLocation(draft.value.kind, line) || "未选择库位";
		if (!groups.has(location)) groups.set(location, []);
		groups.get(location)!.push(line);
	}
	return [...groups.entries()].map(([location, lines]) => {
		const quantities = new Map<string, number>();
		for (const line of lines) {
			const unit = stockUnit(line);
			quantities.set(unit, (quantities.get(unit) || 0) + Number(line.qty || 0));
		}
		const summary = sortByUnit([...quantities], ([unit]) => unit)
			.map(([unit, qty]) => unitTotal(unit, qty))
			.join(" · ");
		return {
			location,
			items: new Set(lines.map((line) => line.code)).size,
			lines: lines.length,
			summary,
		};
	});
});
const lineIssues = computed(() => {
	const grouped = new Map<string, (typeof issues.value)[number][]>();
	for (const issue of issues.value) {
		if (!issue.lineId) continue;
		const list = grouped.get(issue.lineId) || [];
		list.push(issue);
		grouped.set(issue.lineId, list);
	}
	return [...grouped.entries()].map(([lineId, rows]) => ({ lineId, issues: rows }));
});
const lineIssueSummary = computed(() => {
	const labels = new Map<string, Set<string>>();
	const fieldLabels: Record<string, string> = {
		qty: "数量",
		expiry: "效期",
		location: "库位",
		sourceLocation: "库位",
		batch: "批次",
		loanName: "原借出",
		code: "物品",
	};
	for (const group of lineIssues.value) {
		for (const issue of group.issues) {
			const label = fieldLabels[issue.field] || "其他检查";
			const lines = labels.get(label) || new Set<string>();
			lines.add(group.lineId);
			labels.set(label, lines);
		}
	}
	return [...labels.entries()].map(([label, lines]) => `${label} ${lines.size} 行`);
});
async function jumpToFirstIncompleteLine() {
	const issue = lineIssues.value[0]?.issues[0];
	if (issue) await lineEditor.value?.revealIssue(issue);
}
const reviewContext = computed(() => {
	const fields = [
		{
			label: "关联活动",
			value: draft.value.activity ? activityLabel.value : "",
			relevant: true,
		},
		{
			label: draft.value.kind === "Receive" ? "来源" : "用途",
			value: draft.value.kind === "Receive" ? draft.value.source : draft.value.purpose,
			relevant: true,
		},
		{
			label: "借用方",
			value: draft.value.borrower,
			relevant: ["Loan", "Return"].includes(draft.value.kind),
		},
		{ label: "记录人", value: draft.value.recorder, relevant: true },
		{ label: "经手人", value: draft.value.handler, relevant: true },
		{ label: "鉴证人", value: draft.value.reviewer, relevant: true },
	];
	return {
		filled: fields.filter((field) => Boolean(field.value)),
		missing: fields.filter((field) => field.relevant && !field.value),
	};
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
	if (!validation.validate().ok) {
		showError.value = true;
		return;
	}
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
async function back() {
	if (await c.requestLeave()) emit("back");
}
async function reloadDocument() {
	if (
		(dirty.value || supportingDirty.value) &&
		!(await confirmDialog({
			title: "放弃当前输入并重新读取？",
			message: "重新读取会替换当前页面的输入。",
			confirmLabel: "放弃并重新读取",
			cancelLabel: "继续编辑",
			tone: "danger",
		}))
	)
		return;
	await c.load(true);
}
watch(leaveOpen, async (open) => {
	if (!open) return;
	const accepted = await confirmDialog({
		title: "离开当前编辑？",
		message: "未完成输入会保留在此浏览器；待上传文件需要重新选择。",
		confirmLabel: "保留输入并离开",
		cancelLabel: "继续编辑",
	});
	c.finishLeave(accepted ? "retain" : "stay");
});
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
		class="form-page"
		:class="{ 'workspace-expanded': expanded }"
	>
		<PageHeader class="form-page-heading"
			><div>
				<div class="operation-page-title-row">
					<h1 tabindex="-1">
						<InventoryIcon
							class="operation-kind-heading-icon"
							:name="kindIcons[draft.kind].icon"
						/>{{ title }}
					</h1>
					<PopupMenu
						v-if="hasEditorMenuItems"
						class="editor-overflow-menu"
						label="更多操作"
						variant="icon"
						align="end"
					>
						<a
							v-if="state.identity && state.server"
							class="phone-erpnext-link"
							:href="`/app/${state.server.doctype === 'Stock Entry' ? 'stock-entry' : 'stock-reconciliation'}/${encodeURIComponent(state.server.name)}`"
							target="_blank"
							rel="noopener"
							>在 ERPNext 查看</a
						>
						<QuickExport
							v-if="!loading && c.savedExportQuery.value"
							:query="c.savedExportQuery.value"
							title="货物流动单据"
							:active="active"
						/><UiButton
							v-if="state.identity && state.server?.docstatus === 0"
							icon="disposal"
							:disabled="!writable || busy"
							@click="action = 'delete'"
							>删除草稿单据</UiButton
						>
					</PopupMenu>
				</div>
				<p class="muted">{{ subtitles[draft.kind] }}</p>
			</div>
			<template #back><BackButton @click="back" /></template>
		</PageHeader>
		<DocumentLoadingState
			v-if="initialExistingLoad"
			label="库存单据加载中…"
			:announce="false"
		/>
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
				>{{ statusLabels[state.status] }}</span
			><span v-if="loading && state.server" class="sr-only" role="status">正在刷新…</span
			><NativeStatusBadge
				v-if="state.server && state.server.docstatus !== 0"
				:status="state.server.docstatus"
			/><UiButton
				v-if="
					state.identity &&
					!busy &&
					(state.server?.docstatus === 0 || state.status === 'conflict')
				"
				@click="reloadDocument"
				>重新读取</UiButton
			>
		</div>
		<p v-if="state.error" class="notice-bar danger" role="alert">
			{{ state.error }}
			<UiButton v-if="c.existingDocument.value && !state.server" @click="reloadDocument"
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
				class="desk-link"
				:href="`/app/${state.server.doctype === 'Stock Entry' ? 'stock-entry' : 'stock-reconciliation'}/${encodeURIComponent(state.server.name)}`"
				target="_blank"
				rel="noopener"
				>在 ERPNext 查看</a
			><UiButton v-if="state.server.docstatus === 1" @click="action = 'cancel'"
				>取消记录</UiButton
			><UiButton v-if="state.server.docstatus === 2" @click="action = 'amend'"
				>创建修订草稿</UiButton
			><UiButton
				v-if="state.server.doctype === 'Stock Entry' && state.server.docstatus !== 0"
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
						<template v-if="draft.timeMode === 'current'">
							<p class="muted current-time-note">
								确认时自动记录当前时间。
								<UiButton variant="ghost" @click="draft.timeMode = 'manual'"
									>指定时间</UiButton
								>
							</p>
						</template>
						<template v-else>
							<label class="form-field"
								>操作日期<input
									v-model="draft.postingDate"
									data-field="postingDate"
									type="date"
									:aria-invalid="
										showError &&
										issues.some((issue) => issue.field === 'postingDate')
									"
									:disabled="!writable || busy"
							/></label>
							<label class="form-field"
								>时间方式<select
									v-model="draft.timeMode"
									:disabled="!writable || busy"
								>
									<option value="current">确认时的当前时间</option>
									<option value="manual">指定历史时间</option>
								</select></label
							>
							<label class="form-field"
								>操作时间<input
									v-model="draft.postingTime"
									data-field="postingTime"
									type="time"
									step="1"
									:aria-invalid="
										showError &&
										issues.some((issue) => issue.field === 'postingTime')
									"
									:disabled="!writable || busy"
							/></label>
							<p class="muted">可用数量按指定日期和时间核对。</p>
						</template>
					</section>
					<section
						v-if="draft.kind === 'Loan' || draft.kind === 'Return' || draft.loanName"
						class="form-section"
					>
						<h2>{{ draft.kind === "Loan" ? "借用对象" : "归还来源" }}</h2>
						<div class="form-fields">
							<template v-if="draft.kind === 'Loan'">
								<FormField
									label="借用方"
									hint="可填个人或团体"
									required
									:error="validation.errors.borrower"
								>
									<template #default="{ fieldAttrs }">
										<input
											v-model="draft.borrower"
											v-bind="fieldAttrs"
											list="recent-borrowers"
											data-field="borrower"
											:disabled="!writable || busy"
										/>
									</template>
								</FormField>
								<datalist id="recent-borrowers">
									<option
										v-for="borrower in borrowerSuggestions"
										:key="borrower"
										:value="borrower"
									/>
								</datalist>
							</template>
							<template v-else>
								<div
									v-if="selectedLoanNames.length"
									class="selected-loan-chips"
									aria-label="已加入的借用"
								>
									<button
										v-for="name in selectedLoanNames"
										:key="name"
										type="button"
										class="record-ref-chip"
										@click="removeLoan(name)"
									>
										{{
											borrowerGroups
												.flatMap(
													(group) =>
														groupLoans[group.borrower]?.rows || [],
												)
												.find((loan) => loan.name === name)?.borrower ||
											draft.borrower
										}}
										· {{ name }} <span aria-hidden="true">×</span>
									</button>
								</div>
								<UiButton
									v-if="selectedLoanNames.length"
									variant="secondary"
									@click="loanListOpen = !loanListOpen"
									>{{ loanListOpen ? "收起借用列表" : "添加更多借用" }}</UiButton
								>
								<div v-if="loanListOpen" class="outstanding-loan-browser">
									<FormField
										data-field="returnBorrower"
										class="form-field loan-search"
										label="未结清借用方"
										:required="draft.kind === 'Return'"
										:error="validation.errors.returnBorrower"
									>
										<template #default="{ fieldAttrs }">
											<input
												v-model="loanSearch"
												v-bind="fieldAttrs"
												type="search"
												placeholder="借用方、单号或活动"
												@input="scheduleBorrowerSearch"
											/>
										</template>
									</FormField>
									<div class="outstanding-loan-scroll">
										<div
											v-for="group in borrowerGroups"
											:key="group.borrower"
											class="outstanding-borrower-group"
										>
											<button
												type="button"
												class="outstanding-borrower-toggle"
												@click="toggleBorrower(group)"
											>
												<span>{{ group.borrower || "未填写借用方" }}</span>
												<small
													>{{ group.loan_count }} 笔 ·
													{{ group.item_count }} 项 · 最近
													{{ group.latest_date }}</small
												>
												<InventoryIcon
													:name="
														expandedBorrower === group.borrower
															? 'chevron-down'
															: 'chevron-right'
													"
												/>
											</button>
											<template v-if="expandedBorrower === group.borrower">
												<article
													v-for="loan in groupLoans[group.borrower]
														?.rows || []"
													:key="loan.name"
													class="outstanding-loan-card"
												>
													<div class="outstanding-loan-heading">
														<a
															:href="`/inventory/movements/${encodeURIComponent(loan.name)}`"
															>{{ loan.name }}</a
														><UiButton
															:disabled="
																!writable ||
																busy ||
																selectedLoanNames.includes(
																	loan.name,
																)
															"
															@click="addLoan(loan.name)"
															>加入</UiButton
														>
													</div>
													<dl class="outstanding-loan-fields">
														<div>
															<dt>借出日期</dt>
															<dd>{{ loan.date }}</dd>
														</div>
														<div>
															<dt>活动</dt>
															<dd>
																{{ loan.activity || "未关联活动" }}
															</dd>
														</div>
														<div>
															<dt>未结清</dt>
															<dd>
																{{
																	loan.items
																		.map(
																			(item) =>
																				`${item.quantity} ${unitLabel(item.uom)}`,
																		)
																		.join(" · ")
																}}
															</dd>
														</div>
													</dl>
													<div class="outstanding-loan-items">
														<div
															v-for="item in loan.items"
															:key="item.code"
														>
															<img
																v-if="item.image"
																:src="item.image"
																alt=""
															/><span
																v-else
																class="outstanding-loan-thumbnail-placeholder"
																><InventoryIcon name="box" /></span
															><span
																>{{ item.name }} ·
																{{ item.quantity }}
																{{ unitLabel(item.uom) }}</span
															>
														</div>
													</div>
												</article>
												<p
													v-if="groupLoans[group.borrower]?.loading"
													class="muted"
												>
													正在加载借用…
												</p>
												<UiButton
													v-if="
														groupLoans[group.borrower]?.next !== null
													"
													:disabled="groupLoans[group.borrower]?.loading"
													@click="loadBorrowerLoans(group, true)"
													>加载更多</UiButton
												>
											</template>
										</div>
										<UiButton
											v-if="borrowerGroupsNext !== null"
											:disabled="outstandingLoading"
											@click="loadOutstandingLoanGroups(true)"
											>加载更多借用方</UiButton
										>
									</div>
									<p v-if="outstandingLoading" class="muted" role="status">
										正在加载未结清借用…
									</p>
									<p
										v-else-if="!state.error && !borrowerGroups.length"
										class="muted"
									>
										{{
											loanSearch
												? "没有匹配的未结清借用。"
												: "当前没有未结清借用。"
										}}
									</p>
									<p class="muted">
										可加入同一借用方和活动的多笔借用；遗失使用单独操作。
									</p>
								</div>
							</template>
						</div>
					</section>
				</template>
				<dl v-else class="info-grid form-section">
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
				</dl>
				<p v-if="draft.amendedFrom" class="content-long-text">
					修订来源：{{ draft.amendedFrom }}
				</p>
				<section class="form-section operation-section">
					<div class="operation-heading-row">
						<h2>操作物资</h2>
						<UiButton
							class="full-workspace-action"
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
								? "登记每项物资的数量、批次与存放位置。"
								: "核对物品数量及本次操作涉及的位置。"
						}}
					</p>
					<OperationLines
						ref="lineEditor"
						:draft="draft"
						:mode="editing ? 'edit' : 'display'"
						:disabled="!writable || busy"
						:show-error="showError"
						:hydrating="hydrating"
						:active="active"
						@expand="toggle"
					/>
				</section>
				<DisclosureSection
					v-model:open="supplementOpen"
					title="补充记录"
					summary="活动、人员、备注与附件"
				>
					<div class="form-grid">
						<TransactionContext
							:draft="draft"
							:activity-label="activityLabel"
							:disabled="!writable || busy"
							:mode="editing ? 'edit' : 'display'"
							@dirty-change="supportingDirty = $event"
						/><FormField v-if="editing" class="full-width" label="备注">
							<template #default="{ fieldAttrs }">
								<textarea
									v-model="draft.note"
									v-bind="fieldAttrs"
									rows="3"
									:disabled="!writable || busy"
								/>
							</template>
						</FormField>
						<div v-else class="content-long-text">{{ draft.note }}</div>
					</div>
					<div class="attachment-area">
						<h3>附件</h3>
						<Attachments
							:controller="files"
							:disabled="(!writable && state.server?.docstatus !== 1) || busy"
							:mode="editing || state.server?.docstatus === 1 ? 'edit' : 'display'"
						/>
					</div>
					<fieldset v-if="editing" class="people-fields" :disabled="!writable || busy">
						<legend>现场人员</legend>
						<div class="form-grid">
							<FormField label="记录人">
								<template #default="{ fieldAttrs }">
									<input v-model="draft.recorder" v-bind="fieldAttrs" />
								</template>
							</FormField>
							<FormField label="经手人">
								<template #default="{ fieldAttrs }">
									<input v-model="draft.handler" v-bind="fieldAttrs" />
								</template>
							</FormField>
							<FormField label="鉴证人">
								<template #default="{ fieldAttrs }">
									<input v-model="draft.reviewer" v-bind="fieldAttrs" />
								</template>
							</FormField>
						</div>
					</fieldset>
					<dl v-else class="info-grid">
						<div
							v-for="(value, label) in {
								记录人: draft.recorder,
								经手人: draft.handler,
								鉴证人: draft.reviewer,
							}"
							:key="label"
						>
							<dt>{{ label }}</dt>
							<dd>
								<RouterLink
									v-if="value && personRole(label)"
									:to="personDestination(String(value), personRole(label)!)"
									>{{ value }}</RouterLink
								><span v-else>{{ value || "未填写" }}</span>
							</dd>
						</div>
					</dl>
				</DisclosureSection>
				<div v-if="showError && issues.length" role="alert" class="notice-bar warning">
					<p v-for="issue in issues.filter((row) => !row.lineId)" :key="issue.field">
						{{ issue.message }}
					</p>
					<p>{{ issues.length }} 处待完善，输入已保留。</p>
				</div>
				<p
					v-if="isMobile && (writable || state.confirmationVersion)"
					class="muted editor-action-helper"
				>
					复核并确认后才变更库存。
				</p>
				<div
					v-if="writable || state.confirmationVersion"
					ref="reviewBar"
					class="form-actions document-actions"
					:class="{ 'is-keyboard-open': keyboardOpen }"
				>
					<p class="muted">{{ draft.items.length }} 行</p>
					<UiButton
						v-if="isMobile && canOfferPicker && writable && !state.confirmationVersion"
						variant="secondary"
						icon="box"
						:disabled="busy || !lineEditor?.itemPickerReady()"
						@click="lineEditor?.openPicker()"
						>添加物品</UiButton
					>
					<UiButton
						v-if="!state.confirmationVersion"
						:disabled="busy || supportingDirty"
						@click="saveDraft"
						>保存草稿</UiButton
					><UiButton
						v-if="!state.confirmationVersion && c.canSubmit.value"
						variant="primary"
						type="submit"
						data-review-action
						:title="reviewShortcutTitle"
						:disabled="busy || supportingDirty"
						:loading="busy"
						>复核并确认</UiButton
					><UiButton
						v-else-if="state.confirmationVersion"
						variant="primary"
						:loading="busy"
						@click="confirm"
						>检查上次确认结果</UiButton
					>
					<small v-if="!isMobile" class="muted">复核并确认后才变更库存。</small>
				</div>
			</div>
			<aside
				id="operation-review-panel"
				class="form-review surface"
				:class="{ 'form-review--empty': !draft.items.length }"
			>
				<p v-if="!draft.items.length" class="review-empty-summary">尚未添加物品</p>
				<button
					v-if="isDesktop && !expanded"
					type="button"
					class="form-review-edge-rail"
					:aria-expanded="!previewCollapsed"
					aria-controls="operation-review-content"
					:aria-label="previewCollapsed ? '展开确认前检查' : '收起确认前检查到边缘'"
					@click="previewCollapsed = !previewCollapsed"
				>
					<InventoryIcon :name="previewCollapsed ? 'chevron-left' : 'chevron-right'" />
					<span v-if="previewCollapsed" class="form-review-edge-rail-label"
						>确认前检查</span
					>
				</button>
				<details
					class="review-disclosure"
					:open="isDesktop || mobileReviewOpen"
					@toggle="mobileReviewOpen = ($event.currentTarget as HTMLDetailsElement).open"
				>
					<summary
						:id="draft.items.length ? undefined : 'operation-review-content'"
						class="review-summary ti-disclosure"
						aria-label="展开或收起确认前检查摘要"
						:aria-hidden="previewCollapsed ? 'true' : undefined"
					>
						<DisclosureIcon variant="inline" />
						<template v-if="draft.items.length"
							>{{ readOnly ? "操作汇总" : "确认前检查" }} · {{ totals }} ·
							{{ itemCount }} 种物品</template
						>
						<template v-else>尚未添加物品</template>
					</summary>
					<div
						v-if="draft.items.length"
						id="operation-review-content"
						class="review-content"
						:aria-hidden="previewCollapsed ? 'true' : undefined"
						:inert="previewCollapsed || undefined"
					>
						<span v-if="!readOnly" class="eyebrow">确认前检查</span>
						<h2>操作汇总</h2>
						<div class="review-metric">
							<strong>{{ totals || "尚未添加物品" }}</strong
							><span>各单位分别合计</span>
						</div>
						<p class="review-scope">
							{{ itemCount }} 种物品 · {{ draft.items.length }} 条明细
						</p>
						<ul class="review-location-totals">
							<li v-for="group in locationTotals" :key="group.location">
								<strong>{{
									warehouseLabel(group.location, reference.warehouses)
								}}</strong>
								<span>{{ group.items }} 种物品 · {{ group.lines }} 条明细</span>
								<span>{{ group.summary || "暂无数量" }}</span>
							</li>
						</ul>
						<div v-if="!readOnly" class="review-line-checks">
							<div class="review-line-checks-heading">
								<strong>{{ lineIssues.length }} 行待完善</strong>
								<UiButton
									v-if="lineIssues.length"
									variant="ghost"
									size="compact"
									@click="jumpToFirstIncompleteLine"
									>定位首行</UiButton
								>
							</div>
							<p v-if="lineIssueSummary.length" class="muted">
								{{ lineIssueSummary.join(" · ") }}
							</p>
							<p v-else class="muted">明细检查通过</p>
						</div>
						<p v-if="draft.kind === 'Loan'">
							借用方：{{ draft.borrower || "待填写" }}
						</p>
						<p v-if="draft.activity">活动：{{ activityLabel }}</p>
						<p v-if="draft.postingDate">日期：{{ draft.postingDate }}</p>
						<p v-if="!readOnly" class="muted">
							确认前请核对物品、数量和库位。复核并确认后才变更库存。
						</p>
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
			<AllocationSummary :draft="draft" />
			<dl v-if="reviewContext.filled.length" class="info-grid">
				<div v-for="field in reviewContext.filled" :key="field.label">
					<dt>{{ field.label }}</dt>
					<dd>{{ field.value }}</dd>
				</div>
			</dl>
			<p v-if="reviewContext.missing.length" class="muted">
				未填写：{{ reviewContext.missing.map((field) => field.label).join("、") }}
			</p>
			<div class="content-long-text">{{ draft.note }}</div>
			<p>{{ files.files.length }} 份附件。确认后此记录及附件不可直接修改。</p>
			<p v-if="state.error" class="notice-bar danger" role="alert">{{ state.error }}</p>
			<template #footer
				><UiButton :disabled="busy" @click="reviewOpen = false">返回检查</UiButton
				><UiButton variant="primary" :loading="busy" @click="confirm"
					>确认提交</UiButton
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
				><UiButton
					:variant="action === 'duplicate' ? 'primary' : 'danger'"
					:loading="busy"
					@click="lifecycle"
					>确认</UiButton
				></template
			></Overlay
		>
	</section>
</template>

<style scoped>
:deep(.app-page-identity) {
	align-items: flex-start;
}

:deep(.app-page-identity > .back-button) {
	margin-top: 4px;
}

:deep(.review-summary) {
	min-height: 48px;
	padding: var(--p-space-2) var(--p-space-3);
	font-size: var(--p-body);
}

.review-location-totals {
	display: grid;
	gap: var(--p-space-2);
	margin: 0;
	padding: 0;
	list-style: none;
}

.review-location-totals li {
	display: grid;
	gap: 2px;
	min-width: 0;
	padding-block: var(--p-space-2);
	border-bottom: 1px solid var(--p-border);
}

.review-location-totals li > span {
	color: var(--p-muted);
	font-size: var(--p-small);
}

.review-line-checks {
	margin-block-start: var(--p-space-3);
	padding-block-start: var(--p-space-2);
	border-top: 1px solid var(--p-border);
}

.review-line-checks-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--p-space-2);
}

.review-line-checks > p {
	margin: var(--p-space-1) 0 0;
}

@media (max-width: 1023px) {
	.document-actions {
		left: calc(var(--operation-visual-left, 0px) + 12px);
		right: auto;
		width: calc(var(--operation-visual-width, 100vw) - 24px);
		max-width: calc(var(--operation-visual-width, 100vw) - 24px);
		top: calc(
			var(--operation-visual-top, 0px) + var(--operation-visual-height, 100dvh) - 66px
		);
		bottom: auto;
		box-sizing: border-box;
	}

	.document-actions.is-keyboard-open {
		display: none !important;
	}

	.document-actions {
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		padding-bottom: max(6px, env(safe-area-inset-bottom));
	}

	.document-actions > .ui-button {
		min-height: 44px;
	}

	:deep(.review-summary) {
		min-height: 52px;
		font-size: var(--p-body);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
}
</style>
