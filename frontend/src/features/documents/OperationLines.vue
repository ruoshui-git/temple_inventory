<script setup lang="ts">
import { warehouseLabel, warehousePath, warehouseSearchText } from "../../lib/warehouseLabel";
import AllocationDetails from "./AllocationDetails.vue";
import AllocationSummary from "./AllocationSummary.vue";
import {
	recordConversion,
	enteredQty,
	setEnteredQty,
	applyLineConversion,
} from "../../lib/quantityConversion";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import FormField from "../../components/ui/FormField.vue";
import Overlay from "../../components/ui/Overlay.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import { computed, ref, nextTick, watch, onDeactivated, onBeforeUnmount, onMounted } from "vue";
import { useOperationContext, type OperationDraft, type AllocationLine } from "./operationModel";
import { useReferenceData, useInventoryServices } from "../../services/contracts";
const context = useOperationContext();
const reference = useReferenceData();
const services = useInventoryServices();

import { isSettlement, type OperationIssue } from "./operationModel";
const { lineStock, lineCapacity } = context;
const operationIssues = context.issues;
import ItemImage from "../../components/ItemImage.vue";
import ItemPicker, { type ItemScanOption, type ItemScanResolution } from "../items/ItemPicker.vue";
import type { StockItem } from "../../lib/stockPresentation";
import UiButton from "../../components/ui/UiButton.vue";
import { useConfirm } from "../../services/confirm";
import { useVirtualKeyboard } from "../../composables/useVirtualKeyboard";
import ConversionEditor from "../conversions/ConversionEditor.vue";
import { operationLabels } from "./operationCodec";
import {
	shouldShowLineTools,
	transferDestinationOptions,
	validRememberedLocation,
} from "./creationFormPresentation";

const props = withDefaults(
	defineProps<{
		draft: OperationDraft;
		disabled?: boolean;
		mode?: "edit" | "display";
		showError?: boolean;
		hydrating?: boolean;
		expanded?: boolean;
		active?: boolean;
	}>(),
	{ active: true, hydrating: false },
);
const emit = defineEmits<{ expand: [] }>();
const { confirm } = useConfirm();
const { keyboardOpen } = useVirtualKeyboard();
const previewDate = computed(() => reference.siteDate);
const receive = computed(() => props.draft.kind === "Receive");
const settlement = computed(() => isSettlement(props.draft));
const places = computed(() => reference.physicalLeaves);
const lineDestination = String(props.draft.items.find((line) => line.location)?.location || "");
const initialDestination = props.draft.name
	? lineDestination
	: lineDestination || String(props.draft.preferredWarehouse || "");
