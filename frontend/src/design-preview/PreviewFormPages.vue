<script setup lang="ts">
import { computed, ref, watch, onActivated, onDeactivated } from "vue";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import {
	createDraft,
	findDraft,
	reviewSession,
	submitDraft,
	updateDraft,
	type DraftKind,
	type OperationKind,
	type ReviewDraft,
} from "./reviewModel";
import PreviewCategoryField from "./components/PreviewCategoryField.vue";
import PreviewSearchSelect from "./components/PreviewSearchSelect.vue";
import PreviewCountWorkspace from "./components/PreviewCountWorkspace.vue";
import PreviewAttachments from "./components/PreviewAttachments.vue";
import PreviewTransactionContext from "./components/PreviewTransactionContext.vue";
import PreviewDocumentState from "./components/PreviewDocumentState.vue";
import { addLoanToDraft } from "./workflowModel";
import PreviewOperationLines from "./components/PreviewOperationLines.vue";
import PreviewUnitField from "./components/PreviewUnitField.vue";
import { validateOperation, isSettlement } from "./formModel";

const props = withDefaults(defineProps<{ page: string; variant: string; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
}>();
const movementKinds: OperationKind[] = [
	"Receive",
	"Issue",
	"Transfer",
	"Loan",
	"Return",
	"Damage",
	"Loss",
	"Repair",
	"Disposal",
];
const labelMap: Record<string, string> = {
	Receive: "入库",
	Issue: "出库",
	Transfer: "转移",
	Loan: "借出",
	Return: "归还",
	Damage: "标记损坏",
	Loss: "记录遗失",
	Repair: "修复归库",
	Disposal: "正式报废",
};
const draft = ref<ReviewDraft>();
const unavailableDraft = ref("");
const showError = ref(false);
const saveFailed = ref(false);
const documentBlocked = ref(false);
const loanChoice = ref("");
const saveState = ref("");
const showConfirm = ref(false);
const operationError = ref("");
const discardOpen = ref(false);
let itemEditBaseline = "";
function cancelItemEdit() {
	if (!draft.value) return;
	if (JSON.stringify(draft.value) !== itemEditBaseline) {
		discardOpen.value = true;
		return;
	}
	discardItemEdit();
}
function discardItemEdit() {
	if (!draft.value) return;
	const code = draft.value.itemCode;
	const index = reviewSession.drafts.indexOf(draft.value);
	if (index >= 0) reviewSession.drafts.splice(index, 1);
	discardOpen.value = false;
	if (props.variant === "edit") {
		reviewSession.selectedItemCode = code || "";
		emit("navigate", "item-detail", "overview");
	} else emit("navigate", "inventory", "list");
}

const itemCodeCollision = computed(
	() =>
		isItem.value &&
		props.variant === "new" &&
		reviewSession.stock.some((row) => row.code === draft.value?.itemCode),
);
const pageTitle = computed(() =>
	props.page === "item-form"
		? props.variant === "edit"
			? "编辑物品"
			: "新建物品"
		: props.page === "reconciliation-form"
			? props.variant === "detail"
				? "盘点记录"
				: "新建盘点"
			: `${labelMap[props.variant] || props.variant}登记`,
);
const kind = computed<DraftKind>(() =>
	props.page === "item-form"
		? "Item"
		: props.page === "reconciliation-form"
			? "Reconcile"
			: movementKinds.includes(props.variant as OperationKind)
				? (props.variant as OperationKind)
				: "Receive",
);
const isItem = computed(() => kind.value === "Item");
const isReconcile = computed(() => kind.value === "Reconcile");
const isReadOnly = computed(
	() => documentBlocked.value || (!!draft.value && draft.value.status !== "draft"),
);
const totalsByUom = computed(() => {
	const totals = new Map<string, number>();
	for (const line of draft.value?.lines || [])
		totals.set(line.uom, (totals.get(line.uom) || 0) + (Number(line.qty) || 0));
	return [...totals.entries()];
});
const item = (code: string) => reviewSession.stock.find((row) => row.code === code);
const returnLoans = computed(() =>
	reviewSession.loans.filter(
		(loan) =>
			loan.status === "outstanding" &&
			loan.lines.some((line) => line.qty > line.returned + line.damaged + line.lost),
	),
);
function appendLoan() {
	if (!draft.value) return;
	operationError.value = addLoanToDraft(draft.value, loanChoice.value);
	if (operationError.value) showError.value = true;
	else loanChoice.value = "";
}
function validOperation() {
	if (!draft.value) return false;
	operationError.value = draft.value.files?.some((file) => file.state === "uploading")
		? "附件仍在上传，请完成后再保存物品。"
		: draft.value.files?.some((file) => file.state === "error")
			? "附件上传失败，请重试或移除后再保存物品。"
			: "";
	if (isItem.value && operationError.value) return false;
	if (isItem.value)
		return (
			!!draft.value.itemName?.trim() &&
			!!draft.value.itemCode?.trim() &&
			!!draft.value.uom &&
			!itemCodeCollision.value
		);
	operationError.value = validateOperation(draft.value);
	return !operationError.value;
}
const groupedLines = computed(() => {
	const groups = new Map<string, NonNullable<typeof draft.value>["lines"]>();
	for (const line of draft.value?.lines || []) {
		const key =
			(["Issue", "Loss", "Disposal", "Damage", "Loan", "Transfer", "Repair"].includes(
				kind.value,
			)
				? line.sourceLocation || line.location
				: line.location) || "未选择库位";
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key)!.push(line);
	}
	return [...groups.entries()];
});
function initialize() {
	unavailableDraft.value = "";
	documentBlocked.value = false;
	saveState.value = "";
	saveFailed.value = false;
	const selectedName = reviewSession.selectedDraftName;
	const selected = selectedName ? findDraft(kind.value, selectedName) : undefined;
	if (
		(selectedName && !selected) ||
		(isItem.value && props.variant === "edit" && !item(reviewSession.selectedItemCode))
	) {
		unavailableDraft.value = selectedName || reviewSession.selectedItemCode;
		draft.value = undefined;
		reviewSession.selectedDraftName = "";
		return;
	}
	if (selected) {
		draft.value = selected;
		reviewSession.selectedDraftName = "";
	}
	const name =
		props.page === "reconciliation-form" && props.variant === "detail"
			? "MAT-RECO-2026-00015"
			: props.page === "item-form" && props.variant === "edit"
				? `PREV-ITEM-EDIT-${reviewSession.selectedItemCode}`
				: props.page === "item-form"
					? "PREV-ITEM-NEW-001"
					: undefined;
	if (
		!selected &&
		isReconcile.value &&
		props.variant === "detail" &&
		!findDraft(kind.value, name)
	) {
		unavailableDraft.value = name || "盘点记录";
		draft.value = undefined;
		return;
	}
	if (!selected && name)
		draft.value = findDraft(kind.value, name) || createDraft(kind.value, name);
	else if (!selected) {
		if (isReconcile.value && props.variant === "new") {
			let sequence = reviewSession.drafts.length + 200;
			let name = `MAT-RECO-2026-${String(sequence).padStart(5, "0")}`;
			while (reviewSession.drafts.some((row) => row.name === name))
				name = `MAT-RECO-2026-${String(++sequence).padStart(5, "0")}`;
			draft.value = createDraft("Reconcile", name);
		} else draft.value = createDraft(kind.value);
	}
	if (isItem.value && draft.value?.status !== "draft")
		draft.value = createDraft("Item", `${name}-${Date.now()}`);
	if (isItem.value && props.variant === "edit" && draft.value && !draft.value.itemCode) {
		const current = item(reviewSession.selectedItemCode);
		if (current)
			Object.assign(draft.value, {
				itemCode: current.code,
				itemName: current.name,
				category: current.category,
				barcode: current.barcode,
				description: current.description,
				images: [...(current.images || [])],
				files: current.files?.map((file) => ({ ...file })),
				uom: current.uom,
				tracksBatch: current.tracksBatch,
				tracksExpiry: current.tracksExpiry,
			});
	}
	if (isItem.value && draft.value) draft.value.uom ||= "Nos";
	if (isItem.value && draft.value?.itemCode) {
		const currentItem = item(draft.value.itemCode);
		if (currentItem) {
			draft.value.tracksBatch ??= currentItem.tracksBatch;
			draft.value.tracksExpiry ??= currentItem.tracksExpiry;
		}
	}
	if (isItem.value && props.variant === "new" && !draft.value?.itemCode)
		draft.value!.itemCode = `ITM-${String(Math.max(133, ...reviewSession.stock.map((item) => Number(item.code.match(/^ITM-(\d+)$/)?.[1]) || 0)) + 1).padStart(6, "0")}`;
	if (draft.value?.kind === "Return" && draft.value.lines.length)
		draft.value.lines.forEach((line) => (line.returnOutcome ??= "returned"));

	reviewSession.selectedDraftName = "";
	showError.value = false;
	if (isItem.value) itemEditBaseline = JSON.stringify(draft.value);
}
watch(() => [props.page, props.variant], initialize, { immediate: true });
onActivated(() => {
	if (
		reviewSession.selectedDraftName ||
		(isItem.value && isReadOnly.value) ||
		(isReconcile.value && props.variant === "new" && draft.value?.status !== "draft") ||
		(draft.value && !reviewSession.drafts.includes(draft.value)) ||
		(isItem.value &&
			props.variant === "edit" &&
			draft.value?.itemCode !== reviewSession.selectedItemCode)
	)
		initialize();
});
onDeactivated(() => {
	showConfirm.value = false;
	discardOpen.value = false;
});
watch(
	() => props.active,
	(active) => {
		if (!active) showConfirm.value = false;
	},
);
function saveDraft() {
	if (!draft.value || isReadOnly.value) return;
	showError.value = false;
	if (isItem.value && !validOperation()) {
		showError.value = true;
		return;
	}
	if (itemCodeCollision.value && isItem.value && props.variant === "new") {
		showError.value = true;
		return;
	}
	saveFailed.value = false;
	saveState.value = "草稿已保存";
	draft.value.saved = true;
	draft.value.version = (draft.value.version || 1) + 1;
	updateDraft(kind.value, draft.value, draft.value.name);
	emit("notify", "草稿已保存，输入内容已保留");
}
function simulateSaveFailure() {
	saveFailed.value = true;
	saveState.value = "保存失败，输入已保留";
	showError.value = true;
}
function confirmSubmit() {
	if (!draft.value || isReadOnly.value) return;
	if (!validOperation()) {
		showError.value = true;
		showConfirm.value = false;
		return;
	}
	showError.value = false;
	if (isItem.value) {
		const current = reviewSession.stock.find((row) => row.code === draft.value!.itemCode);
		if (current) {
			current.name = draft.value.itemName || current.name;
			current.category = draft.value.category || current.category;
			current.uom = draft.value.uom || current.uom;
			Object.assign(current, {
				tracksBatch: !!draft.value.tracksBatch || !!draft.value.tracksExpiry,
				barcode: draft.value.barcode,
				description: draft.value.description,
				images: draft.value.images,
				files: draft.value.files,
				tracksExpiry: !!draft.value.tracksExpiry,
			});
		} else if (draft.value.itemCode && draft.value.itemName)
			reviewSession.stock.push({
				code: draft.value.itemCode,
				name: draft.value.itemName,
				category: draft.value.category || "日用品",
				uom: draft.value.uom || "Nos",
				tracksBatch: !!draft.value.tracksBatch || !!draft.value.tracksExpiry,
				barcode: draft.value.barcode,
				description: draft.value.description,
				images: draft.value.images,
				files: draft.value.files,
				tracksExpiry: !!draft.value.tracksExpiry,
				locations: [],
				available: 0,
				loaned: 0,
				damaged: 0,
				illustration: "none",
			});
	}
	const result = submitDraft(kind.value, draft.value.name);
	showConfirm.value = false;
	if (!result) {
		operationError.value = "处理数量超过未结清数量，输入已保留。";
		showError.value = true;
		return;
	}
	if (result)
		emit(
			"notify",
			isItem.value
				? "物品资料已在预览中保存"
				: "模拟确认完成；库存为固定样本快照，不执行库存扣增。",
		);
	if (result && isItem.value) {
		reviewSession.selectedItemCode = draft.value.itemCode || "";
		emit("navigate", "item-detail", "overview");
	}
}
</script>

