<script setup lang="ts">
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import AllocationDetails from "./AllocationDetails.vue";
import AllocationSummary from "./AllocationSummary.vue";
import {
	recordConversion,
	enteredQty,
	setEnteredQty,
	applyLineConversion,
} from "../../lib/quantityConversion";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import { computed, ref, nextTick, watch, onDeactivated, onBeforeUnmount } from "vue";
import { useOperationContext, type OperationDraft, type AllocationLine } from "./operationModel";
import { useReferenceData } from "../../services/contracts";
const context = useOperationContext();
const reference = useReferenceData();

import { isSettlement, type OperationIssue } from "./operationModel";
const { lineStock, lineCapacity } = context;
const operationIssues = context.issues;
import ItemImage from "../../components/ItemImage.vue";
import ItemPicker, { type ItemScanOption, type ItemScanResolution } from "../items/ItemPicker.vue";
import type { StockItem } from "../../lib/stockPresentation";
import UiButton from "../../components/ui/UiButton.vue";
import { operationLabels } from "./operationCodec";

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
const emit = defineEmits<{ expand: [] }>();
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
const scanWarehouse = ref("");
const scanFeedback = ref("");
const scanResolution = ref<ItemScanResolution>();
const scanUndo: Array<{
	lineId: string;
	code: string;
	source: string;
	destination: string;
	batch: string;
	uom: string;
	conversionFactor: number;
	beforeQty: number;
	afterQty: number;
	created: boolean;
}> = [];
const scanUndoRevision = ref(0);
const scannedLineIds = ref(new Set<string>());
const canUndoScan = computed(() => {
	void scanUndoRevision.value;
	const latest = scanUndo.at(-1);
	return Boolean(latest && props.draft.items.some((line) => line.id === latest.lineId));
});
type ScanContextSnapshot = {
	activeWarehouse?: string;
	destination?: string;
	timestamp?: string;
};
type PendingScanResolution = {
	item: StockItem;
	batch?: string;
	context: ScanContextSnapshot;
	resolve: () => void;
};
type ScanAllocationPreference = {
	source: string;
	batch: string;
	destination: string;
};
let scanGeneration = 0;
let pendingScanResolution: PendingScanResolution | undefined;
const scanAllocationPreferences = new Map<string, ScanAllocationPreference>();
const scanAffectedLines = computed(() => {
	void scanUndoRevision.value;
	return props.draft.items
		.filter((line) => scannedLineIds.value.has(line.id))
		.map((line) => ({
			id: line.id,
			code: line.code,
			name: stockItem(line.code)?.name || line.code,
			qty: Number(line.qty || 0),
			uom: line.uom,
			warehouse: receive.value ? line.location : line.sourceLocation || line.location,
			batch: String(line.batch || ""),
		}))
		.sort(
			(left, right) =>
				(recency.get(right.id || "") || 0) - (recency.get(left.id || "") || 0),
		);
});
const scanDestination = computed(() =>
	props.draft.kind === "Loan" ? String(props.draft.loanDestination || "") : destination.value,
);
const scanDestinationLabel = computed(() =>
	props.draft.kind === "Receive"
		? "入库位置"
		: props.draft.kind === "Loan"
			? "借用去向"
			: ["Transfer", "Repair"].includes(props.draft.kind)
				? "目标库位"
				: "",
);
const scanDestinationOptions = computed<ItemScanOption[]>(() => {
	const source = scanWarehouse.value || String(props.draft.preferredWarehouse || "");
	return destinationChoices(source).map((name) => ({
		value: name,
		label: warehouseLabel(name, reference.warehouses),
		detail: warehousePath(name, reference.warehouses),
	}));
});
const activeScanWarehouse = computed(() =>
	receive.value
		? destination.value
		: scanWarehouse.value || String(props.draft.preferredWarehouse || ""),
);
let scanRecency = 0;
const recency = new Map<string, number>();
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
	() => [props.active, props.disabled],
	([active, disabled]) => {
		if (active === false || disabled === true) {
			detailsLine.value = undefined;
			cancelPendingScans();
		}
	},
);
onDeactivated(() => {
	detailsLine.value = undefined;
	cancelPendingScans();
});
onBeforeUnmount(cancelPendingScans);
watch(pickerOpen, (open, wasOpen) => {
	if (wasOpen && !open) cancelPendingScans();
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
	return [...grouped.values()]
		.map((group) => ({
			...group,
			lines: [...group.lines].sort(
				(a, b) => (recency.get(b.id) || 0) - (recency.get(a.id) || 0),
			),
			recent: Math.max(...group.lines.map((line) => recency.get(line.id) || 0)),
		}))
		.sort(
			(a, b) =>
				b.recent - a.recent ||
				locations.indexOf(a.location) - locations.indexOf(b.location),
		);
});
function markRecent(line: AllocationLine) {
	scanRecency++;
	recency.set(line.id, scanRecency);
	groupRevision.value++;
}
function scanCapacity(code: string, source: string, batch = "") {
	const item = stockItem(code);
	if (!item || !source) return 0;
	const probe: AllocationLine = {
		id: "scan-capacity",
		localId: "scan-capacity",
		code,
		qty: 0,
		uom: item.uom,
		entryUom: item.uom,
		entryQty: 0,
		conversionFactor: 1,
		location: source,
		sourceLocation: source,
		batch,
	};
	const alreadyRequested = props.draft.items
		.filter(
			(line) =>
				line.code === code &&
				(line.sourceLocation || line.location) === source &&
				!line.loanName &&
				!line.originalLoanLine &&
				!line.returnOutcome,
		)
		.reduce((total, line) => {
			if (line.batchAllocations?.length)
				return (
					total +
					line.batchAllocations
						.filter((allocation) => allocation.batch === batch)
						.reduce((sum, allocation) => sum + Number(allocation.qty || 0), 0)
				);
			if (item.tracksBatch && String(line.batch || "") !== batch) return total;
			return total + Number(line.qty || 0);
		}, 0);
	return Math.max(0, lineCapacity(props.draft, probe) - alreadyRequested);
}
function destinationChoices(source: string) {
	if (!["Receive", "Transfer", "Repair", "Loan"].includes(props.draft.kind)) return [];
	const candidates = props.draft.kind === "Loan" ? reference.leasedLeaves : places.value;
	return ["Transfer", "Repair"].includes(props.draft.kind)
		? candidates.filter((name) => name !== source)
		: candidates;
}
function snapshotDestination(context: ScanContextSnapshot) {
	return (
		context.destination ||
		(props.draft.kind === "Loan"
			? String(props.draft.loanDestination || "")
			: destination.value)
	);
}
function scanPreferenceKey(code: string, activeWarehouse: string, target: string) {
	return `${code}\u0000${activeWarehouse}\u0000${target}`;
}
function destinationContext(target: string) {
	return ["Receive", "Transfer", "Repair", "Loan"].includes(props.draft.kind) ? target : "";
}
function scanResolutionFor(
	item: StockItem,
	scannedBatch: string | undefined,
	context: ScanContextSnapshot,
): { resolution?: ItemScanResolution; source: string; batch: string; destination: string } {
	const receiving = receive.value;
	const sourcePairs: Array<{ source: string; batch: string; available: number }> = [];
	const activeSource =
		context.activeWarehouse ||
		scanWarehouse.value ||
		String(props.draft.preferredWarehouse || "");
	const defaultDestination = snapshotDestination(context);
	const activeWarehouse = receiving ? activeSource || defaultDestination : activeSource;
	const targetContext = destinationContext(defaultDestination);
	const remembered = scanAllocationPreferences.get(
		scanPreferenceKey(item.code, activeWarehouse, targetContext),
	);
	const preference =
		remembered && (!scannedBatch || scannedBatch === remembered.batch)
			? remembered
			: undefined;
	if (!receiving) {
		for (const place of item.locations) {
			if (activeSource && place.location !== activeSource) continue;
			const batches = item.tracksBatch
				? (place.batches || []).filter((row) => !scannedBatch || row.id === scannedBatch)
				: [undefined];
			for (const batch of batches) {
				const available = scanCapacity(item.code, place.location, batch?.id || "");
				if (available >= 1)
					sourcePairs.push({
						source: place.location,
						batch: batch?.id || "",
						available,
					});
			}
		}
	}
	const sourceValues = [...new Set(sourcePairs.map((row) => row.source))];
	const preferredSourceAvailable = Boolean(
		preference && sourceValues.includes(preference.source),
	);
	const defaultSource = preference
		? preferredSourceAvailable
			? preference.source
			: ""
		: sourceValues.length === 1
			? sourceValues[0]!
			: "";
	const selectedPairs = defaultSource
		? sourcePairs.filter((row) => row.source === defaultSource)
		: sourcePairs;
	const batchIds = [...new Set(selectedPairs.map((row) => row.batch).filter(Boolean))];
	const preferredBatchAvailable = Boolean(
		preference &&
		preferredSourceAvailable &&
		selectedPairs.some(
			(row) => row.source === preference.source && row.batch === preference.batch,
		),
	);
	const defaultBatch = preference
		? preferredBatchAvailable
			? preference.batch
			: ""
		: scannedBatch && batchIds.includes(scannedBatch)
			? scannedBatch
			: batchIds.length === 1
				? batchIds[0]!
				: "";
	const sourceOptions = sourceValues.map((source) => {
		const available = sourcePairs
			.filter((row) => row.source === source)
			.reduce((total, row) => total + row.available, 0);
		return {
			value: source,
			label: warehouseLabel(source, reference.warehouses),
			available,
			detail: `${warehousePath(source, reference.warehouses)} · 可用 ${available} ${item.uom}`,
		};
	});
	const batchOptions = selectedPairs.map((row) => ({
		value: row.batch,
		label: row.batch,
		detail: `可用 ${row.available} ${item.uom}`,
		source: row.source,
		available: row.available,
	}));
	const destinationValues = destinationChoices(defaultSource);
	const preferredDestinationAvailable = Boolean(
		preference && destinationValues.includes(preference.destination),
	);
	const validDestination = preference
		? preferredDestinationAvailable
			? preference.destination
			: ""
		: destinationValues.includes(defaultDestination)
			? defaultDestination
			: destinationValues.length === 1
				? destinationValues[0]!
				: "";
	const sourceRequired =
		!receiving && (preference ? !preferredSourceAvailable : sourceValues.length !== 1);
	const batchRequired =
		!receiving &&
		item.tracksBatch &&
		(preference ? !preferredBatchAvailable : batchIds.length !== 1);
	const destinationRequired = ["Receive", "Transfer", "Repair", "Loan"].includes(
		props.draft.kind,
	);
	const rememberedAllocationInvalid = Boolean(
		preference &&
		(!preferredSourceAvailable ||
			(item.tracksBatch && !preferredBatchAvailable) ||
			(destinationRequired && !preferredDestinationAvailable)),
	);
	const unresolved =
		sourceRequired ||
		batchRequired ||
		(destinationRequired && !validDestination) ||
		rememberedAllocationInvalid ||
		(!receiving && sourceValues.length === 0);
	return {
		source: receiving ? "" : defaultSource,
		batch: receiving ? scannedBatch || "" : defaultBatch,
		destination: validDestination,
		resolution: unresolved
			? {
					code: item.code,
					name: item.name,
					uom: item.uom,
					sourceOptions,
					batchOptions,
					destinationOptions: destinationValues.map((name) => ({
						value: name,
						label: warehouseLabel(name, reference.warehouses),
						detail: warehousePath(name, reference.warehouses),
					})),
					defaultSource,
					defaultBatch: receiving ? scannedBatch || "" : defaultBatch,
					defaultDestination: validDestination,
					sourceRequired,
					batchRequired,
					destinationRequired,
					destinationExcludesSource: ["Transfer", "Repair"].includes(props.draft.kind),
				}
			: undefined,
	};
}
function scanLineDestination(source: string, destinationName: string) {
	if (receive.value) return destinationName || destination.value;
	if (["Transfer", "Repair"].includes(props.draft.kind)) return destinationName;
	if (props.draft.kind === "Loan") return source;
	return source;
}
function compatibleScanLine(
	line: AllocationLine,
	item: StockItem,
	source: string,
	destinationName: string,
	batch: string,
) {
	const lineDestination =
		props.draft.kind === "Loan"
			? String(line.loanedLocation || props.draft.loanDestination || "")
			: line.location;
	return (
		line.code === item.code &&
		(line.sourceLocation || (receive.value ? "" : line.location)) === source &&
		lineDestination === destinationName &&
		String(line.batch || "") === batch &&
		line.uom === item.uom &&
		(line.entryUom || line.uom) === item.uom &&
		Number(line.conversionFactor || 1) === 1 &&
		!line.nativeBundle &&
		!line.recordedBundle &&
		!line.loanName &&
		!line.originalLoanLine &&
		!line.returnOutcome &&
		!line.batchAllocations?.length
	);
}
function addScannedLine(item: StockItem, batch: string, source: string, destinationName: string) {
	const lineDestination = scanLineDestination(source, destinationName);
	const mergeDestination = props.draft.kind === "Loan" ? destinationName : lineDestination;
	let line = props.draft.items.find((candidate) =>
		compatibleScanLine(candidate, item, source, mergeDestination, batch),
	);
	const created = !line;
	const beforeQty = line ? Number(line.qty || 0) : 0;
	if (!line) {
		const id = crypto.randomUUID();
		const origin = receive.value ? "" : source;
		line = {
			id,
			localId: id,
			code: item.code,
			qty: 0,
			uom: item.uom,
			entryUom: item.uom,
			entryQty: 0,
			conversionFactor: 1,
			location: lineDestination,
			sourceLocation: origin,
			...(props.draft.kind === "Loan" ? { loanedLocation: destinationName } : {}),
			batch,
			expiry:
				item.locations
					.flatMap((place) => place.batches || [])
					.find((row) => row.id === batch)?.expiry || "",
		};
		props.draft.items.push(line);
	}
	line.qty = beforeQty + 1;
	line.entryQty = beforeQty + 1;
	line.entryUom = item.uom;
	line.conversionFactor = 1;
	scanUndo.push({
		lineId: line.id,
		code: item.code,
		source,
		destination: lineDestinationForUndo(line),
		batch,
		uom: item.uom,
		conversionFactor: 1,
		beforeQty,
		afterQty: beforeQty + 1,
		created,
	});
	scanUndoRevision.value++;
	const nextAffected = new Set(scannedLineIds.value);
	nextAffected.add(line.id);
	scannedLineIds.value = nextAffected;
	markRecent(line);
	const warehouse = receive.value
		? lineDestination
		: ["Transfer", "Repair"].includes(props.draft.kind)
			? `${source} → ${lineDestination}`
			: source;
	scanFeedback.value = `已扫描添加 ${item.name} ×1 ${item.uom}${warehouse ? ` · ${warehouseLabel(warehouse, reference.warehouses, warehouse)}` : ""}`;
}
function activeScanContext(value: unknown): ScanContextSnapshot {
	return value && typeof value === "object" ? (value as ScanContextSnapshot) : {};
}
function cancelPendingScans() {
	scanGeneration++;
	scanAllocationPreferences.clear();
	const pending = pendingScanResolution;
	pendingScanResolution = undefined;
	scanResolution.value = undefined;
	if (pending) pending.resolve();
}
function scanSessionIsCurrent(generation: number) {
	return (
		generation === scanGeneration &&
		pickerOpen.value &&
		props.active !== false &&
		!props.disabled
	);
}
async function acceptScannedItem(code: string, batch?: string, captured?: unknown) {
	if (props.disabled || !pickerOpen.value || props.active === false) return;
	const generation = scanGeneration;
	const scanContext = activeScanContext(captured);
	const item = await context.ensure(code);
	if (!scanSessionIsCurrent(generation)) return;
	const prepared = scanResolutionFor(item, batch, scanContext);
	if (prepared.resolution) {
		scanResolution.value = prepared.resolution;
		await new Promise<void>((resolve) => {
			pendingScanResolution = { item, batch, context: scanContext, resolve };
		});
		return;
	}
	const destinationName = prepared.destination;
	if (receive.value && !places.value.includes(destinationName))
		throw new Error("请选择有效的入库库位");
	if (!receive.value && scanCapacity(item.code, prepared.source, prepared.batch) < 1)
		throw new Error("当前库位或批次可用量不足 1 个库存单位");
	applyScanDestination(destinationName);
	addScannedLine(item, prepared.batch, prepared.source, destinationName);
}
function applyScanDestination(destinationName: string) {
	if (!destinationName) return;
	if (props.draft.kind === "Loan") props.draft.loanDestination = destinationName;
	else if (["Receive", "Transfer", "Repair"].includes(props.draft.kind))
		destination.value = destinationName;
}
function resolveScannedItem(selection: {
	code: string;
	source: string;
	batch: string;
	destination: string;
}) {
	const pending = pendingScanResolution;
	const item = pending?.item;
	if (
		!pending ||
		!item ||
		selection.code !== item.code ||
		!pickerOpen.value ||
		props.active === false ||
		props.disabled
	)
		return;
	const { source, batch, destination: target } = selection;
	const allowedSource = receive.value
		? ""
		: pending.context.activeWarehouse ||
			scanWarehouse.value ||
			String(props.draft.preferredWarehouse || "");
	if (receive.value) {
		if (source || !places.value.includes(target)) return;
	} else {
		const place = item.locations.find((row) => row.location === source);
		if (!place || (allowedSource && source !== allowedSource)) return;
		const validBatches = item.tracksBatch
			? (place.batches || [])
					.filter((row) => !pending.batch || row.id === pending.batch)
					.filter((row) => scanCapacity(item.code, source, row.id) >= 1)
					.map((row) => row.id)
			: [""];
		if (!validBatches.includes(batch) || scanCapacity(item.code, source, batch) < 1) return;
	}
	const destinations = destinationChoices(source);
	const requiresDestination = ["Receive", "Transfer", "Repair", "Loan"].includes(
		props.draft.kind,
	);
	if (requiresDestination ? !destinations.includes(target) : Boolean(target)) return;
	if (["Transfer", "Repair"].includes(props.draft.kind) && target === source) return;
	if (!receive.value) scanWarehouse.value = source;
	applyScanDestination(target);
	addScannedLine(item, batch || pending.batch || "", source, target);
	const activeWarehouse = receive.value ? target : source;
	scanAllocationPreferences.set(
		scanPreferenceKey(item.code, activeWarehouse, destinationContext(target)),
		{ source, batch: batch || pending.batch || "", destination: destinationContext(target) },
	);
	scanResolution.value = undefined;
	pendingScanResolution = undefined;
	pending.resolve();
}
function cancelScannedItem() {
	const pending = pendingScanResolution;
	if (!pending) return;
	scanFeedback.value = `已取消 ${pending.item.name} 的本次扫描`;
	scanResolution.value = undefined;
	pendingScanResolution = undefined;
	pending.resolve();
}
function setScanWarehouse(name: string) {
	if (receive.value) destination.value = name;
	else scanWarehouse.value = name;
	scanFeedback.value = `当前扫描库位：${warehouseLabel(name, reference.warehouses, name)}`;
}
function setScanDestination(name: string) {
	if (props.draft.kind === "Loan") props.draft.loanDestination = name;
	else destination.value = name;
}
function finishPickerScan() {
	if (!pickerLines.value.length) pickerOpen.value = false;
}
function undoLatestScan() {
	const latest = scanUndo.at(-1);
	const line = props.draft.items.find((candidate) => candidate.id === latest?.lineId);
	if (!latest || !line) {
		if (latest) {
			scanUndo.pop();
			scanUndoRevision.value++;
		}
		return;
	}
	const sameAllocation =
		line.code === latest.code &&
		(line.sourceLocation || (receive.value ? "" : line.location)) === latest.source &&
		lineDestinationForUndo(line) === latest.destination &&
		String(line.batch || "") === latest.batch &&
		line.uom === latest.uom &&
		Number(line.conversionFactor || 1) === latest.conversionFactor &&
		!line.nativeBundle &&
		!line.recordedBundle &&
		!line.loanName &&
		!line.originalLoanLine &&
		!line.returnOutcome &&
		!line.batchAllocations?.length;
	if (
		!sameAllocation ||
		Number(line.qty || 0) !== latest.afterQty ||
		Number(line.entryQty || 0) !== latest.afterQty ||
		String(line.entryUom || line.uom) !== latest.uom
	) {
		scanFeedback.value = "最近扫描对应的数量或分配已更改；为保留你的编辑，无法撤销。";
		return;
	}
	scanUndo.pop();
	scanUndoRevision.value++;
	if (latest.created && latest.beforeQty === 0 && latest.afterQty === 1) {
		if (
			Object.keys(line).some(
				(key) =>
					![
						"id",
						"localId",
						"name",
						"code",
						"displayName",
						"displayImage",
						"displayTracksBatch",
						"displayTracksExpiry",
						"qty",
						"uom",
						"entryUom",
						"entryQty",
						"conversionFactor",
						"location",
						"sourceLocation",
						"loanedLocation",
						"batch",
						"expiry",
					].includes(key),
			)
		) {
			scanFeedback.value = "此扫描行已添加其他资料；为保留编辑，无法删除整行。";
			scanUndo.push(latest);
			scanUndoRevision.value++;
			return;
		}
		props.draft.items.splice(props.draft.items.indexOf(line), 1);
		scannedLineIds.value = new Set([...scannedLineIds.value].filter((id) => id !== line.id));
	} else {
		line.qty = latest.beforeQty;
		line.entryQty = latest.beforeQty;
	}
	scanFeedback.value = "已撤销最近扫描";
}
function lineDestinationForUndo(line: AllocationLine) {
	return props.draft.kind === "Loan"
		? String(line.loanedLocation || props.draft.loanDestination || "")
		: line.location;
}
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
async function choose(code: string, closePicker = true, selectedWarehouse = "") {
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
		line.code = code;
		refreshLine(line);
		if (selectedWarehouse) {
			if (receive.value) line.location = selectedWarehouse;
			else {
				line.sourceLocation = selectedWarehouse;
				if (["Transfer", "Repair"].includes(props.draft.kind)) {
					if (line.location === selectedWarehouse) line.location = "";
				} else line.location = selectedWarehouse;
			}
			if (receive.value) changeBatch(line);
			else changeSource(line);
		}
	}
	if (closePicker) pickerOpen.value = false;
	pickerLines.value = [];
	return true;
}
async function selectSingle(selection: { code: string; warehouse: string }) {
	await choose(selection.code, true, selection.warehouse);
}
async function chooseMultiple(selections: { code: string; warehouse: string }[]) {
	const start = props.draft.items.length;
	for (const selection of selections)
		if (!(await choose(selection.code, false, selection.warehouse))) return;
	pickerOpen.value = false;
	search.value = "";
	incompleteOnly.value = false;
	await nextTick();
	const line = props.draft.items[start];
	if (line) await revealIssue({ message: "", lineId: line.id, field: "qty" });
}
function pick(lines: AllocationLine[] = []) {
	pickerLines.value = lines;
	pickerOpen.value = true;
}
function remove(line: AllocationLine) {
	props.draft.items.splice(props.draft.items.indexOf(line), 1);
	recency.delete(line.id);
	for (let index = scanUndo.length - 1; index >= 0; index--)
		if (scanUndo[index]?.lineId === line.id) scanUndo.splice(index, 1);
	scanUndoRevision.value++;
	scannedLineIds.value = new Set([...scannedLineIds.value].filter((id) => id !== line.id));
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
				<SearchSelect
					v-if="receive && !disabled"
					class="preview-receive-target preview-inline-field"
					label="入库位置"
					v-model="destination"
					:clearable="false"
					:options="
						places.map((name) => ({
							value: name,
							label: warehouseLabel(name, reference.warehouses),
							detail: warehousePath(name, reference.warehouses),
						}))
					"
				/>
				<UiButton
					v-if="!disabled && !settlement"
					variant="secondary"
					icon="box"
					data-field="items"
					@click="pick()"
					>添加物品</UiButton
				>
				<label class="preview-inline-field preview-line-search"
					>搜索明细<input
						v-model="search"
						type="search"
						placeholder="物品名称、编号、库位或批次"
				/></label>
				<div class="preview-line-toolbar-status">
					<span role="status"
						>{{ itemCount }} 种物品 · {{ draft.items.length }} 条明细 ·
						{{ totals }}</span
					>
					<label class="preview-choice-label"
						><input v-model="incompleteOnly" type="checkbox" />仅看待完善</label
					>
					<UiButton :disabled="!lineIssues.length" @click="nextIssue"
						>{{ lineIssues.length }} 处待完善 · 下一个</UiButton
					>
				</div>
				<span v-if="search || incompleteOnly" role="status"
					>显示 {{ visibleIds.size }} / {{ draft.items.length }} 行</span
				>
			</div>
			<p v-if="selectionError && !pickerOpen" role="alert">
				{{ selectionError }}
			</p>
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
					:title="
						group.location
							? warehousePath(group.location, reference.warehouses)
							: undefined
					"
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
									>{{ line.code
									}}<template v-if="stockItem(line.code)?.category">
										· {{ stockItem(line.code)?.category }}</template
									></small
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
										detail: `${warehousePath(row.location, reference.warehouses)} · 可用 ${row.available} · 损坏 ${row.damaged}`,
									})) || []
								"
								:invalid="
									(showError || revealErrors) &&
									lineIssues.some(
										(issue) =>
											issue.lineId === line.id &&
											issue.field === 'sourceLocation',
									)
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
										detail: warehousePath(name, reference.warehouses),
									}))
								"
								:invalid="
									(showError || revealErrors) &&
									lineIssues.some(
										(issue) =>
											issue.lineId === line.id && issue.field === 'location',
									)
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
								>借出 {{ line.loanName || draft.loanName }} ·
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
							class="notice-bar warning allocation-error"
							role="alert"
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
				:context="operationLabels[draft.kind] + ' · ' + (draft.name || '')"
				:timestamp="context.timestamp()"
				:scan-mode="pickerLines.length ? 'selection' : 'operation'"
				:scan-feedback="scanFeedback"
				:scan-error="selectionError"
				:can-undo-scan="canUndoScan"
				:active-warehouse="activeScanWarehouse"
				:scan-resolution="scanResolution"
				:scan-lines="scanAffectedLines"
				:scan-destination="scanDestination"
				:scan-destination-label="scanDestinationLabel"
				:scan-destination-options="scanDestinationOptions"
				:on-operation-scan="acceptScannedItem"
				:eligible="eligible"
				:purpose="
					receive
						? 'inbound'
						: ['Repair', 'Disposal'].includes(draft.kind)
							? 'damaged'
							: 'outbound'
				"
				:receiving-warehouse="receive ? destination : undefined"
				@close="
					pickerOpen = false;
					pickerLines = [];
				"
				@select="selectSingle"
				@select-multiple="chooseMultiple"
				@item-loaded="context.remember"
				@scan-location="setScanWarehouse"
				@scan-destination="setScanDestination"
				@finish-scan="finishPickerScan"
				@undo-scan="undoLatestScan"
				@resolve-scan="resolveScannedItem"
				@cancel-scan-resolution="cancelScannedItem"
			/>
		</div>
	</template>
</template>