const destination = ref(
	["Receive", "Transfer"].includes(props.draft.kind) &&
		reference.physicalLeaves.includes(initialDestination)
		? initialDestination
		: "",
);
const transferDestinations = computed(() =>
	transferDestinationOptions(
		places.value,
		props.draft.items.map((line) => line.sourceLocation || ""),
	),
);
onMounted(async () => {
	if (
		destination.value ||
		props.draft.name ||
		!["Receive", "Transfer"].includes(props.draft.kind)
	)
		return;
	try {
		const saved = await services.call<Record<string, string>>(
			"preferences.creation_locations",
		);
		const candidate = validRememberedLocation(
			props.draft.kind,
			saved[props.draft.kind],
			places.value,
			props.draft.items.map((line) => line.sourceLocation || ""),
		);
		if (candidate) destination.value = candidate;
	} catch {
		// Remembered locations are optional; the editor still requires an explicit choice.
	}
});
async function destinationChanged(value: string) {
	if (!value || !["Receive", "Transfer"].includes(props.draft.kind)) return;
	if (props.draft.kind === "Receive")
		for (const line of props.draft.items) line.location = value;
	try {
		await services.call("preferences.save_creation_location", {
			kind: props.draft.kind,
			warehouse: value,
		});
	} catch {
		// The selection remains valid for this draft if preference storage fails.
	}
}
watch(
	() => props.draft.items.map((line) => line.sourceLocation || "").join("\u0000"),
	() => {
		if (
			props.draft.kind === "Transfer" &&
			destination.value &&
			props.draft.items.some((line) => line.sourceLocation === destination.value)
		)
			destination.value = "";
	},
);
const pickerLines = ref<AllocationLine[]>([]);
const pickerOpen = ref(false);
const scanOnOpen = ref(false);
const selectionError = ref("");
const multiAdding = ref(false);
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
		title: warehousePath(name, reference.warehouses),
		detail: warehousePath(name, reference.warehouses),
		keywords: warehouseSearchText(name, reference.warehouses),
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
const conversionTarget = ref<{
	line: AllocationLine;
	lines: AllocationLine[];
	unit: string;
}>();
const conversionDirty = ref(false);
function showDetails(line: AllocationLine, field?: string) {
	detailsField.value = field;
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
	const group = groups.value.find((row) =>
		row.lines.some((candidate) => candidate.id === line.id),
	);
	const factor =
		unit === line.uom
			? 1
			: stockItem(line.code)?.alternateUnits?.find((row) => row.uom === unit)?.factor;
	if (!factor || unit === "__other") {
		conversionTarget.value = {
			line,
			lines: group?.lines || [line],
			unit,
		};
		conversionDirty.value = false;
	} else {
		for (const row of group?.lines || [line])
			applyLineConversion(row, unit, factor, row.qty / factor);
	}
}
async function closeConversion() {
	if (
		conversionDirty.value &&
		!(await confirm({
			title: "放弃未应用的换算？",
			message: "当前换算尚未应用到明细。",
			confirmLabel: "放弃换算并关闭",
			cancelLabel: "继续填写换算",
			tone: "danger",
		}))
	)
		return;
	conversionTarget.value = undefined;
	conversionDirty.value = false;
}
async function appliedConversion() {
	const target = conversionTarget.value;
	if (!target) return;
	const unit = target.line.entryUom || target.line.uom;
	const factor = target.line.conversionFactor || 1;
	for (const line of target.lines) {
		if (line.id === target.line.id) continue;
		applyLineConversion(line, unit, factor, line.qty / factor);
	}
	conversionDirty.value = false;
	conversionTarget.value = undefined;
	await nextTick();
	requestAnimationFrame(() => {
		root.value
			?.querySelector<HTMLElement>(
				`[data-line-id="${CSS.escape(target.line.id)}"] [data-field="qty"]`,
			)
			?.focus({ preventScroll: true });
	});
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
			conversionTarget.value = undefined;
			cancelPendingScans();
		}
	},
);
onDeactivated(() => {
	detailsLine.value = undefined;
	conversionTarget.value = undefined;
	cancelPendingScans();
});
onBeforeUnmount(() => {
	cancelPendingScans();
	for (const timer of highlightTimers.values()) clearTimeout(timer);
});
watch(pickerOpen, (open, wasOpen) => {
	if (wasOpen && !open) cancelPendingScans();
});
const stockItem = (code: string) => context.stock.find((item) => item.code === code);
const eligible = computed(() => undefined);
const canAddItem = computed(
	() =>
		!props.disabled &&
		!props.hydrating &&
		!multiAdding.value &&
		!settlement.value &&
		(!receive.value || !!destination.value),
);
const hasBatchRows = (code: string) => Boolean(stockItem(code)?.tracksBatch);
function groupTotal(group: { lines: AllocationLine[] }) {
	return group.lines.reduce((total, line) => total + Number(line.qty || 0), 0);
}
function groupHasHighlight(group: { lines: AllocationLine[] }) {
	return group.lines.some((line) => highlightedLineIds.value.has(line.id));
}
function lineIssue(line: AllocationLine, field: string) {
	return lineIssues.value.find((issue) => issue.lineId === line.id && issue.field === field);
}
function lineInvalid(line: AllocationLine, field: string) {
	return Boolean((props.showError || revealErrors.value) && lineIssue(line, field));
}
function lineIssueId(line: AllocationLine, field: string) {
	return "operation-issue-" + line.id + "-" + field;
}
function changeGroupSource(group: { lines: AllocationLine[] }, source: string) {
	for (const line of group.lines) {
		line.sourceLocation = source;
		changeSource(line);
	}
}
function changeGroupLocation(group: { lines: AllocationLine[] }, location: string) {
	for (const line of group.lines) line.location = location;
}
const root = ref<HTMLElement>();
const search = ref("");
const incompleteOnly = ref(false);
const revealErrors = ref(false);
const pendingLineIds = ref(new Set<string>());
const issues = computed(() =>
	props.hydrating
		? []
		: operationIssues(props.draft).filter((issue) => {
				if (!issue.lineId) return true;
				const line = props.draft.items.find((row) => row.id === issue.lineId);
				return !!line && !pendingLineIds.value.has(line.id) && !!stockItem(line.code);
			}),
);
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
const highlightedLineIds = ref(new Set<string>());
const highlightTimers = new Map<string, ReturnType<typeof setTimeout>>();
const knownLineIds = new Set(props.draft.items.map((line) => line.id));
const groups = computed(() => {
	void groupRevision.value;
	const grouped = new Map<
		string,
		{
			key: string;
			location: string;
			sourceLocation: string;
			targetLocation: string;
			code: string;
			lines: AllocationLine[];
		}
	>();
	const locations: string[] = [];
	for (const line of props.draft.items) {
		const source = line.sourceLocation || line.loanedLocation || line.location;
		const current = receive.value ? line.location : source;
		if (!anchors.has(line.id)) anchors.set(line.id, current);
		const location = anchors.get(line.id)!;
		if (!locations.includes(location)) locations.push(location);
		const target = ["Transfer", "Repair", "Return"].includes(props.draft.kind)
			? line.location
			: props.draft.kind === "Loan"
				? line.loanedLocation || props.draft.loanDestination
				: receive.value
					? line.location
					: "";
		const loan = line.loanName || props.draft.loanName || "";
		const separateLine = stockItem(line.code)?.tracksBatch ? "" : line.id;
		const key = JSON.stringify([
			line.code,
			location,
			target,
			loan,
			line.returnOutcome || "",
			separateLine,
		]);
		if (!grouped.has(key))
			grouped.set(key, {
				key,
				location,
				sourceLocation: source,
				targetLocation: target,
				code: line.code,
				lines: [],
			});
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
	const highlighted = new Set(highlightedLineIds.value);
	highlighted.add(line.id);
	highlightedLineIds.value = highlighted;
	const timer = highlightTimers.get(line.id);
	if (timer) clearTimeout(timer);
	highlightTimers.set(
		line.id,
		setTimeout(() => {
			const next = new Set(highlightedLineIds.value);
			next.delete(line.id);
			highlightedLineIds.value = next;
			highlightTimers.delete(line.id);
		}, 1400),
	);
	groupRevision.value++;
}
watch(
	() => props.draft.items.map((line) => line.id),
	(ids) => {
		const present = new Set(ids);
		for (const id of ids) {
			if (knownLineIds.has(id)) continue;
			knownLineIds.add(id);
			const line = props.draft.items.find((row) => row.id === id);
			if (line && !props.hydrating && !pendingLineIds.value.has(id)) markRecent(line);
		}
		for (const id of [...knownLineIds]) {
			if (present.has(id)) continue;
			knownLineIds.delete(id);
			recency.delete(id);
			const timer = highlightTimers.get(id);
			if (timer) clearTimeout(timer);
			highlightTimers.delete(id);
		}
		groupRevision.value++;
	},
	{ flush: "sync" },
);
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
			keywords: warehouseSearchText(source, reference.warehouses),
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
						title: warehousePath(name, reference.warehouses),
						detail: warehousePath(name, reference.warehouses),
						keywords: warehouseSearchText(name, reference.warehouses),
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
	const hidden = ["reason", "returnOutcome", "loanName"].includes(issue.field || "");
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
		row
			?.closest(".receive-line")
			?.querySelector<HTMLElement>(`[data-field="${issue.field}"]`) ||
		root.value?.querySelector<HTMLElement>(`[data-field="${issue.field}"]:not(:disabled)`);
	const field = target?.matches("input, select, button")
		? target
		: target?.querySelector<HTMLElement>("input, select, button");
	if (!field) return;
	field.focus({ preventScroll: true });
	requestAnimationFrame(() => {
		if (field.isConnected && typeof field.scrollIntoView === "function")
			field.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
	});
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
function itemPickerReady() {
	return canAddItem.value;
}
function openPicker() {
	pick();
}
defineExpose({ revealIssue, itemPickerReady, openPicker });
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
		if (!stockItem(code)) await context.ensure(code);
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
					location: receive.value ? destination.value : "",
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
				if (props.draft.kind === "Transfer") {
					if (!pickerLines.value.length)
						line.location =
							destination.value && destination.value !== selectedWarehouse
								? destination.value
								: "";
					else if (line.location === selectedWarehouse) line.location = "";
				} else if (props.draft.kind === "Repair") {
					if (line.location === selectedWarehouse) line.location = "";
				} else line.location = selectedWarehouse;
			}
			if (receive.value) changeBatch(line);
			else changeSource(line);
		}
		markRecent(line);
	}
	if (closePicker) pickerOpen.value = false;
	pickerLines.value = [];
	return true;
}
async function selectSingle(selection: { code: string; warehouse: string }) {
	await choose(selection.code, true, selection.warehouse);
}
async function chooseMultiple(selections: { code: string; warehouse: string }[]) {
	if (multiAdding.value || !selections.length) return;
	multiAdding.value = true;
	selectionError.value = "";
	const placeholders = selections.map((selection) => {
		const id = crypto.randomUUID();
		return {
			selection,
			line: {
				id,
				localId: id,
				code: selection.code,
				qty: 1,
				uom: "",
				entryUom: "",
				entryQty: 1,
				conversionFactor: 1,
				location: receive.value ? destination.value : "",
				sourceLocation: selection.warehouse || "",
			} as AllocationLine,
		};
	});
	props.draft.items.push(...placeholders.map(({ line }) => line));
	const pending = new Set(pendingLineIds.value);
	placeholders.forEach(({ line }) => {
		pending.add(line.id);
		markRecent(line);
	});
	pendingLineIds.value = pending;
	pickerOpen.value = false;
	pickerLines.value = [];
	try {
		const available = await context.ensureMany(selections.map((selection) => selection.code));
		const inaccessible = [...new Set(selections.map((selection) => selection.code))].filter(
			(code) => !available.has(code),
		);
		if (inaccessible.length)
			selectionError.value = inaccessible.join("、") + "：物品不存在或无权访问";
		for (const { selection, line } of placeholders) {
			const item = available.get(selection.code);
			if (!item) {
				props.draft.items.splice(props.draft.items.indexOf(line), 1);
				continue;
			}
			line.code = selection.code;
			refreshLine(line);
			if (selection.warehouse) {
				if (receive.value) line.location = selection.warehouse;
				else {
					line.sourceLocation = selection.warehouse;
					if (props.draft.kind === "Transfer")
						line.location =
							destination.value && destination.value !== selection.warehouse
								? destination.value
								: "";
					else if (props.draft.kind === "Repair") {
						if (line.location === selection.warehouse) line.location = "";
					} else line.location = selection.warehouse;
				}
				if (receive.value) changeBatch(line);
				else changeSource(line);
			}
			markRecent(line);
		}
		search.value = "";
		incompleteOnly.value = false;
		await nextTick();
	} catch (reason) {
		selectionError.value = reason instanceof Error ? reason.message : "物品加载失败，请重试";
		for (const { line } of placeholders) {
			const index = props.draft.items.indexOf(line);
			if (index >= 0) props.draft.items.splice(index, 1);
		}
	} finally {
		const pending = new Set(pendingLineIds.value);
		placeholders.forEach(({ line }) => pending.delete(line.id));
		pendingLineIds.value = pending;
		multiAdding.value = false;
	}
}
function pick(lines: AllocationLine[] = [], scan = false) {
	if (!canAddItem.value) return;
	pickerLines.value = lines;
	scanOnOpen.value = scan;
	pickerOpen.value = true;
}
function remove(line: AllocationLine) {
	props.draft.items.splice(props.draft.items.indexOf(line), 1);
	pendingLineIds.value = new Set([...pendingLineIds.value].filter((id) => id !== line.id));
	recency.delete(line.id);
	for (let index = scanUndo.length - 1; index >= 0; index--)
		if (scanUndo[index]?.lineId === line.id) scanUndo.splice(index, 1);
	scanUndoRevision.value++;
	scannedLineIds.value = new Set([...scannedLineIds.value].filter((id) => id !== line.id));
}
function splitOutcome(line: AllocationLine) {
	const addition: AllocationLine = {
		...line,
		name: undefined,
		localId: crypto.randomUUID(),
		id: line.id + "-outcome-" + ++sequence,
		qty: 1,
		entryQty: 1 / (line.conversionFactor || 1),
		returnOutcome: "returned",
	};
	props.draft.items.push(addition);
	markRecent(addition);
}
function addBatch(line: AllocationLine) {
	const factor = Number(line.conversionFactor || 1);
	const addition: AllocationLine = {
		...line,
		name: undefined,
		localId: crypto.randomUUID(),
		id: line.id + "-batch-" + ++sequence,
		qty: factor,
		entryQty: 1,
		batch: "",
		expiry: "",
		manufacturingDate: "",
		nativeBundle: undefined,
		recordedBundle: undefined,
		batchAllocations: undefined,
	};
	props.draft.items.push(addition);
	markRecent(addition);
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
	line.manufacturingDate = batch?.manufacturingDate || "";
}
function receiveBatchChanged(line: AllocationLine) {
	line.nativeBundle = line.recordedBundle = undefined;
	line.batchAllocations = undefined;
	const batch = lineStock(line)?.batches?.find((batch) => batch.id === line.batch);
	if (batch) {
		if (!line.expiry) line.expiry = batch.expiry || "";
		if (!line.manufacturingDate) line.manufacturingDate = batch.manufacturingDate || "";
	}
}
</script>

