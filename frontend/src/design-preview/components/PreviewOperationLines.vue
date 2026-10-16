<script setup lang="ts">
import PreviewAllocationDetails from "./PreviewAllocationDetails.vue";
import PreviewAllocationSummary from "./PreviewAllocationSummary.vue";
import {
	recordConversion,
	enteredQty,
	setEnteredQty,
	applyLineConversion,
} from "../conversionModel";
import PreviewScanPanel from "./PreviewScanPanel.vue";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import { computed, ref, nextTick, watch, onDeactivated } from "vue";
import { reviewSession, type ReviewDraft, type DraftLine } from "../reviewModel";
import { physicalLeafWarehouses } from "../workflowModel";
import { previewDate } from "../model";
import {
	isSettlement,
	lineCapacity,
	lineStock,
	operationIssues,
	type OperationIssue,
} from "../formModel";
import PreviewItemImage from "../PreviewItemImage.vue";
import PreviewItemPicker from "./PreviewItemPicker.vue";
import PreviewUiButton from "./PreviewUiButton.vue";

const props = defineProps<{
	draft: ReviewDraft;
	disabled?: boolean;
	mode?: "edit" | "display";
	showError?: boolean;
	expanded?: boolean;
	active?: boolean;
}>();
const emit = defineEmits<{ notify: [message: string]; expand: [] }>();
const receive = computed(() => props.draft.kind === "Receive");
const reconcile = computed(() => props.draft.kind === "Reconcile");
const settlement = computed(() => isSettlement(props.draft));
const places = computed(() => physicalLeafWarehouses().map((row) => row.name));
const destination = ref(places.value[0] || "");
const pickerLines = ref<DraftLine[]>([]);
const pickerOpen = ref(false);
const createFromBarcode = ref<string>();
const scanConfiguring = ref(false);
const scannedLine = ref<DraftLine>();
const scanError = computed(() =>
	scannedLine.value
		? operationIssues(props.draft).find((issue) => issue.lineId === scannedLine.value?.id)
				?.message || ""
		: "",
);
function scanItem(code: string, batch?: string) {
	pickerLines.value = [];
	choose(code);
	scannedLine.value = props.draft.lines.at(-1);
	if (batch && scannedLine.value) {
		const matches =
			stockItem(code)?.locations.filter((row) =>
				row.batches?.some((entry) => entry.id === batch),
			) || [];
		const line = scannedLine.value;
		line.batch = batch;
		if (!receive.value && matches.length === 1) {
			line.sourceLocation = matches[0]!.location;
			if (!["Transfer", "Repair"].includes(props.draft.kind))
				line.location = line.sourceLocation;
			changeBatch(line);
		}
	}
	scanConfiguring.value = true;
	if (scannedLine.value)
		revealIssue({ message: "", lineId: scannedLine.value.id, field: "qty" });
}
const detailsLine = ref<DraftLine>();
const detailsField = ref<string>();
const selectedUnit = ref<string>();
function showDetails(line: DraftLine, field?: string, unit?: string) {
	detailsField.value = field;
	selectedUnit.value = unit;
	detailsLine.value = line;
}
async function replaceFromDetails() {
	const line = detailsLine.value;
	const group = groups.value.find((group) => group.lines.some((row) => row.id === line?.id));
	detailsLine.value = undefined;
	await nextTick();
	if (group) pick(group.lines);
}
function splitFromDetails() {
	const line = detailsLine.value;
	if (line) settlement.value ? splitOutcome(line) : addBatch(line);
	detailsLine.value = undefined;
}
function selectUnit(line: DraftLine, unit: string) {
	const factor =
		unit === line.uom
			? 1
			: stockItem(line.code)?.alternateUnits?.find((row) => row.uom === unit)?.factor;
	if (!factor || unit === "__other")
		showDetails(line, "entryUom", unit === "__other" ? undefined : unit);
	else applyLineConversion(line, unit, factor, line.qty / factor);
}
watch(
	() => props.draft.lines.map((line) => line.id),
	() => props.draft.lines.forEach((line) => recordConversion(line)),
	{ immediate: true },
);
watch(
	() => props.active,
	(active) => {
		if (active === false) detailsLine.value = undefined;
	},
);
onDeactivated(() => {
	detailsLine.value = undefined;
});
const stockItem = (code: string) => reviewSession.stock.find((item) => item.code === code);
const eligible = computed(() => {
	if (receive.value) return undefined;
	if (settlement.value)
		return (
			reviewSession.loans
				.find((loan) => loan.name === props.draft.loanName)
				?.lines.filter((row) => row.qty > row.returned + row.damaged + row.lost)
				.map((row) => row.code) || []
		);
	return reviewSession.stock
		.filter(
			(item) =>
				reconcile.value ||
				item.locations.some((row) =>
					["Repair", "Disposal"].includes(props.draft.kind)
						? row.damaged > 0
						: row.available > 0,
				),
		)
		.map((item) => item.code);
});
const root = ref<HTMLElement>();
const search = ref("");
const incompleteOnly = ref(false);
const revealErrors = ref(false);
const issues = computed(() => operationIssues(props.draft));
const lineIssues = computed(() => issues.value.filter((issue) => issue.lineId));
const totals = computed(() => {
	const quantities = new Map<string, number>();
	props.draft.lines.forEach((line) =>
		quantities.set(line.uom, (quantities.get(line.uom) || 0) + Number(line.qty || 0)),
	);
	return [...quantities].map(([uom, qty]) => `${qty} ${uom}`).join(" · ");
});
const itemCount = computed(() => new Set(props.draft.lines.map((line) => line.code)).size);
const visibleIds = computed(
	() =>
		new Set(
			props.draft.lines
				.filter((line) => {
					const term = search.value.trim().toLocaleLowerCase();
					return (
						(!term ||
							`${stockItem(line.code)?.name} ${line.code} ${line.location} ${line.sourceLocation || ""} ${line.batch || ""}`
								.toLocaleLowerCase()
								.includes(term)) &&
						(!incompleteOnly.value ||
							lineIssues.value.some((issue) => issue.lineId === line.id))
					);
				})
				.map((line) => line.id),
		),
);
// Keep a row's grouping anchor while fields inside the editor have focus.
const anchors = new Map<string, string>();
const groupRevision = ref(0);
const groups = computed(() => {
	void groupRevision.value;
	const grouped = new Map<string, { location: string; code: string; lines: DraftLine[] }>();
	const locations: string[] = [];
	for (const line of props.draft.lines) {
		const current =
			receive.value || reconcile.value || settlement.value
				? line.location
				: line.sourceLocation || line.location;
		if (!anchors.has(line.id)) anchors.set(line.id, current);
		const location = anchors.get(line.id)!;
		if (!locations.includes(location)) locations.push(location);
		const key = `${line.loanName || props.draft.loanName || ""}/${location}/${line.code}`;
		if (!grouped.has(key)) grouped.set(key, { location, code: line.code, lines: [] });
		grouped.get(key)!.lines.push(line);
	}
	return [...grouped.values()].sort(
		(a, b) => locations.indexOf(a.location) - locations.indexOf(b.location),
	);
});
async function regroupAfterFocus() {
	await nextTick();
	if (!root.value?.contains(document.activeElement)) {
		anchors.clear();
		groupRevision.value++;
	}
}
async function revealIssue(issue: OperationIssue | undefined = lineIssues.value[0]) {
	if (!issue?.lineId) return;
	if (issue.message) revealErrors.value = true;
	search.value = "";
	incompleteOnly.value = false;
	const hidden = [
		"batch",
		"expiry",
		"manufacturingDate",
		"reason",
		"entryUom",
		"conversionFactor",
		"returnOutcome",
		"loanName",
	].includes(issue.field || "");
	const line = props.draft.lines.find((line) => line.id === issue.lineId);
	if (hidden && line) {
		showDetails(line, issue.field);
		return;
	}
	await nextTick();
	const row = Array.from(root.value?.querySelectorAll<HTMLElement>("[data-line-id]") || []).find(
		(row) => row.dataset.lineId === issue.lineId,
	);
	const target =
		row?.querySelector<HTMLElement>(`[data-field="${issue.field}"]:not(:disabled)`) ||
		row?.closest(".receive-line")?.querySelector<HTMLElement>(`[data-field="${issue.field}"]`);
	const field = target?.matches("input, select, button")
		? target
		: target?.querySelector<HTMLElement>("input, select, button");
	field?.focus();
}
let lastIssueId = "";
function nextIssue() {
	const index = lineIssues.value.findIndex((issue) => issue.lineId === lastIssueId);
	const issue = lineIssues.value[(index + 1) % lineIssues.value.length];
	lastIssueId = issue?.lineId || "";
	revealIssue(issue);
}
watch(
	() => props.showError,
	(value) => {
		if (value) revealIssue();
	},
);
defineExpose({ revealIssue });
let sequence = 0;
function refreshLine(line: DraftLine) {
	const item = stockItem(line.code);
	if (!item) return;
	line.uom = item.uom;
	line.entryUom = line.uom;
	line.entryQty = line.qty;
	line.conversionFactor = 1;
	if (!receive.value && !settlement.value) {
		const current = pickerLines.value.length ? lineStock(line) : undefined;
		const eligibleLocations = item.locations.filter((row) =>
			["Repair", "Disposal"].includes(props.draft.kind)
				? row.damaged > 0
				: row.available > 0,
		);
		const location =
			current || (eligibleLocations.length === 1 ? eligibleLocations[0] : undefined);
		line.sourceLocation = location?.location || "";
		if (!["Transfer", "Repair"].includes(props.draft.kind))
			line.location = line.sourceLocation;
		const batch = location?.batches?.find(
			(batch) =>
				!["Repair", "Disposal"].includes(props.draft.kind) || (batch.damaged || 0) > 0,
		);
		line.batch = item.tracksBatch && location?.batches?.length === 1 ? batch?.id || "" : "";
		line.expiry = item.tracksExpiry && line.batch ? batch?.expiry || "" : "";
		if (reconcile.value) {
			line.qty = item.tracksBatch ? batch?.available || 0 : location?.available || 0;
			line.countedQty = undefined;
		}
	} else {
		line.batch = "";
		line.expiry = "";
	}
}
function choose(code: string, closePicker = true) {
	const targets = pickerLines.value.length
		? pickerLines.value
		: [
				{
					id: `${props.draft.name}-line-${Date.now()}-${++sequence}`,
					code,
					qty: 1,
					uom: stockItem(code)?.uom || "",
					location: destination.value,
				},
			];
	if (!pickerLines.value.length) props.draft.lines.push(...targets);
	for (const line of targets) {
		if (pickerLines.value.length && line.code === code) continue;
		line.code = code;
		refreshLine(line);
	}
	if (closePicker) pickerOpen.value = false;
	pickerLines.value = [];
}
async function selectSingle(code: string) {
	if (createFromBarcode.value !== undefined) {
		scanItem(code);
		const line = scannedLine.value;
		if (line) await revealIssue({ message: "", lineId: line.id, field: "qty" });
	} else choose(code);
}
async function chooseMultiple(codes: string[]) {
	const start = props.draft.lines.length;
	for (const code of codes) choose(code, false);
	pickerOpen.value = false;
	search.value = "";
	incompleteOnly.value = false;
	await nextTick();
	const line = props.draft.lines[start];
	if (line) await revealIssue({ message: "", lineId: line.id, field: "qty" });
}
function pick(lines: DraftLine[] = []) {
	createFromBarcode.value = undefined;
	pickerLines.value = lines;
	pickerOpen.value = true;
}
function remove(line: DraftLine) {
	props.draft.lines.splice(props.draft.lines.indexOf(line), 1);
	if (scannedLine.value?.id === line.id) {
		scannedLine.value = undefined;
		scanConfiguring.value = false;
	}
}
function splitOutcome(line: DraftLine) {
	props.draft.lines.push({
		...line,
		id: `${line.id}-outcome-${++sequence}`,
		qty: 1,
		entryQty: 1 / (line.conversionFactor || 1),
		returnOutcome: "returned",
	});
}
function addBatch(line: DraftLine) {
	props.draft.lines.push({
		...line,
		id: `${line.id}-batch-${++sequence}`,
		qty: 1,
		entryQty: 1 / (line.conversionFactor || 1),
		batch: "",
		expiry: "",
	});
}
function changeSource(line: DraftLine) {
	const source = line.sourceLocation;
	if (!receive.value && !["Transfer", "Repair"].includes(props.draft.kind))
		line.location = source || "";
	const item = stockItem(line.code);
	const batches = (lineStock(line)?.batches || []).filter(
		(batch) => !["Repair", "Disposal"].includes(props.draft.kind) || (batch.damaged || 0) > 0,
	);
	const batch =
		batches.find((batch) => batch.id === line.batch) ||
		(batches.length === 1 ? batches[0] : undefined);
	line.batch = item?.tracksBatch ? batch?.id || "" : "";
	changeBatch(line);
}
function changeBatch(line: DraftLine) {
	const batch = lineStock(line)?.batches?.find((batch) => batch.id === line.batch);
	line.expiry = batch?.expiry || "";
	if (reconcile.value) {
		line.qty = stockItem(line.code)?.tracksBatch
			? batch?.available || 0
			: lineStock(line)?.available || 0;
		line.countedQty = undefined;
	}
}
</script>

