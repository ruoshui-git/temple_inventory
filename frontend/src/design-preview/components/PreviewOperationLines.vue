<script setup lang="ts">
import { computed, ref } from "vue";
import { reviewSession, type ReviewDraft, type DraftLine } from "../reviewModel";
import { previewDate } from "../model";
import { isSettlement, lineCapacity, lineStock } from "../formModel";
import PreviewItemImage from "../PreviewItemImage.vue";
import PreviewItemPicker from "./PreviewItemPicker.vue";
import PreviewUiButton from "./PreviewUiButton.vue";

const props = defineProps<{ draft: ReviewDraft; disabled?: boolean; showError?: boolean }>();
const emit = defineEmits<{ notify: [message: string] }>();
const receive = computed(() => props.draft.kind === "Receive");
const reconcile = computed(() => props.draft.kind === "Reconcile");
const settlement = computed(() => isSettlement(props.draft));
const places = computed(() =>
	reviewSession.warehouses
		.filter(
			(row) =>
				!row.is_group &&
				row.status === "active" &&
				!["借出", "损坏待处理"].includes(row.parent || ""),
		)
		.map((row) => row.name),
);
const destination = ref(places.value[0] || "");
const pickerLines = ref<DraftLine[]>([]);
const pickerOpen = ref(false);
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
		const key = `${location}/${line.code}`;
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
		const current = lineStock(line);
		const location =
			current ||
			item.locations.find((row) =>
				["Repair", "Disposal"].includes(props.draft.kind)
					? row.damaged > 0
					: row.available > 0,
			) ||
			item.locations[0];
		line.sourceLocation = location?.location || places.value[0];
		if (!["Transfer", "Repair"].includes(props.draft.kind))
			line.location = line.sourceLocation;
		const batch = location?.batches?.find(
			(batch) =>
				!["Repair", "Disposal"].includes(props.draft.kind) || (batch.damaged || 0) > 0,
		);
		line.batch = item.tracksBatch ? batch?.id || "" : "";
		line.expiry = item.tracksExpiry ? batch?.expiry || "" : "";
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
	pickerLines.value = lines;
	pickerOpen.value = true;
}
function remove(line: DraftLine) {
	props.draft.lines.splice(props.draft.lines.indexOf(line), 1);
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
	const batch = lineStock(line)?.batches?.find(
		(batch) => !["Repair", "Disposal"].includes(props.draft.kind) || (batch.damaged || 0) > 0,
	);
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
		<label v-if="receive && !disabled" class="field"
			>新增物品的入库位置<select v-model="destination">
				<option v-for="place in places" :key="place">{{ place }}</option>
			</select></label
		>
		<section
			v-for="group in groups"
			:key="`${group.location}/${group.code}`"
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
					<div class="form-fields">
						<label v-if="!receive && !settlement && !reconcile"
							>来源库位<select
								v-model="line.sourceLocation"
								:disabled="disabled"
								@change="changeSource(line)"
							>
								<option
									v-for="place in stockItem(line.code)?.locations.filter(
										(row) =>
											['Repair', 'Disposal'].includes(draft.kind)
												? row.damaged > 0
												: row.available > 0,
									)"
									:key="place.location"
								>
									{{ place.location }}
								</option>
							</select></label
						>
						<label
							v-if="
								receive ||
								reconcile ||
								['Transfer', 'Return', 'Repair'].includes(draft.kind)
							"
							>{{ reconcile ? "盘点库位" : "目标 / 存放库位"
							}}<select
								v-model="line.location"
								:disabled="disabled || line.returnOutcome === 'lost'"
								@change="
									reconcile &&
									((line.sourceLocation = line.location), changeSource(line))
								"
							>
								<option v-for="place in places" :key="place">{{ place }}</option>
							</select></label
						>
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
							<label
								>批次编号<input
									v-if="receive"
									v-model="line.batch"
									placeholder="留空自动生成"
									:disabled="disabled"
									:aria-label="`${stockItem(line.code)?.name}批次编号（可选）`"
								/><span v-else-if="settlement">{{
									line.batch || "原借用未记录批次"
								}}</span
								><select
									v-else
									v-model="line.batch"
									placeholder="留空自动生成"
									:disabled="disabled"
									@change="changeBatch(line)"
								>
									<option value="">选择现有批次</option>
									<option
										v-for="batch in lineStock(line)?.batches?.filter(
											(batch) =>
												reconcile ||
												(['Repair', 'Disposal'].includes(draft.kind)
													? (batch.damaged || 0) > 0
													: batch.available > 0),
										)"
										:key="batch.id"
										:value="batch.id"
									>
										{{ batch.id }} ·
										{{
											["Repair", "Disposal"].includes(draft.kind)
												? "损坏"
												: "可用"
										}}
										{{
											["Repair", "Disposal"].includes(draft.kind)
												? batch.damaged || 0
												: batch.available
										}}
										{{ line.uom }}
									</option>
								</select></label
							>
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
								<option value="lost">遗失结清</option>
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
			:eligible="eligible"
			@close="pickerOpen = false"
			@select="choose"
			@notify="emit('notify', $event)"
		/>
	</div>
</template>