<template>
	<AllocationSummary v-if="mode === 'display'" :draft="draft" />
	<template v-else>
		<div ref="root" class="preview-operation-lines" @focusout="regroupAfterFocus">
			<div v-if="!draft.items.length && !hydrating" class="operation-lines-empty">
				<FormField
					v-if="receive && !disabled"
					class="preview-receive-target"
					label="入库位置"
					required
				>
					<template #default="{ fieldAttrs }">
						<SearchSelect
							v-bind="fieldAttrs"
							external-label
							label="入库位置"
							data-field="location"
							v-model="destination"
							@update:model-value="destinationChanged"
							:clearable="false"
							:options="
								places.map((name) => ({
									value: name,
									label: warehouseLabel(name, reference.warehouses),
									title: warehousePath(name, reference.warehouses),
									detail: warehousePath(name, reference.warehouses),
									keywords: warehouseSearchText(name, reference.warehouses),
								}))
							"
						/>
					</template>
				</FormField>
				<p>
					{{
						receive
							? "先选择入库位置，再添加新到物资。"
							: draft.kind === "Transfer"
								? "选择要调拨的物品，并为每行指定来源和调入位置。"
								: draft.kind === "Loan"
									? "选择要借出的物品，填写借用方后复核。"
									: draft.kind === "Return"
										? "从下方未结清借用中加入需要归还的物品。"
										: "添加本次操作涉及的物品。"
					}}
				</p>
				<UiButton
					v-if="!disabled && !settlement"
					variant="secondary"
					icon="box"
					data-field="items"
					:disabled="!canAddItem"
					@click="pick()"
					>添加物品</UiButton
				>
				<UiButton
					v-if="!disabled && !settlement"
					variant="secondary"
					icon="scan"
					:disabled="!canAddItem"
					@click="pick([], true)"
					>扫码添加</UiButton
				>
			</div>
			<div
				v-if="
					draft.items.length &&
					(receive ||
						props.draft.kind === 'Transfer' ||
						shouldShowLineTools(draft.items.length))
				"
				class="preview-line-toolbar"
				:class="{ 'is-keyboard-open': keyboardOpen }"
			>
				<FormField
					v-if="(receive || draft.kind === 'Transfer') && !disabled"
					class="preview-receive-target"
					:label="receive ? '入库位置' : '调入位置'"
					:required="receive"
				>
					<template #default="{ fieldAttrs }">
						<SearchSelect
							v-bind="fieldAttrs"
							external-label
							:label="receive ? '入库位置' : '调入位置'"
							:data-field="receive ? 'location' : 'destination'"
							v-model="destination"
							@update:model-value="destinationChanged"
							:clearable="false"
							:options="
								(receive ? places : transferDestinations).map((name) => ({
									value: name,
									label: warehouseLabel(name, reference.warehouses),
									detail: warehousePath(name, reference.warehouses),
									keywords: warehouseSearchText(name, reference.warehouses),
								}))
							"
						/>
					</template>
				</FormField>
				<div class="preview-line-toolbar-actions">
					<UiButton
						v-if="!disabled && !settlement"
						variant="secondary"
						icon="box"
						data-field="items"
						:disabled="!canAddItem"
						@click="pick()"
						>添加物品</UiButton
					>
					<UiButton
						v-if="!disabled && !settlement"
						variant="secondary"
						icon="scan"
						:disabled="!canAddItem"
						@click="pick([], true)"
						>扫码添加</UiButton
					>
				</div>
				<label class="preview-inline-field preview-line-search"
					>搜索明细<input
						v-model="search"
						type="search"
						placeholder="物品名称、编号、库位或批次"
				/></label>
				<div class="preview-line-toolbar-status">
					<span class="preview-line-toolbar-summary" role="status"
						>{{ itemCount }} 种物品 · {{ draft.items.length }} 条明细 ·
						{{ totals }}</span
					>
					<div class="preview-line-toolbar-incomplete">
						<label class="preview-choice-label"
							><input v-model="incompleteOnly" type="checkbox" />仅看待完善</label
						>
						<UiButton :disabled="!lineIssues.length" @click="nextIssue"
							>{{ lineIssues.length }} 处待完善 · 下一个</UiButton
						>
					</div>
				</div>
				<span v-if="search || incompleteOnly" role="status"
					>显示 {{ visibleIds.size }} / {{ draft.items.length }} 行</span
				>
			</div>
			<p
				v-if="hydrating || pendingLineIds.size"
				class="operation-lines-loading-caption"
				role="status"
				aria-live="polite"
			>
				正在载入物品资料…
			</p>
			<p v-if="selectionError && !pickerOpen" class="notice-bar danger" role="alert">
				{{ selectionError }}
			</p>
			<div
				v-if="hydrating && !draft.items.length"
				class="operation-line-skeletons"
				aria-hidden="true"
			>
				<article v-for="index in 3" :key="index" class="operation-line-skeleton">
					<SkeletonBlock variant="detail" :count="3" :rows="2" />
				</article>
			</div>
			<section
				v-for="group in groups"
				:key="group.key"
				v-show="group.lines.some((line) => visibleIds.has(line.id))"
				class="location-group"
			>
				<article
					v-if="hydrating || !stockItem(group.code)"
					class="operation-line-skeleton"
					aria-hidden="true"
				>
					<SkeletonBlock variant="detail" :count="3" :rows="2" />
				</article>
				<article
					v-else
					class="preview-allocation compact-allocation allocation-card"
					:class="{ 'allocation-card--recent': groupHasHighlight(group) }"
					:data-line-id="hasBatchRows(group.code) ? undefined : group.lines[0]!.id"
				>
					<header class="allocation-card-heading">
						<div class="allocation-identity">
							<div class="preview-group-thumbnail">
								<ItemImage :item="stockItem(group.code)!" />
							</div>
							<div class="preview-line-identity">
								<strong>{{ stockItem(group.code)?.name || group.code }}</strong>
								<small class="muted"
									>{{ group.code
									}}<template v-if="stockItem(group.code)?.category">
										· {{ stockItem(group.code)?.category }}</template
									></small
								>
							</div>
						</div>
						<div v-if="hasBatchRows(group.code)" class="allocation-card-total">
							<SearchSelect
								class="allocation-card-unit"
								label="单位"
								:clearable="false"
								:model-value="group.lines[0]!.entryUom || group.lines[0]!.uom"
								:disabled="disabled || hydrating"
								:options="[
									group.lines[0]!.uom,
									...(stockItem(group.code)?.alternateUnits?.map((row) => ({
										value: row.uom,
										label: row.uom,
										detail: `1 ${row.uom} = ${row.factor} ${group.lines[0]!.uom}`,
									})) || []),
									{ value: '__other', label: '设置换算…' },
								]"
								@update:model-value="selectUnit(group.lines[0]!, $event)"
							/>
							<div class="allocation-card-total-summary">
								<small>{{ group.lines.length }} 个批次</small>
								<strong
									:title="`合计 ${groupTotal(group)} ${group.lines[0]!.uom}，只读`"
									>{{ groupTotal(group) }} {{ group.lines[0]!.uom }}</strong
								>
								<small>合计</small>
							</div>
						</div>
					</header>
					<div class="allocation-card-controls">
						<div v-if="!hasBatchRows(group.code)" class="allocation-quantity">
							<template v-for="line in group.lines" :key="line.id">
								<label class="preview-field">
									<span class="allocation-field-label">数量</span>
									<input
										data-field="qty"
										type="number"
										inputmode="decimal"
										enterkeyhint="next"
										min="0"
										step="any"
										:value="enteredQty(line)"
										:disabled="disabled || hydrating"
										:aria-label="
											(stockItem(line.code)?.name || line.code) + '数量'
										"
										:aria-invalid="lineInvalid(line, 'qty')"
										:aria-describedby="
											lineInvalid(line, 'qty')
												? lineIssueId(line, 'qty')
												: undefined
										"
										@input="
											setEnteredQty(
												line,
												Number(($event.target as HTMLInputElement).value),
											)
										"
									/>
									<p
										v-if="lineInvalid(line, 'qty')"
										:id="lineIssueId(line, 'qty')"
										class="utility-error"
									>
										{{ lineIssue(line, "qty")?.message }}
									</p>
								</label>
								<SearchSelect
									label="单位"
									:clearable="false"
									:model-value="line.entryUom || line.uom"
									:disabled="disabled || hydrating"
									:options="[
										line.uom,
										...(stockItem(line.code)?.alternateUnits?.map(
											(row) => row.uom,
										) || []),
										{ value: '__other', label: '设置换算…' },
									]"
									@update:model-value="selectUnit(line, $event)"
								/>
								<small
									v-if="line.entryUom !== line.uom"
									class="allocation-equivalent"
									>{{ enteredQty(line) }} {{ line.entryUom }} · 折合
									{{ line.qty }} {{ line.uom }}</small
								>
							</template>
						</div>
						<div class="allocation-locations">
							<SearchSelect
								v-if="!receive && !settlement"
								data-field="sourceLocation"
								:label="draft.kind === 'Transfer' ? '从' : '来源库位'"
								:model-value="
									group.lines[0]!.sourceLocation || group.lines[0]!.location
								"
								:disabled="disabled || hydrating"
								:options="
									stockItem(group.code)?.locations.map((row) => ({
										value: row.location,
										label:
											row.label ||
											warehouseLabel(row.location, reference.warehouses),
										title: warehousePath(row.location, reference.warehouses),
										detail:
											warehousePath(row.location, reference.warehouses) +
											' · 可用 ' +
											row.available +
											' · 损坏 ' +
											row.damaged,
										keywords: warehouseSearchText(
											row.location,
											reference.warehouses,
										),
									})) || []
								"
								:invalid="lineInvalid(group.lines[0]!, 'sourceLocation')"
								@update:model-value="changeGroupSource(group, $event)"
							/>
							<SearchSelect
								v-if="
									!receive &&
									['Transfer', 'Return', 'Repair'].includes(draft.kind)
								"
								data-field="location"
								:label="draft.kind === 'Transfer' ? '到' : '目标 / 存放库位'"
								:model-value="group.lines[0]!.location"
								:disabled="disabled || hydrating"
								:options="
									places
										.filter(
											(name) =>
												!['Transfer', 'Repair'].includes(draft.kind) ||
												name !== group.lines[0]!.sourceLocation,
										)
										.map((name) => ({
											value: name,
											label: warehouseLabel(name, reference.warehouses),
											title: warehousePath(name, reference.warehouses),
											detail: warehousePath(name, reference.warehouses),
											keywords: warehouseSearchText(
												name,
												reference.warehouses,
											),
										}))
								"
								:invalid="lineInvalid(group.lines[0]!, 'location')"
								@update:model-value="changeGroupLocation(group, $event)"
							/>
							<p
								v-if="receive && group.lines[0]!.location !== destination"
								class="allocation-location-value"
							>
								入库位置：{{
									warehouseLabel(
										destination,
										reference.warehouses,
										destination || "未选择",
									)
								}}
							</p>
						</div>
					</div>
					<small
						v-if="
							hasBatchRows(group.code) &&
							group.lines[0]!.entryUom !== group.lines[0]!.uom
						"
						class="allocation-equivalent"
						>数量按 {{ group.lines[0]!.entryUom }} 输入，合计仍按
						{{ group.lines[0]!.uom }} 计算。</small
					>
					<div
						v-if="hasBatchRows(group.code)"
						class="allocation-batch-table"
						:class="{
							'has-expiry': stockItem(group.code)?.tracksExpiry,
							'has-manufacturing':
								receive || group.lines.some((line) => line.manufacturingDate),
							'is-receive': receive,
						}"
					>
						<div class="batch-subrow batch-subrow--header" aria-hidden="true">
							<span>批次编号</span>
							<span v-if="stockItem(group.code)?.tracksExpiry">到期日期</span>
							<span
								v-if="
									receive || group.lines.some((line) => line.manufacturingDate)
								"
								>生产日期</span
							>
							<span>数量</span>
							<span>操作</span>
						</div>
						<div
							v-for="line in group.lines"
							:key="line.id"
							class="batch-subrow"
							:data-line-id="line.id"
						>
							<div class="batch-subrow-field" data-label="批次编号">
								<label v-if="receive" class="preview-field">
									<span>批次编号</span>
									<input
										data-field="batch"
										v-model="line.batch"
										placeholder="留空自动生成"
										autocapitalize="off"
										autocorrect="off"
										spellcheck="false"
										:disabled="disabled || hydrating"
										:aria-invalid="lineInvalid(line, 'batch')"
										:aria-describedby="
											lineInvalid(line, 'batch')
												? lineIssueId(line, 'batch')
												: undefined
										"
										@input="receiveBatchChanged(line)"
									/>
								</label>
								<SearchSelect
									v-else-if="!settlement && !line.batchAllocations?.length"
									data-field="batch"
									label="现有批次"
									:model-value="line.batch"
									:disabled="disabled || hydrating"
									:invalid="lineInvalid(line, 'batch')"
									:options="
										(lineStock(line)?.batches || []).map((batch) => ({
											value: batch.id,
											label: batch.id,
											title: batch.id,
											detail:
												'可用 ' +
												batch.available +
												' · 损坏 ' +
												(batch.damaged || 0) +
												' · 到期 ' +
												(batch.expiry || '无效期'),
										}))
									"
									@update:model-value="
										line.batch = $event;
										changeBatch(line);
									"
								/>
								<p v-else class="batch-readonly">
									{{
										line.batch ||
										(line.batchAllocations?.length
											? "已记录多批次"
											: "原借出未记录批次")
									}}
								</p>
								<p
									v-if="lineInvalid(line, 'batch')"
									:id="lineIssueId(line, 'batch')"
									class="utility-error"
									role="alert"
								>
									{{ lineIssue(line, "batch")?.message }}
								</p>
							</div>
							<div
								v-if="stockItem(group.code)?.tracksExpiry"
								class="batch-subrow-field"
								data-label="到期日期"
							>
								<label v-if="receive" class="preview-field">
									<span>到期日期</span>
									<input
										data-field="expiry"
										v-model="line.expiry"
										type="date"
										:disabled="disabled || hydrating"
										:aria-invalid="lineInvalid(line, 'expiry')"
										:aria-describedby="
											lineInvalid(line, 'expiry')
												? lineIssueId(line, 'expiry')
												: undefined
										"
									/>
								</label>
								<p v-else class="batch-readonly">{{ line.expiry || "无效期" }}</p>
								<p
									v-if="lineInvalid(line, 'expiry')"
									:id="lineIssueId(line, 'expiry')"
									class="utility-error"
									role="alert"
								>
									{{ lineIssue(line, "expiry")?.message }}
								</p>
							</div>
							<div
								v-if="receive || group.lines.some((row) => row.manufacturingDate)"
								class="batch-subrow-field"
								data-label="生产日期"
							>
								<template v-if="receive">
									<label class="preview-field">
										<span>生产日期</span>
										<input
											data-field="manufacturingDate"
											v-model="line.manufacturingDate"
											type="date"
											:disabled="disabled || hydrating"
											:aria-invalid="lineInvalid(line, 'manufacturingDate')"
											:aria-describedby="
												lineInvalid(line, 'manufacturingDate')
													? lineIssueId(line, 'manufacturingDate')
													: undefined
											"
										/>
									</label>
								</template>
								<p v-else class="batch-readonly">
									{{ line.manufacturingDate || "—" }}
								</p>
								<p
									v-if="lineInvalid(line, 'manufacturingDate')"
									:id="lineIssueId(line, 'manufacturingDate')"
									class="utility-error"
									role="alert"
								>
									{{ lineIssue(line, "manufacturingDate")?.message }}
								</p>
							</div>
							<div
								class="batch-subrow-field batch-subrow-quantity"
								data-label="数量"
							>
								<label class="preview-field">
									<span>数量</span>
									<input
										data-field="qty"
										type="number"
										inputmode="decimal"
										enterkeyhint="next"
										min="0"
										step="any"
										:value="enteredQty(line)"
										:disabled="disabled || hydrating"
										:aria-label="
											(stockItem(line.code)?.name || line.code) + '批次数量'
										"
										:aria-invalid="lineInvalid(line, 'qty')"
										:aria-describedby="
											lineInvalid(line, 'qty')
												? lineIssueId(line, 'qty')
												: undefined
										"
										@input="
											setEnteredQty(
												line,
												Number(($event.target as HTMLInputElement).value),
											)
										"
									/>
								</label>
								<p
									v-if="lineInvalid(line, 'qty')"
									:id="lineIssueId(line, 'qty')"
									class="utility-error"
									role="alert"
								>
									{{ lineIssue(line, "qty")?.message }}
								</p>
								<small class="muted">{{ line.entryUom || line.uom }}</small>
							</div>
							<div class="batch-subrow-actions">
								<UiButton
									v-if="!disabled"
									variant="ghost"
									:aria-label="
										'移除' +
										(stockItem(line.code)?.name || line.code) +
										'的批次行'
									"
									@click="remove(line)"
									>移除</UiButton
								>
							</div>
						</div>
						<UiButton
							v-if="!disabled && !settlement"
							variant="secondary"
							class="add-batch-row"
							@click="addBatch(group.lines[0]!)"
							>+ 添加批次</UiButton
						>
					</div>
					<div
						v-if="
							settlement ||
							lineIssues.some((issue) =>
								group.lines.some((line) => line.id === issue.lineId),
							)
						"
						class="allocation-context"
					>
						<small v-if="settlement"
							>借出 {{ group.lines[0]!.loanName || draft.loanName }} ·
							{{
								group.lines[0]!.returnOutcome === "damaged"
									? "损坏归还"
									: group.lines[0]!.returnOutcome === "lost"
										? "遗失"
										: "完好归还"
							}}</small
						>
						<small
							v-if="
								draft.kind === 'Damage' ||
								group.lines[0]!.returnOutcome === 'damaged'
							"
						>
							移入损坏待处理
						</small>
						<small v-if="draft.kind === 'Loan'">移入借出库位</small>
						<template v-if="showError || revealErrors">
							<p
								v-for="issue in lineIssues.filter(
									(entry) =>
										group.lines.some((line) => line.id === entry.lineId) &&
										!['batch', 'expiry', 'manufacturingDate', 'qty'].includes(
											entry.field,
										),
								)"
								:key="issue.lineId + '-' + issue.field"
								class="notice-bar warning allocation-error"
								role="alert"
							>
								{{ issue.message }}
							</p>
						</template>
					</div>
					<div class="preview-allocation-actions">
						<UiButton
							variant="secondary"
							:aria-label="(stockItem(group.code)?.name || group.code) + '详情'"
							@click="showDetails(group.lines[0]!)"
							>详情</UiButton
						>
						<UiButton
							v-if="!hasBatchRows(group.code) && !disabled"
							variant="ghost"
							:aria-label="
								'移除' + (stockItem(group.code)?.name || group.code) + '明细'
							"
							@click="remove(group.lines[0]!)"
							>移除</UiButton
						>
					</div>
				</article>
			</section>
			<AllocationDetails
				v-if="detailsLine && stockItem(detailsLine.code)"
				:line="detailsLine"
				:draft="draft"
				:disabled="disabled"
				:field="detailsField"
				@close="detailsLine = undefined"
				@replace="replaceFromDetails"
				@split="splitFromDetails"
			/>
			<Overlay
				v-if="conversionTarget && stockItem(conversionTarget.line.code)"
				:title="
					(stockItem(conversionTarget.line.code)?.name || conversionTarget.line.code) +
					' 的单位换算'
				"
				size="small"
				:initial-focus="'[data-field=conversionFactor]'"
				@close="closeConversion"
			>
				<ConversionEditor
					:line="conversionTarget.line"
					:item="stockItem(conversionTarget.line.code)!"
					:selected-unit="conversionTarget.unit"
					:disabled="disabled || hydrating"
					@item-updated="
						(value) => {
							const item = stockItem(conversionTarget!.line.code)!;
							item.version = value.version;
							item.alternateUnits = value.conversions
								.filter((row) => row.uom !== item.uom)
								.map((row) => ({ uom: row.uom, factor: row.conversion_factor }));
						}
					"
					@dirty-change="conversionDirty = $event"
					@applied="appliedConversion"
				/>
			</Overlay>
			<ItemPicker
				v-if="pickerOpen && !disabled"
				:allow-create="receive"
				:mode="pickerLines.length ? 'replace-single' : 'add-multiple'"
				:context="operationLabels[draft.kind] + ' · ' + (draft.name || '')"
				:timestamp="context.timestamp()"
				:scan-mode="pickerLines.length ? 'selection' : 'operation'"
				:start-in-scan-mode="scanOnOpen"
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

