<script setup lang="ts">
import { computed, ref, watch, onActivated, onDeactivated } from "vue";
import InventoryIcon from "../components/InventoryIcon.vue";
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
import { locations } from "./model";
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
let lineSequence = 0;
const showError = ref(false);
const saveFailed = ref(false);
const saveState = ref("");
const showConfirm = ref(false);
const operationError = ref("");
const photoName = ref("");
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
const isReadOnly = computed(() => !!draft.value && draft.value.status !== "draft");
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
function selectReturnLoan(name: string) {
	if (!draft.value) return;
	const loan = returnLoans.value.find((entry) => entry.name === name);
	draft.value.loanName = name;
	draft.value.borrower = loan?.borrower || "";
	draft.value.lines =
		loan?.lines
			.map((entry, index) => ({
				id: `${loan.name}-${index}`,
				loanLineIndex: index,
				code: entry.code,
				qty: entry.qty - entry.returned - entry.damaged - entry.lost,
				uom: item(entry.code)?.uom || "",
				location: entry.location || locations[0],
				batch: entry.batch,
				returnOutcome: "returned" as const,
			}))
			.filter((line) => line.qty > 0) || [];
}
function validOperation() {
	if (!draft.value) return false;
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
	const selectedName = reviewSession.selectedDraftName;
	const selected = selectedName ? findDraft(kind.value, selectedName) : undefined;
	if (selected) {
		draft.value = selected;
		reviewSession.selectedDraftName = "";
	}
	const name =
		props.page === "reconciliation-form" && props.variant === "detail"
			? "PREV-RECON-001"
			: props.page === "item-form" && props.variant === "edit"
				? `PREV-ITEM-EDIT-${reviewSession.selectedItemCode}`
				: props.page === "item-form"
					? "PREV-ITEM-NEW-001"
					: props.page === "reconciliation-form"
						? "PREV-RECON-NEW-001"
						: props.variant === "Receive" || props.variant === "Loan"
							? undefined
							: `PREV-${kind.value.toUpperCase()}-NEW-001`;
	if (!selected && name)
		draft.value = findDraft(kind.value, name) || createDraft(kind.value, name);
	else if (!selected) draft.value = createDraft(kind.value);
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
				uom: current.uom,
				tracksBatch: current.tracksBatch,
				tracksExpiry: current.tracksExpiry,
			});
	}
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
	if (draft.value && !draft.value.lines.length && !isItem.value && kind.value !== "Return")
		addLine();
	reviewSession.selectedDraftName = "";
	showError.value = false;
	if (isItem.value) itemEditBaseline = JSON.stringify(draft.value);
}
watch(() => [props.page, props.variant], initialize, { immediate: true });
onActivated(() => {
	if (
		reviewSession.selectedDraftName ||
		(isItem.value && isReadOnly.value) ||
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
function addLine() {
	if (!draft.value) return;
	const first = ["Repair", "Disposal"].includes(kind.value)
		? reviewSession.stock.find((row) =>
				row.locations.some((location) => location.damaged > 0),
			)!
		: reviewSession.stock.find((row) => row.code === "ITM-000131") || reviewSession.stock[0];
	draft.value.lines.push({
		id: `${draft.value.name}-line-${draft.value.lines.length}-${++lineSequence}`,
		code: first.code,
		qty: isReconcile.value ? first.locations[0]?.available || 0 : 1,
		uom: first.uom,
		location: first.locations[0]?.location || locations[0],
		sourceLocation:
			kind.value === "Receive" ? undefined : first.locations[0]?.location || locations[0],
		batch: first.tracksBatch ? first.locations[0]?.batches?.[0]?.id || "" : "",
		expiry: first.tracksExpiry ? first.locations[0]?.batches?.[0]?.expiry || "" : "",
	});
}
function saveDraft() {
	if (!draft.value || isReadOnly.value) return;
	showError.value = false;
	if (!validOperation()) {
		showError.value = true;
		return;
	}
	if (itemCodeCollision.value && isItem.value && props.variant === "new") {
		showError.value = true;
		return;
	}
	saveFailed.value = false;
	saveState.value = "草稿已保存";
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
				tracksExpiry: !!draft.value.tracksExpiry,
			});
		} else if (draft.value.itemCode && draft.value.itemName)
			reviewSession.stock.push({
				code: draft.value.itemCode,
				name: draft.value.itemName,
				category: draft.value.category || "日用品",
				uom: draft.value.uom || "个",
				tracksBatch: !!draft.value.tracksBatch || !!draft.value.tracksExpiry,
				barcode: draft.value.barcode,
				description: draft.value.description,
				images: draft.value.images,
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
function applyPhoto(event: Event) {
	const name = (event.target as HTMLInputElement).files?.[0]?.name || "";
	photoName.value = name;
	if (draft.value)
		draft.value.images = name ? [...(draft.value.images || []), name] : draft.value.images;
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
				>{{ draft?.name || "新建草稿" }} · {{ isReadOnly ? "已完成" : "草稿" }}</span
			>
		</div>
		<div class="form-layout">
			<form class="form-main surface" @submit.prevent="saveDraft">
				<div v-if="!isItem" class="form-section form-date-section">
					<label
						>操作日期<input
							v-model="draft!.postingDate"
							type="date"
							:disabled="isReadOnly"
					/></label>
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
							<label
								>分类<select v-model="draft!.category" :disabled="isReadOnly">
									<option>食品</option>
									<option>日用品</option>
									<option>服装</option>
									<option>清洁用品</option>
								</select></label
							>
							<PreviewUnitField
								v-model="draft!.uom"
								:disabled="isReadOnly || variant === 'edit'"
							/>
							<label
								>条码（可选）<input
									v-model="draft!.barcode"
									placeholder="可扫描或手动填写"
									:disabled="isReadOnly" /></label
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
						<ul>
							<li v-for="(name, index) in draft?.images" :key="index">
								{{ name }}<span v-if="index === 0"> · 主图</span
								><PreviewUiButton
									v-if="index > 0 && !isReadOnly"
									variant="ghost"
									@click="
										draft!.images!.unshift(...draft!.images!.splice(index, 1))
									"
									>设为主图</PreviewUiButton
								><PreviewUiButton
									v-if="!isReadOnly"
									variant="ghost"
									@click="draft!.images!.splice(index, 1)"
									>移除图片</PreviewUiButton
								>
							</li>
						</ul>
						<label class="file-drop"
							><input
								type="file"
								accept="image/*"
								:disabled="isReadOnly"
								@change="applyPhoto"
							/><InventoryIcon name="card" /><span>{{
								photoName || "选择图片 · 上传仅作界面演示"
							}}</span></label
						>
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
							<label
								>{{ kind === "Loan" ? "借用人 / 团体" : "关联借用记录"
								}}<select
									v-if="kind !== 'Loan'"
									:value="draft!.loanName || ''"
									:disabled="isReadOnly"
									@change="
										selectReturnLoan(
											($event.target as HTMLSelectElement).value,
										)
									"
								>
									<option value="">选择一条借用记录</option>
									<option
										v-for="loan in returnLoans"
										:key="loan.name"
										:value="loan.name"
									>
										{{ loan.borrower }} · {{ loan.name }}
									</option></select
								><input
									v-else
									v-model="draft!.borrower"
									placeholder="填写个人或团体名称"
									:disabled="isReadOnly"
							/></label>
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
						<PreviewOperationLines
							:draft="draft!"
							:disabled="isReadOnly"
							:show-error="showError"
							@notify="emit('notify', $event)"
						/>
					</section>
					<details class="form-section">
						<summary>补充记录（可选）</summary>
						<div class="form-fields">
							<label
								>活动 / 用途<input
									v-model="draft!.activity"
									:disabled="isReadOnly" /></label
							><label v-if="kind === 'Receive'"
								>捐赠人 / 来源<input
									v-model="draft!.source"
									:disabled="isReadOnly"
							/></label>
						</div>
						<label
							>附件（模拟上传）<input
								type="file"
								multiple
								:disabled="isReadOnly"
								@change="
									draft!.attachments = Array.from(
										($event.target as HTMLInputElement).files || [],
									).map((file) => file.name)
								"
						/></label>
						<ul v-if="draft?.attachments?.length">
							<li v-for="name in draft.attachments" :key="name">
								{{ name }} · 仅保存文件名，不上传
							</li>
						</ul>
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
						@click="emit('notify', '已完成记录为只读样本')"
						>查看记录</PreviewUiButton
					>
				</div>
			</form>
			<aside class="form-review surface">
				<span class="eyebrow">确认前检查</span
				><span role="status">{{
					saveState || (isReadOnly ? "模拟记录已完成" : "未保存的预览输入")
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