<template>
	<section class="preview-form-page">
		<div class="form-page-heading">
			<div>
				<span class="eyebrow">WORKFLOW PROPOSAL · PREVIEW DATA</span>
				<h1>{{ pageTitle }}</h1>
				<p class="muted">这是完整操作流程的布局提案，所有保存与确认仅修改本地样本。</p>
			</div>
			<span class="form-record-tag"
				>{{ draft?.saved === false ? "未保存" : draft?.name || "新建草稿" }} ·
				{{
					draft?.status === "completed"
						? "已提交"
						: draft?.status === "cancelled"
							? "已取消"
							: documentBlocked
								? "编辑已暂停"
								: "草稿"
				}}</span
			>
		</div>
		<PreviewDocumentState
			v-if="draft && !isItem"
			:draft="draft"
			@blocked="documentBlocked = $event"
			@amend="draft = $event"
		/>
		<p v-if="unavailableDraft" role="alert">
			{{ unavailableDraft }} 记录不可用，请返回列表。当前页面不会替换为其他记录。
		</p>
		<div v-if="draft" class="form-layout">
			<form class="form-main surface" @submit.prevent="saveDraft">
				<div v-if="!isItem" class="form-section form-date-section">
					<label
						>操作日期<input
							v-model="draft!.postingDate"
							type="date"
							:disabled="isReadOnly"
					/></label>
					<label
						>时间方式<select v-model="draft!.timeMode" :disabled="isReadOnly">
							<option value="current">确认时的当前时间</option>
							<option value="manual">指定历史时间</option>
						</select></label
					>
					<label v-if="draft?.timeMode === 'manual'"
						>操作时间<input
							type="time"
							v-model="draft!.postingTime"
							:disabled="isReadOnly"
					/></label>
					<p v-if="draft?.timeMode === 'manual'" class="muted">
						可用数量按指定日期和时间核对；本页展示固定样本。
					</p>
				</div>
				<template v-if="isItem">
					<section class="form-section">
						<div class="section-title-row">
							<h2>物品资料</h2>
							<PreviewUiButton v-if="!isReadOnly" @click="cancelItemEdit"
								>取消编辑</PreviewUiButton
							>
						</div>
						<div class="form-fields">
							<label
								>物品编号<input
									:readonly="variant === 'edit'"
									v-model="draft!.itemCode"
									:aria-invalid="
										showError && (!draft?.itemCode || itemCodeCollision)
									"
									placeholder="例如 ITM-000134"
									:disabled="isReadOnly"
							/></label>
							<label
								>物品名称<input
									v-model="draft!.itemName"
									:aria-invalid="showError && !draft?.itemName?.trim()"
									placeholder="填写清晰易识别的名称"
									:disabled="isReadOnly"
							/></label>
							<PreviewCategoryField
								v-model="draft!.category"
								:disabled="isReadOnly"
							/>
							<PreviewUnitField
								v-model="draft!.uom"
								:disabled="isReadOnly || variant === 'edit'"
							/>
							<label
								>条码（每行一个，可选）<textarea
									v-model="draft!.barcode"
									placeholder="可扫描或手动填写"
									:disabled="isReadOnly"
								/></label
							><label
								>物品说明（可选）<input
									v-model="draft!.description"
									placeholder="补充识别信息"
									:disabled="isReadOnly"
							/></label>
						</div>
						<div class="form-check-row">
							<label
								><input
									v-model="draft!.tracksBatch"
									type="checkbox"
									:disabled="
										isReadOnly || variant === 'edit' || draft!.tracksExpiry
									"
								/>按批次管理</label
							><label
								><input
									v-model="draft!.tracksExpiry"
									type="checkbox"
									:disabled="isReadOnly || variant === 'edit'"
								/>记录效期</label
							>
						</div>
					</section>
					<section class="form-section">
						<h2>物品图片</h2>
						<PreviewAttachments
							v-model="draft!.files"
							images-only
							:disabled="isReadOnly"
						/>
					</section>
				</template>
				<template v-else>
					<section
						v-if="
							kind === 'Loan' || kind === 'Return' || (draft && isSettlement(draft))
						"
						class="form-section"
					>
						<h2>{{ kind === "Loan" ? "借用对象" : "归还来源" }}</h2>
						<div class="form-fields">
							<label v-if="kind === 'Loan'"
								>借用人 / 团体<input
									v-model="draft!.borrower"
									:disabled="isReadOnly"
							/></label>
							<template v-else
								><PreviewSearchSelect
									label="关联借用记录"
									v-model="loanChoice"
									:options="
										returnLoans.map((loan) => ({
											value: loan.name,
											label: `${loan.borrower} · ${loan.name}`,
											detail: loan.activity,
										}))
									"
									:disabled="isReadOnly"
								/><PreviewUiButton
									:disabled="isReadOnly || !loanChoice"
									@click="appendLoan"
									>加入此借用</PreviewUiButton
								>
								<p>
									{{ draft?.borrower }} · {{ draft?.activity
									}}<br />可加入同一借用方和活动的多笔借用；遗失使用单独操作。
								</p></template
							>
						</div>
					</section>
					<section class="form-section">
						<h2>{{ isReconcile ? "盘点物资" : "操作物资" }}</h2>
						<p class="muted">
							{{
								kind === "Receive"
									? "按库位 → 物品 → 批次分配填写，数量由分配合计。"
									: "核对库位、现有批次与可处理数量。"
							}}
						</p>
						<PreviewCountWorkspace
							v-if="isReconcile"
							:draft="draft!"
							:disabled="isReadOnly"
						/>
						<PreviewOperationLines
							v-else
							:draft="draft!"
							:disabled="isReadOnly"
							:show-error="showError"
							@notify="emit('notify', $event)"
						/>
					</section>
					<details class="form-section">
						<summary>补充记录（可选）</summary>
						<PreviewTransactionContext :draft="draft!" :disabled="isReadOnly" />
						<PreviewSearchSelect
							v-if="kind === 'Receive'"
							label="来源类型"
							v-model="draft!.sourceType"
							:options="['捐赠', '采购', '其他']"
							:disabled="isReadOnly"
						/><label v-if="kind === 'Receive'"
							>捐赠人 / 来源<input v-model="draft!.source" :disabled="isReadOnly"
						/></label>
						<PreviewAttachments v-model="draft!.files" :disabled="isReadOnly" />
						<div class="form-fields">
							<label
								>记录人<input
									v-model="draft!.recorder"
									placeholder="可选"
									:disabled="isReadOnly" /></label
							><label
								>经手人<input
									v-model="draft!.handler"
									placeholder="可选"
									:disabled="isReadOnly" /></label
							><label
								>鉴证人<input
									v-model="draft!.reviewer"
									placeholder="可选"
									:disabled="isReadOnly" /></label
							><label class="full-field"
								>备注<textarea
									v-model="draft!.note"
									rows="3"
									placeholder="可选"
									:disabled="isReadOnly"
								/>
							</label>
						</div>
					</details>
				</template>
				<p v-if="showError" class="form-error" role="alert">
					{{
						saveFailed
							? "模拟保存失败，输入内容已保留，可重试。"
							: itemCodeCollision
								? "物品编号已存在，请检查后重试。已输入内容会保留。"
								: kind === "Loan" && !draft?.borrower
									? "请填写借用人或团体。"
									: isItem && !draft?.itemName
										? "请填写物品名称。"
										: operationError ||
											"请核对编号、名称与计量单位后重试。输入内容会保留。"
					}}
				</p>
				<div class="form-actions">
					<button
						v-if="!isReadOnly"
						type="button"
						class="text-button"
						@click="simulateSaveFailure"
					>
						模拟保存失败</button
					><span v-if="saveState" class="save-state" role="status">{{ saveState }}</span
					><PreviewUiButton variant="secondary" v-if="!isReadOnly" @click="saveDraft">{{
						saveFailed ? "重试保存" : "保存草稿"
					}}</PreviewUiButton
					><PreviewUiButton
						v-if="!isReadOnly"
						variant="primary"
						type="button"
						@click="isItem ? confirmSubmit() : (showConfirm = true)"
						>{{
							isItem ? "保存物品" : isReconcile ? "核对并确认" : "复核并确认"
						}}</PreviewUiButton
					><PreviewUiButton
						v-else
						variant="secondary"
						@click="
							emit(
								'notify',
								documentBlocked
									? '请先恢复当前会话或处理外部变更'
									: '已提交或已取消记录以只读方式显示',
							)
						"
						>查看记录</PreviewUiButton
					>
				</div>
			</form>
			<aside class="form-review surface">
				<span class="eyebrow">确认前检查</span
				><span role="status">{{
					saveState ||
					(documentBlocked
						? "编辑已暂停，输入保留"
						: draft?.status === "completed"
							? "已提交"
							: draft?.status === "cancelled"
								? "已取消"
								: "未保存的预览输入")
				}}</span>
				<h2>{{ isReconcile ? "盘点汇总" : isItem ? "资料检查" : "操作汇总" }}</h2>
				<div v-if="!isItem" class="review-metric">
					<strong v-for="[uom, qty] in totalsByUom" :key="uom"
						>{{ qty }} {{ uom }}</strong
					><span>各单位分别合计</span>
				</div>
				<div class="review-list">
					<div v-for="[place, lines] in groupedLines" :key="place">
						<strong>{{ place }}</strong>
						<p v-for="line in lines" :key="line.id">
							{{ item(line.code)?.name || line.code }} · {{ line.qty }} {{ line.uom
							}}<span v-if="isReconcile && line.countedQty !== undefined">
								→ 实点 {{ line.countedQty }}（差
								{{ line.countedQty - line.qty }}）</span
							>
						</p>
					</div>
				</div>
				<p v-if="kind === 'Loan'">借用人：{{ draft?.borrower || "待填写" }}</p>
				<p v-if="draft?.activity">活动：{{ draft.activity }}</p>
				<p v-if="draft?.postingDate">日期：{{ draft.postingDate }}</p>
				<p class="muted">
					确认前请核对物品、数量和库位。库存为固定样本快照，确认不会执行库存扣增。
				</p>
				<div class="form-actions">
					<PreviewUiButton v-if="!isReadOnly" variant="secondary" @click="saveDraft"
						>保存草稿</PreviewUiButton
					><PreviewUiButton
						v-if="!isReadOnly"
						variant="primary"
						@click="isItem ? confirmSubmit() : (showConfirm = true)"
						>{{ isItem ? "保存物品" : "复核并确认" }}</PreviewUiButton
					>
				</div>
			</aside>
		</div>
		<PreviewOverlay v-if="discardOpen" title="放弃物品编辑？" @close="discardOpen = false"
			><p>物品资料将恢复到编辑前；已创建的单位仍会保留。</p>
			<template #footer
				><PreviewUiButton @click="discardOpen = false">继续编辑</PreviewUiButton
				><PreviewUiButton variant="danger" @click="discardItemEdit"
					>放弃编辑</PreviewUiButton
				></template
			></PreviewOverlay
		>
		<PreviewOverlay
			v-if="showConfirm"
			:title="`确认${pageTitle}？`"
			@close="showConfirm = false"
			><p>这是模拟确认；库存为固定样本快照，不执行库存扣增。</p>
			<template #footer
				><PreviewUiButton variant="secondary" @click="showConfirm = false"
					>返回检查</PreviewUiButton
				><PreviewUiButton variant="primary" @click="confirmSubmit"
					>确认提交</PreviewUiButton
				></template
			></PreviewOverlay
		>
	</section>
</template>