<style scoped>
.preview-operation-lines {
	min-width: 0;
	display: grid;
	gap: var(--p-space-3);
}

.preview-line-toolbar {
	position: sticky;
	top: calc(var(--preview-desktop-nav-height, 64px) + 8px);
	z-index: var(--p-z-sticky-content, 10);
	background: var(--p-surface);
	border: 1px solid var(--p-border-soft);
	border-radius: var(--p-radius-card);
	box-shadow: 0 3px 12px rgb(20 30 25 / 8%);
	padding: var(--p-space-2);
	display: flex;
	flex-wrap: wrap;
	align-items: end;
	gap: var(--p-space-2);
}

.preview-line-toolbar.is-keyboard-open {
	display: none;
}

.preview-line-toolbar .preview-receive-target {
	flex: 1 1 220px;
	max-width: 360px;
}

.preview-line-search {
	flex: 1 1 200px;
}

.preview-line-search input {
	min-height: 44px;
}

.preview-line-toolbar-status {
	display: flex;
	flex: 1 1 100%;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--p-space-2);
}

.preview-line-toolbar-status > span:first-child {
	margin-right: auto;
}

.operation-lines-empty {
	min-height: 0;
	padding: var(--p-space-3) 0;
	align-items: start;
	justify-items: start;
	text-align: start;
}