<template>
	<PreviewAllocationSummary v-if="mode === 'display'" :draft="draft" />
	<template v-else>
		<div ref="root" class="preview-operation-lines" @focusout="regroupAfterFocus">
			<div class="preview-line-toolbar">
				<PreviewUiButton :aria-pressed="!!expanded" @click="emit('expand')">{{
					expanded ? "收起工作区" : "展开工作区"
				}}</PreviewUiButton>
				<PreviewUiButton
					v-if="!disabled && !settlement"
					variant="secondary"
					icon="box"
					@click="pick()"
					>添加物品</PreviewUiButton
				>
				<label class="preview-inline-field preview-line-search"
					>搜索明细<input
						v-model="search"
						type="search"
						placeholder="物品名称、编号、库位或批次"
				/></label>
				<span role="status"
					>{{ itemCount }} 种物品 · {{ draft.lines.length }} 行分配 · {{ totals }}</span
				>
				<label class="preview-choice-label"
					><input v-model="incompleteOnly" type="checkbox" />仅看待完善</label
				>
				<PreviewUiButton :disabled="!lineIssues.length" @click="nextIssue"
					>{{ lineIssues.length }} 处待完善 · 下一个</PreviewUiButton
				>
				<span v-if="search || incompleteOnly" role="status"
					>显示 {{ visibleIds.size }} / {{ draft.lines.length }} 行</span
				>

				<PreviewScanPanel
					v-if="!disabled && !settlement"
					:allow-create="receive"
					:paused="scanConfiguring || pickerOpen"
					@item="scanItem"
					@location="
						receive ? (destination = $event) : emit('notify', '选择物品后核对来源库位')
					"
					@create="
						(barcode) => {
							pick();
							createFromBarcode = barcode;
						}
					"
				/>
			</div>
			<p v-if="scanConfiguring && scanError" role="status">{{ scanError }}</p>
			<PreviewUiButton
				v-if="scanConfiguring"
				:disabled="!!scanError"
				@click="scanConfiguring = false"
				>配置完成，继续扫描</PreviewUiButton
			>
			<PreviewSearchSelect
				v-if="receive && !disabled"
				label="新增物品的入库位置"
				v-model="destination"
				:options="places"
			/>
			<div class="allocation-columns" aria-hidden="true">
				<span>物品</span><span>数量 / 单位</span><span>库位</span><span>批次 / 状态</span
				><span>操作</span>
			</div>
			<section
				v-for="(group, groupIndex) in groups"
				:key="group.lines[0]!.id"
				v-show="group.lines.some((line) => visibleIds.has(line.id))"
				class="location-group"
			>
				<h3
					v-if="
						!groups
							.slice(0, groupIndex)
							.some(
								(previous) =>
									previous.location === group.location &&
									previous.lines.some((line) => visibleIds.has(line.id)),
							)
					"
				>
					{{ group.location || "未选择库位" }}
				</h3>
				<div class="draft-line receive-line">
					<article
						v-for="line in group.lines"
						:key="line.id"
						v-show="visibleIds.has(line.id)"
						class="preview-allocation compact-allocation"
						:data-line-id="line.id"
					>
						<div class="allocation-identity">
							<div v-if="stockItem(line.code)" class="preview-group-thumbnail">
								<PreviewItemImage :item="stockItem(line.code)!" />
							</div>
							<div class="preview-line-identity">
								<strong>{{ stockItem(line.code)?.name || line.code }}</strong
								><small class="muted"
									>{{ line.code }} · {{ stockItem(line.code)?.category }}</small
								>
							</div>
						</div>
						<div class="allocation-quantity">
							<label class="preview-field"
								><span class="allocation-field-label">数量</span
								><input
									data-field="qty"
									type="number"
									min="0"
									step="any"
									:value="enteredQty(line)"
									:disabled="disabled"
									:aria-label="`${stockItem(line.code)?.name}数量`"
									:aria-invalid="
										(showError || revealErrors) &&
										lineIssues.some(
											(issue) =>
												issue.lineId === line.id && issue.field === 'qty',
										)
									"
									@input="
										setEnteredQty(
											line,
											Number(($event.target as HTMLInputElement).value),
										)
									"
							/></label>
							<PreviewSearchSelect
								label="单位"
								:clearable="false"
								:model-value="line.entryUom || line.uom"
								:disabled="disabled"
								:options="[
									line.uom,
									...(stockItem(line.code)?.alternateUnits?.map(
										(row) => row.uom,
									) || []),
									{ value: '__other', label: '选择其他单位 / 新建单位' },
								]"
								@update:model-value="selectUnit(line, $event)"
							/>
							<small v-if="line.entryUom !== line.uom" class="allocation-equivalent"
								>{{ enteredQty(line) }} {{ line.entryUom }} · 折合 {{ line.qty }}
								{{ line.uom }}</small
							>
						</div>
						<div class="allocation-locations">
							<PreviewSearchSelect
								v-if="!receive && !settlement"
								data-field="sourceLocation"
								label="来源库位"
								v-model="line.sourceLocation"
								:disabled="disabled"
								:options="
									stockItem(line.code)?.locations.map((row) => ({
										value: row.location,
										label: row.location,
										detail: `可用 ${row.available} · 损坏 ${row.damaged}`,
									})) || []
								"
								@update:model-value="changeSource(line)"
							/>
							<PreviewSearchSelect
								v-if="
									receive ||
									['Transfer', 'Return', 'Repair'].includes(draft.kind)
								"
								data-field="location"
								label="目标 / 存放库位"
								v-model="line.location"
								:disabled="disabled"
								:options="places"
							/>
						</div>
						<div class="allocation-context">
							<small v-if="stockItem(line.code)?.tracksBatch"
								>批次 {{ line.batch || (receive ? "自动生成" : "待选择") }}</small
							>
							<small v-if="stockItem(line.code)?.tracksExpiry"
								>到期 {{ line.expiry || "待填写" }}</small
							>
							<small v-if="settlement"
								>借出 {{ line.loanName || draft.loanName }} / 原明细
								{{ (line.loanLineIndex || 0) + 1 }} ·
								{{
									line.returnOutcome === "damaged"
										? "损坏归还"
										: line.returnOutcome === "lost"
											? "遗失"
											: "完好归还"
								}}</small
							>
							<small v-if="!receive"
								>{{
									settlement
										? "未结清"
										: ["Repair", "Disposal"].includes(draft.kind)
											? "损坏可处理"
											: "可用"
								}}
								{{ lineCapacity(draft, line) }} {{ line.uom }}</small
							>
							<small
								v-if="draft.kind === 'Damage' || line.returnOutcome === 'damaged'"
								>移入损坏待处理</small
							>
							<small v-if="draft.kind === 'Loan'">移入借出库位</small>
							<small v-if="receive && line.expiry && line.expiry < previewDate"
								>已过期，请核对实物</small
							>
							<span
								v-if="lineIssues.some((issue) => issue.lineId === line.id)"
								class="badge warning"
								>待完善</span
							>
						</div>
						<div class="preview-allocation-actions">
							<PreviewUiButton
								variant="secondary"
								:aria-label="`${stockItem(line.code)?.name}详情`"
								@click="showDetails(line)"
								>详情</PreviewUiButton
							>
							<PreviewUiButton
								v-if="!disabled"
								variant="ghost"
								:aria-label="`移除${stockItem(line.code)?.name}明细`"
								@click="remove(line)"
								>移除</PreviewUiButton
							>
						</div>
						<p
							v-if="
								(showError || revealErrors) &&
								lineIssues.some((issue) => issue.lineId === line.id)
							"
							class="notice-bar danger allocation-error"
							role="status"
						>
							{{ lineIssues.find((issue) => issue.lineId === line.id)?.message }}
						</p>
					</article>
				</div>
			</section>
			<PreviewAllocationDetails
				v-if="detailsLine"
				:line="detailsLine"
				:draft="draft"
				:disabled="disabled"
				:field="detailsField"
				:selected-unit="selectedUnit"
				@close="detailsLine = undefined"
				@batch-change="changeBatch(detailsLine!)"
				@replace="replaceFromDetails"
				@split="splitFromDetails"
			/>
			<p v-if="!draft.lines.length" class="muted">
				{{ settlement ? "请先选择未结清借用记录。" : "选择库位后添加物品。" }}
			</p>
			<PreviewItemPicker
				v-if="pickerOpen && !disabled"
				:allow-create="receive"
				:mode="pickerLines.length ? 'replace-single' : 'add-multiple'"
				:context="`入库登记 · ${draft.name}`"
				:create-barcode="createFromBarcode"
				:eligible="eligible"
				@close="
					pickerOpen = false;
					pickerLines = [];
				"
				@select="selectSingle"
				@select-multiple="chooseMultiple"
				@notify="emit('notify', $event)"
			/>
		</div>
	</template>
</template>
