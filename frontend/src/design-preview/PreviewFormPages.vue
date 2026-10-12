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
import { locations, items } from "./model";

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
type PreviewDraft = ReviewDraft & {
	recorder?: string;
	handler?: string;
	reviewer?: string;
	barcode?: string;
	description?: string;
	tracksBatch?: boolean;
	tracksExpiry?: boolean;
	loanName?: string;
};
const draft = ref<PreviewDraft>();
let lineSequence = 0;
const showError = ref(false);
const saveFailed = ref(false);
const saveState = ref("");
const showConfirm = ref(false);
const expanded = ref<Record<string, boolean>>({});
const photoName = ref("");
const scanCode = ref("ITM-000128");
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
function selectableItems(line: ReviewDraft["lines"][number]) {
	const allowed =
		kind.value === "Return"
			? draft.value?.loanName
				? reviewSession.loans
						.find((loan) => loan.name === draft.value?.loanName)
						?.lines.filter(
							(entry) => entry.qty > entry.returned + entry.damaged + entry.lost,
						)
						.map((entry) => entry.code) || []
				: []
			: undefined;
	return reviewSession.stock.filter(
		(stock) =>
			stock.code === line.code ||
			((!allowed || allowed.includes(stock.code)) &&
				(kind.value !== "Loan" ||
					stock.locations.some((location) => location.available > 0))),
	);
}
function selectReturnLoan(name: string) {
	if (!draft.value) return;
	const loan = returnLoans.value.find((entry) => entry.name === name);
	if (!loan) return;
	draft.value.loanName = loan.name;
	draft.value.borrower = loan.borrower;
	const outstanding = loan.lines.find(
		(entry) => entry.qty > entry.returned + entry.damaged + entry.lost,
	);
	if (outstanding) {
		const line = draft.value.lines[0];
		if (line) {
			setItem(line, outstanding.code);
			line.qty =
				outstanding.qty - outstanding.returned - outstanding.damaged - outstanding.lost;
			const stockItem = item(outstanding.code);
			line.location =
				stockItem?.locations.find((location) => location.loaned > 0)?.location ||
				stockItem?.locations[0]?.location ||
				locations[0];
		}
	}
}
function validOperation() {
	if (!draft.value || isItem.value)
		return (
			!!draft.value?.itemName?.trim() &&
			!!draft.value.itemCode?.trim() &&
			!itemCodeCollision.value
		);
	if (
		!draft.value.postingDate ||
		Number.isNaN(Date.parse(draft.value.postingDate)) ||
		!draft.value.lines.length
	)
		return false;
	if (kind.value === "Loan" && !draft.value.borrower.trim()) return false;
	if (kind.value === "Return" && !draft.value.loanName) return false;
	return draft.value.lines.every((line) => {
		const selected = item(line.code);
		if (
			!selected ||
			!line.location ||
			!Number.isFinite(Number(line.qty)) ||
			Number(line.qty) <= 0
		)
			return false;
		if (
			kind.value === "Transfer" &&
			(!line.sourceLocation || line.sourceLocation === line.location)
		)
			return false;
		if (
			isReconcile.value &&
			(!Number.isFinite(Number(line.countedQty)) || Number(line.countedQty) < 0)
		)
			return false;
		if (selected.tracksBatch && !line.batch?.trim()) return false;
		if (selected.tracksExpiry && (!line.expiry || Number.isNaN(Date.parse(line.expiry))))
			return false;
		if (["Issue", "Loss", "Damage", "Loan", "Transfer"].includes(kind.value)) {
			const available =
				selected.locations.find(
					(location) => location.location === (line.sourceLocation || line.location),
				)?.available || 0;
			if (Number(line.qty) > available) return false;
		}
		if (kind.value === "Repair" || kind.value === "Disposal") {
			const damaged =
				selected.locations.find(
					(location) => location.location === (line.sourceLocation || line.location),
				)?.damaged || 0;
			if (Number(line.qty) > damaged) return false;
		}
		if (kind.value === "Return") {
			const loan = reviewSession.loans.find((entry) => entry.name === draft.value?.loanName);
			const borrowed = loan?.lines.find((entry) => entry.code === line.code);
			if (
				!borrowed ||
				Number(line.qty) >
					borrowed.qty - borrowed.returned - borrowed.damaged - borrowed.lost
			)
				return false;
		}
		return true;
	});
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
	if (isItem.value && props.variant === "edit" && draft.value && !draft.value.itemCode) {
		const current = item(reviewSession.selectedItemCode);
		if (current)
			Object.assign(draft.value, {
				itemCode: current.code,
				itemName: current.name,
				category: current.category,
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
		draft.value!.itemCode = "ITM-000134";
	if (draft.value && !draft.value.lines.length && !isItem.value) addLine();
	reviewSession.selectedDraftName = "";
	showError.value = false;
}
watch(() => [props.page, props.variant], initialize, { immediate: true });
onActivated(() => {
	if (
		reviewSession.selectedDraftName ||
		(draft.value && !reviewSession.drafts.includes(draft.value)) ||
		(isItem.value &&
			props.variant === "edit" &&
			draft.value?.itemCode !== reviewSession.selectedItemCode)
	)
		initialize();
});
onDeactivated(() => {
	showConfirm.value = false;
});
watch(
	() => props.active,
	(active) => {
		if (!active) showConfirm.value = false;
	},
);
function addLine() {
	if (!draft.value) return;
	const first =
		reviewSession.stock.find((row) => row.code === "ITM-000131") || reviewSession.stock[0];
	draft.value.lines.push({
		id: `${draft.value.name}-line-${draft.value.lines.length}-${++lineSequence}`,
		code: first.code,
		qty: 1,
		uom: first.uom,
		location: first.locations[0]?.location || locations[0],
		sourceLocation:
			kind.value === "Receive" ? undefined : first.locations[0]?.location || locations[0],
		batch: "",
		expiry: "",
	});
}
function setItem(line: ReviewDraft["lines"][number], code: string) {
	line.code = code;
	const selected = item(code);
	if (selected) {
		line.uom = selected.uom;
		const location =
			selected.locations.find(
				(row) => row.location === (line.sourceLocation || line.location),
			) || selected.locations[0];
		if (kind.value !== "Receive" && location) {
			line.sourceLocation = location.location;
			if (kind.value !== "Transfer") line.location = location.location;
		}
		const batch = location?.batches?.[0];
		line.batch = selected.tracksBatch && kind.value !== "Receive" ? batch?.id || "" : "";
		line.expiry = selected.tracksExpiry && kind.value !== "Receive" ? batch?.expiry || "" : "";
	}
}
function removeLine(id: string) {
	if (!draft.value) return;
	draft.value.lines = draft.value.lines.filter((line) => line.id !== id);
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
				barcode: draft.value.barcode || "",
				description: draft.value.description || "",
				tracksBatch: !!draft.value.tracksBatch,
				tracksExpiry: !!draft.value.tracksExpiry,
			});
		} else if (draft.value.itemCode && draft.value.itemName)
			reviewSession.stock.push({
				code: draft.value.itemCode,
				name: draft.value.itemName,
				category: draft.value.category || "日用品",
				uom: draft.value.uom || "个",
				tracksBatch: !!draft.value.tracksBatch,
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
	if (result)
		emit(
			"notify",
			isItem.value
				? "物品资料已在预览中保存"
				: "模拟确认完成；库存为固定样本快照，不执行库存扣增。",
		);
}
function scanItem() {
	const found = items.find((row) => row.code === scanCode.value || row.name === scanCode.value);
	if (found && draft.value && !isItem.value) {
		const line = draft.value.lines[0];
		if (line) setItem(line, found.code);
		else
			draft.value.lines.push({
				id: `scan-${Date.now()}`,
				code: found.code,
				qty: 1,
				uom: found.uom,
				location: locations[0],
			});
		emit("notify", `已模拟识别：${found.name}`);
	} else emit("notify", "未找到匹配物品，请检查编号后重试");
}
function applyPhoto(event: Event) {
	const name = (event.target as HTMLInputElement).files?.[0]?.name || "";
	photoName.value = name;
	if (draft.value)
		draft.value.description = name ? `示例图片：${name}` : draft.value.description;
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
				<div class="form-section form-date-section">
					<label
						>操作日期<input
							v-model="draft!.postingDate"
							type="date"
							:disabled="isReadOnly"
					/></label>
					<label v-if="!isItem"
						>活动 / 用途<input
							v-model="draft!.activity"
							placeholder="可选，记录操作背景"
							:disabled="isReadOnly"
					/></label>
				</div>
				<template v-if="isItem">
					<section class="form-section">
						<h2>物品资料</h2>
						<div class="form-fields">
							<label
								>物品编号<input
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
							<label
								>计量单位<input
									v-model="draft!.uom"
									placeholder="如：袋、件、个"
									:disabled="isReadOnly"
							/></label>
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
									:disabled="isReadOnly"
								/>按批次管理</label
							><label
								><input
									v-model="draft!.tracksExpiry"
									type="checkbox"
									:disabled="isReadOnly"
								/>记录效期</label
							>
						</div>
					</section>
					<section class="form-section">
						<h2>物品图片</h2>
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
					<section v-if="kind === 'Loan' || kind === 'Return'" class="form-section">
						<h2>{{ kind === "Loan" ? "借用对象" : "归还来源" }}</h2>
						<div class="form-fields">
							<label
								>{{ kind === "Loan" ? "借用人 / 团体" : "关联借用记录"
								}}<select
									v-if="kind === 'Return'"
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
									:disabled="isReadOnly" /></label
							><label v-if="kind === 'Return'"
								>经手人<input
									v-model="draft!.handler"
									placeholder="可选"
									:disabled="isReadOnly"
							/></label>
						</div>
					</section>
					<section class="form-section">
						<label
							>模拟扫码内容<input v-model="scanCode" placeholder="输入样本物品编号"
						/></label>
						<div class="section-title-row">
							<div>
								<h2>{{ isReconcile ? "盘点物资" : "操作物资" }}</h2>
								<p class="muted">按库位分组；每行可展开填写批次与其他信息。</p>
							</div>
							<PreviewUiButton
								v-if="!isReadOnly"
								variant="secondary"
								icon="scan"
								@click="scanItem"
								>模拟扫码</PreviewUiButton
							>
						</div>
						<div
							v-for="[location, lines] in groupedLines"
							:key="location"
							class="location-group"
						>
							<h3><InventoryIcon name="warehouse" />{{ location }}</h3>
							<article v-for="line in lines" :key="line.id" class="draft-line">
								<div class="line-primary">
									<label
										>物品<select
											:value="line.code"
											:disabled="isReadOnly"
											@change="
												setItem(
													line,
													($event.target as HTMLSelectElement).value,
												)
											"
										>
											<option
												v-for="stock in selectableItems(line)"
												:key="stock.code"
												:value="stock.code"
											>
												{{ stock.name }} · {{ stock.code }}
											</option>
										</select></label
									><label
										>数量
										<div class="quantity-field">
											<input
												v-model.number="line.qty"
												:aria-invalid="
													showError &&
													(!Number.isFinite(Number(line.qty)) ||
														Number(line.qty) <= 0)
												"
												type="number"
												min="0"
												step="any"
												:disabled="isReadOnly"
											/><span>{{ line.uom }}</span>
										</div></label
									><PreviewUiButton
										v-if="!isReadOnly"
										variant="ghost"
										icon-only
										icon="chevron-down"
										:aria-expanded="!!expanded[line.id]"
										label="展开物品详情"
										@click.prevent="expanded[line.id] = !expanded[line.id]"
									/><PreviewUiButton
										v-if="!isReadOnly"
										variant="danger"
										icon-only
										icon="warning"
										label="移除物品"
										@click.prevent="removeLine(line.id)"
									/>
								</div>
								<div
									v-if="expanded[line.id] || isReconcile"
									data-expanded-fields="locations"
									v-show="
										isReconcile ||
										kind === 'Receive' ||
										kind === 'Transfer' ||
										[
											'Issue',
											'Loss',
											'Disposal',
											'Damage',
											'Loan',
											'Return',
											'Repair',
										].includes(kind)
									"
									class="line-secondary"
								>
									<label
										v-if="
											kind !== 'Receive' && kind !== 'Return' && !isReconcile
										"
										>{{ isReconcile ? "盘点库位" : "来源库位"
										}}<select
											v-model="line.sourceLocation"
											:disabled="isReadOnly"
										>
											<option
												v-for="place in locations"
												:key="place"
												:value="place"
											>
												{{ place }}
											</option>
										</select></label
									><label
										v-if="
											[
												'Receive',
												'Transfer',
												'Return',
												'Repair',
												'Reconcile',
											].includes(kind)
										"
										>{{ isReconcile ? "盘点库位" : "目标 / 存放库位"
										}}<select v-model="line.location" :disabled="isReadOnly">
											<option
												v-for="place in locations"
												:key="place"
												:value="place"
											>
												{{ place }}
											</option>
										</select></label
									><label v-if="isReconcile"
										>实点数量<input
											v-model.number="line.countedQty"
											type="number"
											min="0"
											:disabled="isReadOnly"
									/></label>
								</div>
								<div
									v-if="
										expanded[line.id] &&
										(item(line.code)?.tracksBatch ||
											item(line.code)?.tracksExpiry)
									"
									class="line-secondary"
								>
									<label v-if="item(line.code)?.tracksBatch"
										>批次<input
											v-model="line.batch"
											placeholder="批次编号"
											:disabled="isReadOnly" /></label
									><label v-if="item(line.code)?.tracksExpiry"
										>效期<input
											v-model="line.expiry"
											type="date"
											:disabled="isReadOnly"
									/></label>
								</div>
							</article>
						</div>
						<PreviewUiButton
							v-if="!isReadOnly"
							variant="secondary"
							icon="open"
							@click="addLine"
							>添加物品</PreviewUiButton
						>
					</section>
					<section class="form-section">
						<h2>补充记录</h2>
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
								>复核人<input
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
					</section>
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
										: "请核对日期、数量、库位、批次与效期后重试。输入内容会保留。"
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
						@click="showConfirm = true"
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
						@click="showConfirm = true"
						>{{ isItem ? "保存物品" : "复核并确认" }}</PreviewUiButton
					>
				</div>
			</aside>
		</div>
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