.operation-lines-empty > p {
	max-width: 42rem;
	margin: 0;
}

.operation-lines-empty > .preview-receive-target {
	width: min(100%, 28rem);
}

.operation-lines-loading-caption {
	margin: 0;
	color: var(--p-muted);
}

.operation-line-skeletons {
	display: grid;
	gap: var(--p-space-3);
}

.allocation-card {
	display: grid;
	gap: var(--p-space-3);
	min-width: 0;
	padding: var(--p-space-3);
	border: 1px solid var(--p-border-soft);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
	transition:
		background-color 180ms ease,
		border-color 180ms ease,
		box-shadow 180ms ease;
}

.preview-operation-lines .compact-allocation.allocation-card {
	grid-template-columns: minmax(0, 1fr);
}

.allocation-card--recent {
	border-color: var(--p-accent);
	background: color-mix(in srgb, var(--p-accent) 8%, var(--p-surface));
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-accent) 18%, transparent);
}

.allocation-card-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--p-space-3);
}

.allocation-card-total {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	text-align: end;
	flex: 0 0 auto;
	min-width: max-content;
}

.allocation-card-total > * {
	white-space: nowrap;
}

.allocation-card-total strong {
	font-size: 1.125em;
}

.allocation-card-controls {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
	align-items: start;
	gap: var(--p-space-3);
}

