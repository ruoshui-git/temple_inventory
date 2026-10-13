<script setup lang="ts">
import PreviewScanPanel from "./PreviewScanPanel.vue";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import { computed, ref } from "vue";
import { reviewSession, type ReviewDraft, type DraftLine } from "../reviewModel";
import { physicalLeafWarehouses } from "../workflowModel";
import { previewDate } from "../model";
import { isSettlement, lineCapacity, lineStock, validateOperation } from "../formModel";
import PreviewItemImage from "../PreviewItemImage.vue";
import PreviewItemPicker from "./PreviewItemPicker.vue";
import PreviewUiButton from "./PreviewUiButton.vue";

const props = defineProps<{ draft: ReviewDraft; disabled?: boolean; showError?: boolean }>();
const emit = defineEmits<{ notify: [message: string] }>();
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
	scannedLine.value ? validateOperation({ ...props.draft, lines: [scannedLine.value] }) : "",
);
function scanItem(code: string, batch?: string) {
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
}
const extras = ref<Record<string, boolean>>({});
const entryFactor = (line: DraftLine) =>
	stockItem(line.code)?.alternateUnits?.find((unit) => unit.uom === line.entryUom)?.factor || 1;
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
const groups = computed(() => {
	const groups = new Map<string, { location: string; code: string; lines: DraftLine[] }>();
	for (const line of props.draft.lines) {
		const location =
			receive.value || reconcile.value || settlement.value
				? line.location
				: line.sourceLocation || line.location;
		const key = `${line.loanName || props.draft.loanName || ""}/${location}/${line.code}`;
		if (!groups.has(key)) groups.set(key, { location, code: line.code, lines: [] });
		groups.get(key)!.lines.push(line);
	}
	return [...groups.values()];
});
let sequence = 0;
function refreshLine(line: DraftLine) {
	const item = stockItem(line.code);
	if (!item) return;
	line.uom = item.uom;
	line.entryUom = undefined;
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
function choose(code: string) {
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
	pickerOpen.value = false;
	pickerLines.value = [];
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
		returnOutcome: "returned",
	});
}
function addBatch(line: DraftLine) {
	props.draft.lines.push({
		...line,
		id: `${line.id}-batch-${++sequence}`,
		qty: 1,
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
	<div class="preview-operation-lines">
		<PreviewScanPanel
			v-if="!disabled && !settlement"
			:allow-create="receive"
			:paused="scanConfiguring || pickerOpen"
			@item="scanItem"
			@location="receive ? (destination = $event) : emit('notify', '选择物品后核对来源库位')"
			@create="
				(barcode) => {
					pick();
					createFromBarcode = barcode;
				}
			"
		/>
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
		<section
			v-for="group in groups"
			:key="`${group.lines[0]?.loanName || draft.loanName || ''}/${group.location}/${group.code}`"
			class="location-group"
		>
			<h3>{{ group.location || "未选择库位" }}</h3>
			<article class="draft-line receive-line">
				<div class="section-title-row">
					<div v-if="stockItem(group.code)" class="preview-group-thumbnail">
						<PreviewItemImage :item="stockItem(group.code)!" />
					</div>
					<div>
						<strong>{{ stockItem(group.code)?.name || group.code }}</strong
						><small class="muted"
							>{{ group.code }} · {{ stockItem(group.code)?.category }}</small
						>
					</div>
					<strong v-if="receive"
						>合计
						{{ group.lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0) }}
						{{ stockItem(group.code)?.uom }}</strong
					>
					<PreviewUiButton
						v-if="!disabled && !settlement"
						variant="ghost"
						@click="pick(group.lines)"
						>更换物品</PreviewUiButton
					>
				</div>
				<div v-for="line in group.lines" :key="line.id" class="preview-allocation">
					<small v-if="settlement" class="muted"
						>借出 {{ line.loanName || draft.loanName }} · 原明细
						{{ (line.loanLineIndex || 0) + 1 }}</small
					>
					<div class="form-fields">
						<PreviewSearchSelect
							v-if="!receive && !settlement && !reconcile"
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
								reconcile ||
								['Transfer', 'Return', 'Repair'].includes(draft.kind)
							"
							label="目标 / 存放库位"
							v-model="line.location"
							:disabled="disabled"
							:options="places"
						/>
						<label v-if="!reconcile"
							>{{
								receive && stockItem(line.code)?.tracksBatch ? "批次数量" : "数量"
							}}（{{ line.uom }}）<input
								v-model.number="line.qty"
								type="number"
								min="0"
								:step="
									reviewSession.units.find((unit) => unit.name === line.uom)
										?.whole
										? '1'
										: 'any'
								"
								:disabled="disabled || !!line.entryUom"
								:aria-invalid="showError && !(line.qty > 0)"
								:aria-label="`${stockItem(line.code)?.name}数量`"
						/></label>
						<template v-if="stockItem(line.code)?.tracksBatch">
							<div class="field">
								批次编号<input
									v-if="receive"
									v-model="line.batch"
									placeholder="留空自动生成"
									:disabled="disabled"
									:aria-label="`${stockItem(line.code)?.name}批次编号（可选）`"
								/><span v-else-if="settlement">{{
									line.batch || "原借用未记录批次"
								}}</span
								><PreviewSearchSelect
									v-else
									label="现有批次"
									v-model="line.batch"
									:disabled="disabled"
									:options="
										(lineStock(line)?.batches || []).map((batch) => ({
											value: batch.id,
											label: batch.id,
											detail: `到期 ${batch.expiry || '无效期'} · 可用 ${batch.available} · 损坏 ${batch.damaged || 0}`,
										}))
									"
									@update:model-value="changeBatch(line)"
								/>
							</div>
							<label v-if="stockItem(line.code)?.tracksExpiry"
								>到期日期<input
									v-if="receive"
									v-model="line.expiry"
									type="date"
									:disabled="disabled"
									:aria-invalid="showError && !line.expiry"
								/><span v-else>{{ line.expiry || "原记录未设置" }}</span></label
							>
						</template>
						<template v-if="reconcile"
							><p>账面 {{ line.qty }} {{ line.uom }}</p>
							<label
								>实点数量<input
									v-model.number="line.countedQty"
									type="number"
									min="0"
									step="any"
									:disabled="disabled"
							/></label>
							<p>
								差异
								{{
									line.countedQty === undefined || String(line.countedQty) === ""
										? "待实点"
										: Number(line.countedQty) - line.qty
								}}
								{{ line.uom }}
							</p>
							<label
								>差异原因<input
									v-model="line.reason"
									:disabled="disabled"
									placeholder="有差异时必填" /></label
						></template>
						<label
							v-if="
								['Damage', 'Loss'].includes(draft.kind) ||
								['damaged', 'lost'].includes(line.returnOutcome || '')
							"
							>原因（可选）<input v-model="line.reason" :disabled="disabled"
						/></label>
						<label v-if="settlement && draft.kind === 'Return'"
							>处理结果<select v-model="line.returnOutcome" :disabled="disabled">
								<option value="returned">完好归还</option>
								<option value="damaged">损坏归还</option>
							</select></label
						>
					</div>
					<template
						v-if="
							!reconcile &&
							!settlement &&
							(receive || stockItem(line.code)?.alternateUnits?.length)
						"
					>
						<PreviewUiButton
							variant="ghost"
							:aria-expanded="!!extras[line.id]"
							@click="extras[line.id] = !extras[line.id]"
							>单位换算 / 补充信息</PreviewUiButton
						>
						<div v-if="extras[line.id]" class="form-fields">
							<template v-if="stockItem(line.code)?.alternateUnits?.length">
								<label
									>输入单位<select v-model="line.entryUom" :disabled="disabled">
										<option :value="undefined">{{ line.uom }}</option>
										<option
											v-for="unit in stockItem(line.code)?.alternateUnits"
											:key="unit.uom"
											:value="unit.uom"
										>
											{{ unit.uom }}（1 {{ unit.uom }} = {{ unit.factor }}
											{{ line.uom }}）
										</option>
									</select></label
								>
								<label v-if="line.entryUom"
									>输入数量（{{ line.entryUom }}）<input
										type="number"
										min="0"
										step="any"
										:disabled="disabled"
										:value="line.qty / entryFactor(line)"
										@input="
											line.qty =
												Number(($event.target as HTMLInputElement).value) *
												entryFactor(line)
										"
								/></label>
								<p v-if="line.entryUom">
									折合 {{ line.qty }} {{ line.uom }}，汇总与可用量按{{
										line.uom
									}}核对。
								</p>
							</template>
							<label v-if="receive && stockItem(line.code)?.tracksBatch"
								>生产日期（可选）<input
									type="date"
									v-model="line.manufacturingDate"
									:disabled="disabled"
							/></label>
						</div>
					</template>
					<p v-if="!receive && !reconcile" class="muted" role="status">
						{{
							settlement
								? "未结清"
								: ["Repair", "Disposal"].includes(draft.kind)
									? "损坏可处理"
									: "可用"
						}}
						{{ lineCapacity(draft, line) }} {{ line.uom
						}}<span v-if="draft.kind === 'Damage' || line.returnOutcome === 'damaged'">
							· 移入损坏待处理</span
						><span v-if="draft.kind === 'Loan'"> · 移入借出库位</span>
					</p>
					<p
						v-if="receive && line.expiry && line.expiry < previewDate"
						class="notice-bar warning"
					>
						此批次已过期，请核对实物。过期本身不阻止入库。
					</p>
					<PreviewUiButton
						v-if="!disabled"
						variant="ghost"
						:label="`移除${stockItem(line.code)?.name}明细`"
						@click="remove(line)"
						>移除明细</PreviewUiButton
					>
				</div>
				<PreviewUiButton
					v-if="
						!settlement &&
						!reconcile &&
						stockItem(group.code)?.tracksBatch &&
						!disabled
					"
					variant="secondary"
					@click="addBatch(group.lines[0])"
					>{{ receive ? "添加批次分配" : "分配其他批次" }}</PreviewUiButton
				><PreviewUiButton
					v-if="settlement && draft.kind === 'Return' && !disabled"
					variant="secondary"
					@click="splitOutcome(group.lines[0])"
					>添加处理分配</PreviewUiButton
				>
			</article>
		</section>
		<PreviewUiButton
			v-if="!disabled && !settlement"
			variant="secondary"
			icon="box"
			@click="pick()"
			>添加物品</PreviewUiButton
		>
		<p v-if="!draft.lines.length" class="muted">
			{{ settlement ? "请先选择未结清借用记录。" : "选择库位后添加物品。" }}
		</p>
		<PreviewItemPicker
			v-if="pickerOpen && !disabled"
			:allow-create="receive"
			:create-barcode="createFromBarcode"
			:eligible="eligible"
			@close="pickerOpen = false"
			@select="choose"
			@notify="emit('notify', $event)"
		/>
	</div>
</template>
