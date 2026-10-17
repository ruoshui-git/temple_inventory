<script setup lang="ts">
import { warehouseLabel } from "../../lib/warehouseLabel";
import AllocationDetails from "./AllocationDetails.vue";
import AllocationSummary from "./AllocationSummary.vue";
import {
	recordConversion,
	enteredQty,
	setEnteredQty,
	applyLineConversion,
} from "../../lib/quantityConversion";
import ScanPanel from "../scanner/ScanPanel.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import { computed, ref, nextTick, watch, onDeactivated } from "vue";
import { useOperationContext, type OperationDraft, type AllocationLine } from "./operationModel";
import { useReferenceData } from "../../services/contracts";
const context = useOperationContext();
const reference = useReferenceData();

import { isSettlement, type OperationIssue } from "./operationModel";
const { lineStock, lineCapacity } = context;
const operationIssues = context.issues;
import ItemImage from "../../components/ItemImage.vue";
import ItemPicker from "../items/ItemPicker.vue";
import UiButton from "../../components/ui/UiButton.vue";

const props = withDefaults(
	defineProps<{
		draft: OperationDraft;
		disabled?: boolean;
		mode?: "edit" | "display";
		showError?: boolean;
		expanded?: boolean;
		active?: boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{ notify: [message: string]; expand: [] }>();
const previewDate = computed(() => reference.siteDate);
const receive = computed(() => props.draft.kind === "Receive");
const settlement = computed(() => isSettlement(props.draft));
const places = computed(() => reference.physicalLeaves);
const destination = ref(
	reference.physicalLeaves.includes(String(props.draft.preferredWarehouse || ""))
		? String(props.draft.preferredWarehouse)
		: places.value[0] || "",
);
const pickerLines = ref<AllocationLine[]>([]);
const pickerOpen = ref(false);
const selectionError = ref("");
const createFromBarcode = ref<string>();
const scanConfiguring = ref(false);
const scannedLine = ref<AllocationLine>();
const scanError = computed(() =>
	scannedLine.value
		? operationIssues(props.draft).find((issue) => issue.lineId === scannedLine.value?.id)
				?.message || ""
		: "",
);
async function scanItem(code: string, batch?: string) {
	pickerLines.value = [];
	if (!(await choose(code))) return;
	scannedLine.value = props.draft.items.at(-1);
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
const detailsLine = ref<AllocationLine>();
const detailsField = ref<string>();
const selectedUnit = ref<string>();
function showDetails(line: AllocationLine, field?: string, unit?: string) {
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
function selectUnit(line: AllocationLine, unit: string) {
	const factor =
		unit === line.uom
			? 1
			: stockItem(line.code)?.alternateUnits?.find((row) => row.uom === unit)?.factor;
	if (!factor || unit === "__other")
		showDetails(line, "entryUom", unit === "__other" ? undefined : unit);
	else applyLineConversion(line, unit, factor, line.qty / factor);
}
watch(
	() => props.draft.items.map((line) => line.id),
	() =>
		props.draft.items.forEach((line) =>
			recordConversion(
				line,
				context.stock.find((item) => item.code === line.code)?.alternateUnits,
			),
		),
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
const stockItem = (code: string) => context.stock.find((item) => item.code === code);
const eligible = computed(() => undefined);
const root = ref<HTMLElement>();
const search = ref("");
const incompleteOnly = ref(false);
const revealErrors = ref(false);
const issues = computed(() => operationIssues(props.draft));
const lineIssues = computed(() => issues.value.filter((issue) => issue.lineId));
const totals = computed(() => {
	const quantities = new Map<string, number>();
	props.draft.items.forEach((line) =>
		quantities.set(line.uom, (quantities.get(line.uom) || 0) + Number(line.qty || 0)),
	);
	return [...quantities].map(([uom, qty]) => `${qty} ${uom}`).join(" · ");
});
const itemCount = computed(() => new Set(props.draft.items.map((line) => line.code)).size);
const visibleIds = computed(
	() =>
		new Set(
			props.draft.items
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
	const grouped = new Map<string, { location: string; code: string; lines: AllocationLine[] }>();
	const locations: string[] = [];
	for (const line of props.draft.items) {
		const current =
			receive.value || settlement.value
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
	const line = props.draft.items.find((line) => line.id === issue.lineId);
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
function refreshLine(line: AllocationLine) {
	const item = stockItem(line.code);
	if (!item) return;
	line.nativeBundle = undefined;
	line.recordedBundle = undefined;
	line.batchAllocations = undefined;
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
		const preferred = String(props.draft.preferredWarehouse || "");
		const location =
			current ||
			(preferred
				? item.locations.find((row) => row.location === preferred)
				: eligibleLocations.length === 1
					? eligibleLocations[0]
					: undefined);
		line.sourceLocation = current?.location || preferred || location?.location || "";
		if (
			["Transfer", "Repair"].includes(props.draft.kind) &&
			line.location === line.sourceLocation
		)
			line.location = "";
		if (!["Transfer", "Repair"].includes(props.draft.kind))
			line.location = line.sourceLocation;
		const batch = location?.batches?.find(
			(batch) =>
				!["Repair", "Disposal"].includes(props.draft.kind) || (batch.damaged || 0) > 0,
		);
		line.batch = item.tracksBatch && location?.batches?.length === 1 ? batch?.id || "" : "";
		line.expiry = item.tracksExpiry && line.batch ? batch?.expiry || "" : "";
	} else {
		line.batch = "";
		line.expiry = "";
	}
}
async function choose(code: string, closePicker = true) {
	selectionError.value = "";
	try {
		await context.ensure(code);
	} catch (reason) {
		selectionError.value = reason instanceof Error ? reason.message : "物品读取失败，请重试";
		return false;
	}
	const targets = pickerLines.value.length
		? pickerLines.value
		: [
				{
					id: crypto.randomUUID(),
					localId: crypto.randomUUID(),
					code,
					qty: 1,
					uom: stockItem(code)?.uom || "",
					location: destination.value,
				},
			];
	if (!pickerLines.value.length) props.draft.items.push(...targets);
	for (const line of targets) {
		if (pickerLines.value.length && line.code === code) continue;
		line.code = code;
		refreshLine(line);
	}
	if (closePicker) pickerOpen.value = false;
	pickerLines.value = [];
	return true;
}
async function selectSingle(code: string) {
	if (createFromBarcode.value !== undefined) {
		await scanItem(code);
		const line = scannedLine.value;
		if (line) await revealIssue({ message: "", lineId: line.id, field: "qty" });
	} else await choose(code);
}
async function chooseMultiple(codes: string[]) {
	const start = props.draft.items.length;
	for (const code of codes) if (!(await choose(code, false))) return;
	pickerOpen.value = false;
	search.value = "";
	incompleteOnly.value = false;
	await nextTick();
	const line = props.draft.items[start];
	if (line) await revealIssue({ message: "", lineId: line.id, field: "qty" });
}
function pick(lines: AllocationLine[] = []) {
	createFromBarcode.value = undefined;
	pickerLines.value = lines;
	pickerOpen.value = true;
}
function remove(line: AllocationLine) {
	props.draft.items.splice(props.draft.items.indexOf(line), 1);
	if (scannedLine.value?.id === line.id) {
		scannedLine.value = undefined;
		scanConfiguring.value = false;
	}
}
function splitOutcome(line: AllocationLine) {
	props.draft.items.push({
		...line,
		name: undefined,
		localId: crypto.randomUUID(),
		id: `${line.id}-outcome-${++sequence}`,
		qty: 1,
		entryQty: 1 / (line.conversionFactor || 1),
		returnOutcome: "returned",
	});
}
function addBatch(line: AllocationLine) {
	props.draft.items.push({
		...line,
		name: undefined,
		localId: crypto.randomUUID(),
		id: `${line.id}-batch-${++sequence}`,
		qty: 1,
		entryQty: 1 / (line.conversionFactor || 1),
		batch: "",
		expiry: "",
	});
}
function changeSource(line: AllocationLine) {
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
function changeBatch(line: AllocationLine) {
	line.nativeBundle = line.recordedBundle = undefined;
	line.batchAllocations = undefined;
	const batch = lineStock(line)?.batches?.find((batch) => batch.id === line.batch);
	line.expiry = batch?.expiry || "";
}
</script>

<template>
	<AllocationSummary v-if="mode === 'display'" :draft="draft" />
	<template v-else>
		<div ref="root" class="preview-operation-lines" @focusout="regroupAfterFocus">
			<div class="preview-line-toolbar">
				<UiButton :aria-pressed="!!expanded" @click="emit('expand')">{{
					expanded ? "收起工作区" : "展开工作区"
				}}</UiButton>
				<UiButton
					v-if="!disabled && !settlement"
					variant="secondary"
					icon="box"
					@click="pick()"
					>添加物品</UiButton
				>
				<label class="preview-inline-field preview-line-search"
					>搜索明细<input
						v-model="search"
						type="search"
						placeholder="物品名称、编号、库位或批次"
				/></label>
				<span role="status"
					>{{ itemCount }} 种物品 · {{ draft.items.length }} 行分配 · {{ totals }}</span
				>
				<label class="preview-choice-label"
					><input v-model="incompleteOnly" type="checkbox" />仅看待完善</label
				>
				<UiButton :disabled="!lineIssues.length" @click="nextIssue"
					>{{ lineIssues.length }} 处待完善 · 下一个</UiButton
				>
				<span v-if="search || incompleteOnly" role="status"
					>显示 {{ visibleIds.size }} / {{ draft.items.length }} 行</span
				>

				<ScanPanel
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
			<p v-if="selectionError" role="alert">{{ selectionError }}</p>
			<p v-if="scanConfiguring && scanError" role="status">{{ scanError }}</p>
			<UiButton
				v-if="scanConfiguring"
				:disabled="!!scanError"
				@click="scanConfiguring = false"
				>配置完成，继续扫描</UiButton
			>
			<SearchSelect
				v-if="receive && !disabled"
				label="新增物品的入库位置"
				v-model="destination"
				:options="
					places.map((name) => ({
						value: name,
						label: warehouseLabel(name, reference.warehouses),
					}))
				"
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
					{{
						group.location
							? warehouseLabel(group.location, reference.warehouses)
							: "未选择库位"
					}}
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
								<ItemImage :item="stockItem(line.code)!" />
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
							<SearchSelect
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
							<SearchSelect
								v-if="!receive && !settlement"
								data-field="sourceLocation"
								label="来源库位"
								v-model="line.sourceLocation"
								:disabled="disabled"
								:options="
									stockItem(line.code)?.locations.map((row) => ({
										value: row.location,
										label: warehouseLabel(
											row.location,
											reference.warehouses,
											row.label,
										),
										detail: `可用 ${row.available} · 损坏 ${row.damaged}`,
									})) || []
								"
								@update:model-value="changeSource(line)"
							/>
							<SearchSelect
								v-if="
									receive ||
									['Transfer', 'Return', 'Repair'].includes(draft.kind)
								"
								data-field="location"
								label="目标 / 存放库位"
								v-model="line.location"
								:disabled="disabled"
								:options="
									places.map((name) => ({
										value: name,
										label: warehouseLabel(name, reference.warehouses),
									}))
								"
							/>
						</div>
						<div class="allocation-context">
							<small v-if="stockItem(line.code)?.tracksBatch"
								>批次
								{{
									line.batch ||
									(line.batchAllocations?.length
										? line.batchAllocations
												.map(
													(row) => `${row.batch} ${row.qty} ${line.uom}`,
												)
												.join(" / ")
										: receive
											? "自动生成"
											: "待选择")
								}}</small
							>
							<small v-if="stockItem(line.code)?.tracksExpiry"
								>到期 {{ line.expiry || "待填写" }}</small
							>
							<small v-if="settlement"
								>借出 {{ line.loanName || draft.loanName }} / 原明细
								{{ line.originalLoanLine || "未记录" }} ·
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
							<UiButton
								variant="secondary"
								:aria-label="`${stockItem(line.code)?.name}详情`"
								@click="showDetails(line)"
								>详情</UiButton
							>
							<UiButton
								v-if="!disabled"
								variant="ghost"
								:aria-label="`移除${stockItem(line.code)?.name}明细`"
								@click="remove(line)"
								>移除</UiButton
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
			<AllocationDetails
				v-if="detailsLine && stockItem(detailsLine.code)"
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
			<p v-if="!draft.items.length" class="muted">
				{{ settlement ? "请先选择未结清借用记录。" : "选择库位后添加物品。" }}
			</p>
			<ItemPicker
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
				@item-loaded="context.remember"
				@notify="emit('notify', $event)"
			/>
		</div>
	</template>
</template>