.allocation-card-unit {
	width: min(100%, 9rem);
}

.allocation-card-total .allocation-card-unit .search-select-input {
	min-height: 40px;
}

.allocation-batch-table {
	min-width: 0;
	border-top: 1px solid var(--p-border-soft);
}

.batch-subrow {
	display: grid;
	grid-template-columns: minmax(150px, 1.4fr) minmax(100px, 0.8fr) auto;
	align-items: start;
	gap: var(--p-space-2);
	padding: var(--p-space-2) 0;
	border-bottom: 1px solid var(--p-border-soft);
}

.batch-subrow--header {
	color: var(--p-muted);
	font-size: var(--p-small);
}

.allocation-batch-table.has-expiry:not(.has-manufacturing) .batch-subrow {
	grid-template-columns: minmax(150px, 1.3fr) minmax(130px, 1fr) minmax(100px, 0.8fr) auto;
}

.allocation-batch-table.has-manufacturing:not(.has-expiry) .batch-subrow {
	grid-template-columns: minmax(150px, 1.3fr) minmax(130px, 1fr) minmax(100px, 0.8fr) auto;
}

.allocation-batch-table.has-expiry.has-manufacturing .batch-subrow {
	grid-template-columns:
		minmax(150px, 1.3fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(100px, 0.8fr)
		auto;
}

.batch-subrow--header > span {
	padding-inline: var(--p-space-2);
}

.batch-subrow-field,
.batch-subrow-quantity {
	min-width: 0;
}

.batch-subrow-field .preview-field {
	display: grid;
	gap: 4px;
}

.batch-subrow-field input,
.batch-subrow-quantity input {
	width: 100%;
	min-width: 0;
}

.batch-subrow-quantity input {
	max-width: 10rem;
}

@media (min-width: 621px) {
	.batch-subrow:not(.batch-subrow--header) .batch-subrow-field .preview-field > span,
	.batch-subrow-quantity .preview-field > span {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
}

.batch-readonly {
	min-height: 44px;
	display: flex;
	align-items: center;
	margin: 0;
	overflow-wrap: anywhere;
}

.batch-subrow-actions {
	display: flex;
	justify-content: end;
	align-items: end;
}

.add-batch-row {
	margin-top: var(--p-space-2);
}

@media (max-width: 1023px) {
	.preview-line-toolbar {
		position: static;
		top: auto;
		box-shadow: none;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}

	.preview-line-toolbar .preview-receive-target {
		max-width: none;
		width: 100%;
		min-width: 0;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
	}

	.preview-line-toolbar .preview-receive-target > label {
		white-space: normal;
	}

	.preview-line-toolbar .preview-receive-target > .search-select-input {
		width: 100%;
	}

	.preview-line-toolbar-actions,
	.preview-line-search {
		grid-column: 1;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		width: 100%;
		min-width: 0;
		gap: 4px;
	}

	.preview-line-search input {
		width: 100%;
		min-width: 0;
		flex: none;
	}

	.preview-line-toolbar-status {
		grid-column: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		flex-wrap: initial;
		gap: 8px;
		font-size: 0.875rem;
	}

	.preview-line-toolbar-summary {
		display: block;
		width: 100%;
		min-width: 0;
		white-space: normal;
		overflow-wrap: anywhere;
	}

	.preview-line-toolbar-incomplete {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-width: 0;
	}

	.preview-line-toolbar-incomplete .preview-choice-label {
		white-space: normal;
		min-width: 0;
	}

	.preview-line-toolbar-incomplete .ui-button {
		flex: 0 1 auto;
		max-width: 100%;
		white-space: normal;
	}

	.preview-line-toolbar-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px;
		min-width: 0;
	}

	.preview-line-toolbar-actions .ui-button {
		min-width: 0;
		width: 100%;
		white-space: normal;
	}

	.allocation-card-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: flex-start;
	}

	.allocation-identity {
		width: 100%;
	}

	.allocation-card-total {
		display: contents;
	}

	.allocation-card-unit {
		grid-column: 1;
		grid-row: 2;
		width: 100%;
		max-width: none;
		text-align: start;
	}

	.allocation-card-total-summary {
		grid-column: 2;
		grid-row: 1;
		align-self: center;
	}

	.allocation-card-total-summary > small:first-child {
		display: none;
	}
}

@media (max-width: 620px) {
	.preview-line-toolbar {
		gap: 6px;
		padding: 8px;
	}

	.preview-line-toolbar .ui-button {
		min-height: 44px;
		padding-inline: 8px;
		white-space: nowrap;
	}

	.allocation-card-controls {
		grid-template-columns: minmax(0, 1fr);
	}

	.batch-subrow--header {
		display: none;
	}

	.allocation-batch-table .batch-subrow {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--p-space-2);
		padding: var(--p-space-3) 0;
	}

	.allocation-batch-table.has-expiry.has-manufacturing .batch-subrow,
	.allocation-batch-table.has-expiry:not(.has-manufacturing) .batch-subrow,
	.allocation-batch-table.has-manufacturing:not(.has-expiry) .batch-subrow {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	}

	.batch-subrow-field,
	.batch-subrow-quantity {
		padding: var(--p-space-2);
		border: 1px solid var(--p-border-soft);
		border-radius: var(--p-radius-control);
		background: var(--p-soft);
	}

	.batch-subrow-field input,
	.batch-subrow-quantity input {
		min-height: 44px;
	}

	.batch-subrow-actions {
		grid-column: 1 / -1;
		justify-content: flex-end;
	}

	.batch-subrow-actions .ui-button {
		min-height: 44px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.allocation-card {
		transition: none;
	}
}
</style>
