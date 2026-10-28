<script setup lang="ts">
import { warehouseLabel, warehousePath, warehouseSearchText } from "../../lib/warehouseLabel";
import { unitLabel, unitOption, sortByUnit } from "../../lib/units";
import { formatQuantity } from "../../lib/formatQuantity";
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
import {
	computed,
	ref,
	nextTick,
	watch,
	onDeactivated,
	onBeforeUnmount,
	onMounted,
	useId,
} from "vue";
import {
	useOperationContext,
	type OperationDraft,
	type AllocationLine,
	type OperationLocationSection,
	operationSections,
	moveOperationLine,
	moveOperationSection,
	mergeCompatibleOperationLines,
	copyOperationLine,
} from "./operationModel";
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
const conversionTarget = ref<{
	line: AllocationLine;
	lines: AllocationLine[];
	unit: string;
}>();
const conversionDirty = ref(false);
function selectUnit(line: AllocationLine, unit: string) {
	const factor =
		unit === line.uom
			? 1
			: stockItem(line.code)?.alternateUnits?.find((row) => row.uom === unit)?.factor;
	if (!factor || unit === "__other") {
		conversionTarget.value = {
			line,
			lines: [line],
			unit,
		};
		conversionDirty.value = false;
	} else {
		applyLineConversion(line, unit, factor, line.qty / factor);
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
			conversionTarget.value = undefined;
			cancelPendingScans();
		}
	},
);
onDeactivated(() => {
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
		(!receive.value ||
			!!destination.value ||
			props.draft.items.some((line) => !!line.location)),
);
const hasBatchRows = (code: string) => Boolean(stockItem(code)?.tracksBatch);
function lineIssue(line: AllocationLine, field: string) {
	return lineIssues.value.find((issue) => issue.lineId === line.id && issue.field === field);
}
function lineInvalid(line: AllocationLine, field: string) {
	return Boolean((props.showError || revealErrors.value) && lineIssue(line, field));
}
function lineIssueId(line: AllocationLine, field: string) {
	return "operation-issue-" + line.id + "-" + field;
}
const root = ref<HTMLElement>();
const search = ref("");
const incompleteOnly = ref(false);
const sectionHeaderId = useId();
const addingSection = ref(false);
const addSectionSelect = ref<InstanceType<typeof SearchSelect>>();
const addSectionPicker = ref<HTMLElement>();
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
	return sortByUnit([...quantities], ([uom]) => uom)
		.map(([uom, qty]) => `${qty} ${unitLabel(uom)}`)
		.join(" · ");
});
const itemCount = computed(() => new Set(props.draft.items.map((line) => line.code)).size);
const emptySectionLocations = ref<string[]>([]);
const sectionLabel = computed(
	() =>
		({
			Receive: "入库位置",
			Issue: "出库位置",
			Loss: "遗失位置",
			Loan: "借出位置",
			Damage: "损坏位置",
			Disposal: "报废位置",
			Transfer: "调出位置",
			Return: "归还位置",
			Repair: "修复后位置",
		})[props.draft.kind],
);
const addSectionLabel = computed(() => `+ 添加${sectionLabel.value}`);
function sectionHasBatch(section: OperationLocationSection) {
	return section.lines.some((line) => hasBatchRows(line.code));
}
function sectionHasOutcome(section: OperationLocationSection) {
	return props.draft.kind === "Return" && section.lines.some((line) => !!line.loanName);
}
function sectionGridTemplate(section: OperationLocationSection) {
	const columns = ["minmax(156px, 1.35fr)"];
	if (sectionHasBatch(section))
		columns.push("minmax(132px, 1fr)", "minmax(132px, 0.95fr)", "minmax(132px, 0.95fr)");
	columns.push("88px", "96px", "88px");
	if (props.draft.kind === "Transfer") columns.push("minmax(128px, 1fr)");
	if (["Damage", "Loss"].includes(props.draft.kind)) columns.push("minmax(120px, 0.95fr)");
	if (sectionHasOutcome(section)) columns.push("minmax(128px, 1fr)");
	columns.push("40px");
	return columns.join(" ");
}
function lineName(line: AllocationLine) {
	return stockItem(line.code)?.name || line.displayName || line.code;
}
const fixedSectionLocation = computed(
	() =>
		["Repair", "Disposal"].includes(props.draft.kind) &&
		sections.value.some((section) => reference.damagedLeaves.includes(section.location)),
);
const locationOptions = computed(() =>
	places.value.map((name) => ({
		value: name,
		label: warehouseLabel(name, reference.warehouses),
		title: warehousePath(name, reference.warehouses),
		detail: warehousePath(name, reference.warehouses),
		keywords: warehouseSearchText(name, reference.warehouses),
	})),
);
const sections = computed(() => {
	const grouped = operationSections(props.draft);
	for (const location of emptySectionLocations.value)
		if (!grouped.some((section) => section.location === location))
			grouped.push({ location, lines: [] });
	return grouped;
});
function addEmptySection(location: string) {
	if (location && !sections.value.some((section) => section.location === location))
		emptySectionLocations.value.push(location);
	if (receive.value && location) {
		destination.value = location;
		void destinationChanged(location);
	}
	addingSection.value = false;
}
function startAddingSection() {
	addingSection.value = true;
	void nextTick(() => addSectionSelect.value?.focus());
}
function cancelAddingSection() {
	addingSection.value = false;
}
function blurAddSection(event: FocusEvent) {
	const next = event.relatedTarget;
	if (!(next instanceof Node) || !addSectionPicker.value?.contains(next)) cancelAddingSection();
}
function moveSection(section: OperationLocationSection, location: string) {
	moveOperationSection(props.draft, section, location);
	if (receive.value && location) {
		destination.value = location;
		void destinationChanged(location);
	}
	emptySectionLocations.value = emptySectionLocations.value.filter(
		(value) => value !== location,
	);
	mergeCompatibleOperationLines(props.draft);
}
function moveLine(line: AllocationLine, location: string) {
	moveOperationLine(props.draft, line, location);
	if (receive.value && location) {
		destination.value = location;
		void destinationChanged(location);
	}
	mergeCompatibleOperationLines(props.draft);
}
function closeLineMenu(line: AllocationLine) {
	void nextTick(() => {
		const row = Array.from(
			root.value?.querySelectorAll<HTMLElement>("[data-line-id]") || [],
		).find((element) => element.dataset.lineId === line.id);
		row?.querySelector("details.operation-row-menu")?.removeAttribute("open");
	});
}
function moveLineFromMenu(line: AllocationLine, location: string) {
	moveLine(line, location);
	closeLineMenu(line);
}
function sectionLocationOptions(section: OperationLocationSection) {
	return locationOptions.value.filter(
		(option) =>
			props.draft.kind !== "Transfer" ||
			section.lines.every((line) => line.location !== option.value),
	);
}
function lineLocationOptions(section: OperationLocationSection, line: AllocationLine) {
	return sectionLocationOptions(section)
		.filter(
			(option) =>
				option.value !== section.location &&
				(props.draft.kind !== "Transfer" || option.value !== line.location),
		)
		.map((option) => {
			const node = reference.warehouses.find((row) => row.name === option.value);
			return {
				...option,
				label: node?.short_label || node?.local_label || option.label,
				title: option.title || warehousePath(option.value, reference.warehouses),
			};
		});
}
function duplicateLine(line: AllocationLine) {
	const copy = copyOperationLine(line);
	props.draft.items.splice(props.draft.items.indexOf(line) + 1, 0, copy);
	markRecent(copy);
	closeLineMenu(line);
}
function pickAt(location: string) {
	if (receive.value) {
		destination.value = location;
		void destinationChanged(location);
	} else scanWarehouse.value = location;
	pick();
}
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
const highlightedLineIds = ref(new Set<string>());
const highlightTimers = new Map<string, ReturnType<typeof setTimeout>>();
const knownLineIds = new Set(props.draft.items.map((line) => line.id));
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
function receiveScanLocation(code: string) {
	const matchingLine = [...props.draft.items]
		.reverse()
		.find((line) => line.code === code && line.location);
	if (matchingLine?.location) return matchingLine.location;
	const latestLine = [...props.draft.items].reverse().find((line) => line.location);
	return latestLine?.location || destination.value;
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
	const defaultDestination = receiving
		? snapshotDestination(context) || receiveScanLocation(item.code)
		: snapshotDestination(context);
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
			detail: `${warehousePath(source, reference.warehouses)} · 可用 ${available} ${unitLabel(item.uom)}`,
			keywords: warehouseSearchText(source, reference.warehouses),
		};
	});
	const batchOptions = selectedPairs.map((row) => ({
		value: row.batch,
		label: row.batch,
		detail: `可用 ${row.available} ${unitLabel(item.uom)}`,
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
	scanFeedback.value = `已扫描添加 ${item.name} ×1 ${unitLabel(item.uom)}${warehouse ? ` · ${warehouseLabel(warehouse, reference.warehouses, warehouse)}` : ""}`;
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
async function revealIssue(issue: OperationIssue | undefined = lineIssues.value[0]) {
	if (!issue?.lineId) return;
	if (issue.message) revealErrors.value = true;
	search.value = "";
	incompleteOnly.value = false;
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
		<div ref="root" class="preview-operation-lines">
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
				<div v-if="!disabled && !settlement" class="operation-empty-actions">
					<UiButton
						variant="secondary"
						icon="box"
						data-field="items"
						:disabled="!canAddItem"
						@click="pick()"
						>添加物品</UiButton
					>
					<UiButton
						variant="secondary"
						icon="scan"
						:disabled="!canAddItem"
						@click="pick([], true)"
						>扫码添加</UiButton
					>
				</div>
			</div>
			<div
				v-if="
					draft.items.length &&
					(receive ||
						props.draft.kind === 'Transfer' ||
						shouldShowLineTools(draft.items.length))
				"
				class="preview-line-toolbar"
				:class="{
					'is-keyboard-open': keyboardOpen,
					'has-transfer-destination': draft.kind === 'Transfer' && !disabled,
				}"
			>
				<FormField
					v-if="draft.kind === 'Transfer' && !disabled"
					class="preview-receive-target"
					label="调入位置"
				>
					<template #default="{ fieldAttrs }">
						<SearchSelect
							v-bind="fieldAttrs"
							external-label
							label="调入位置"
							data-field="destination"
							v-model="destination"
							@update:model-value="destinationChanged"
							:clearable="false"
							:options="
								transferDestinations.map((name) => ({
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
				<div class="preview-line-toolbar-actions">
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
				v-for="(section, sectionIndex) in sections"
				:key="section.location"
				class="operation-location-section"
			>
				<header class="operation-location-heading">
					<strong :id="`${sectionHeaderId}-${sectionIndex}`"
						>{{ sectionLabel }} <b class="required-mark">*</b></strong
					>
					<SearchSelect
						class="operation-section-location"
						:label="sectionLabel"
						external-label
						:aria-labelled-by="`${sectionHeaderId}-${sectionIndex}`"
						:model-value="section.location"
						:disabled="disabled || hydrating || fixedSectionLocation"
						:invalid="
							section.lines.some((line) =>
								lineInvalid(
									line,
									['Receive', 'Return', 'Repair'].includes(draft.kind)
										? 'location'
										: 'sourceLocation',
								),
							)
						"
						:clearable="false"
						:options="sectionLocationOptions(section)"
						@update:model-value="moveSection(section, $event)"
					/>
					<span class="muted operation-section-count"
						>{{ section.lines.length }} 行</span
					>
					<button
						v-if="!disabled && !settlement"
						type="button"
						class="operation-add-item-action"
						aria-label="添加物品"
						@click="pickAt(section.location)"
					>
						<span class="operation-add-item-desktop">＋ 添加物品</span>
						<span class="operation-add-item-phone" aria-hidden="true">＋</span>
					</button>
				</header>
				<div
					class="operation-column-headings"
					:style="{ '--operation-grid-template': sectionGridTemplate(section) }"
					aria-hidden="true"
				>
					<span>物品 <b class="required-mark">*</b></span>
					<template v-if="sectionHasBatch(section)">
						<span
							>批次
							<b
								v-if="
									draft.kind !== 'Receive' &&
									section.lines.some(
										(line) =>
											stockItem(line.code)?.tracksBatch &&
											!line.nativeBundle,
									)
								"
								class="required-mark"
								>*</b
							></span
						><span
							>效期
							<b
								v-if="
									draft.kind === 'Receive' &&
									section.lines.some(
										(line) => stockItem(line.code)?.tracksExpiry,
									)
								"
								class="required-mark"
								>*</b
							></span
						><span>生产日期 <small class="muted">可选</small></span>
					</template>
					<span>数量 <b class="required-mark">*</b></span
					><span>单位 <b class="required-mark">*</b></span
					><span class="operation-stock-total-heading" aria-hidden="true"></span>
					<span v-if="draft.kind === 'Transfer'">调入</span>
					<span v-if="['Damage', 'Loss'].includes(draft.kind)">原因</span>
					<span v-if="sectionHasOutcome(section)">归还结果</span>
					<span>⋯</span>
				</div>
				<article
					v-for="line in section.lines"
					:key="line.id"
					v-show="visibleIds.has(line.id)"
					class="operation-compact-row"
					:class="{
						'operation-compact-row--recent': highlightedLineIds.has(line.id),
						'is-batch-tracked': hasBatchRows(line.code),
					}"
					:style="{ '--operation-grid-template': sectionGridTemplate(section) }"
					:data-line-id="line.id"
				>
					<div class="operation-row-item">
						<div class="operation-row-thumbnail">
							<ItemImage
								v-if="stockItem(line.code)"
								:item="stockItem(line.code)!"
								:thumbnail-size="32"
								:target-size="32"
							/>
						</div>
						<div class="operation-compact-identity">
							<strong :title="lineName(line)">{{ lineName(line) }}</strong>
							<small class="muted">{{ line.code }}</small>
							<small v-if="draft.kind === 'Repair'" class="muted"
								>损坏来源：{{
									warehouseLabel(
										line.sourceLocation || "",
										reference.warehouses,
										"未指定",
									)
								}}</small
							>
						</div>
					</div>
					<div v-if="sectionHasBatch(section)" class="operation-row-batch">
						<div class="operation-row-cell operation-row-batch-id">
							<span class="operation-phone-field-label">批次</span>
							<template v-if="hasBatchRows(line.code)">
								<input
									v-if="receive"
									data-field="batch"
									v-model="line.batch"
									:aria-label="`${lineName(line)}批次`"
									placeholder="自动生成"
									:disabled="disabled || hydrating"
									:aria-invalid="lineInvalid(line, 'batch')"
									:aria-describedby="
										lineInvalid(line, 'batch')
											? lineIssueId(line, 'batch')
											: undefined
									"
									@input="receiveBatchChanged(line)"
								/>
								<SearchSelect
									v-else-if="!settlement && !line.batchAllocations?.length"
									:label="`${lineName(line)}批次`"
									external-label
									:aria-label="`${lineName(line)}批次`"
									:model-value="line.batch"
									:disabled="disabled || hydrating"
									:invalid="lineInvalid(line, 'batch')"
									:options="
										(lineStock(line)?.batches || []).map((batch) => ({
											value: batch.id,
											label: batch.id,
											detail: `可用 ${batch.available} · 到期 ${batch.expiry || '无效期'}`,
										}))
									"
									@update:model-value="
										line.batch = $event;
										changeBatch(line);
									"
								/>
								<span v-else class="operation-cell-value">{{
									line.batch ||
									(line.batchAllocations?.length
										? "已记录多批次"
										: "原借出未记录批次")
								}}</span>
							</template>
							<p
								v-if="lineInvalid(line, 'batch')"
								:id="lineIssueId(line, 'batch')"
								class="utility-error"
							>
								{{ lineIssue(line, "batch")?.message }}
							</p>
						</div>
						<div class="operation-row-cell operation-row-expiry">
							<span class="operation-phone-field-label">效期</span>
							<template v-if="hasBatchRows(line.code)">
								<input
									v-if="receive && stockItem(line.code)?.tracksExpiry"
									data-field="expiry"
									v-model="line.expiry"
									type="date"
									:aria-label="`${lineName(line)}效期`"
									:disabled="disabled || hydrating"
									:aria-invalid="lineInvalid(line, 'expiry')"
									:aria-describedby="
										lineInvalid(line, 'expiry')
											? lineIssueId(line, 'expiry')
											: undefined
									"
								/>
								<span v-else class="operation-cell-value">{{
									line.expiry || "无效期"
								}}</span>
							</template>
							<p
								v-if="lineInvalid(line, 'expiry')"
								:id="lineIssueId(line, 'expiry')"
								class="utility-error"
							>
								{{ lineIssue(line, "expiry")?.message }}
							</p>
						</div>
						<div class="operation-row-cell operation-row-manufacturing">
							<span class="operation-phone-field-label">生产日期</span>
							<template v-if="hasBatchRows(line.code)">
								<input
									v-if="receive"
									data-field="manufacturingDate"
									v-model="line.manufacturingDate"
									type="date"
									:aria-label="`${lineName(line)}生产日期`"
									:disabled="disabled || hydrating"
									:aria-invalid="lineInvalid(line, 'manufacturingDate')"
									:aria-describedby="
										lineInvalid(line, 'manufacturingDate')
											? lineIssueId(line, 'manufacturingDate')
											: undefined
									"
								/>
								<span v-else class="operation-cell-value">{{
									line.manufacturingDate || "—"
								}}</span>
							</template>
						</div>
					</div>
					<div class="operation-row-controls">
						<label class="operation-row-cell operation-row-quantity">
							<span class="operation-phone-field-label">数量</span>
							<input
								data-field="qty"
								type="number"
								inputmode="decimal"
								min="0"
								step="any"
								:value="enteredQty(line)"
								:disabled="disabled || hydrating"
								:aria-label="`${lineName(line)}数量`"
								:aria-invalid="lineInvalid(line, 'qty')"
								:aria-describedby="
									lineInvalid(line, 'qty') ? lineIssueId(line, 'qty') : undefined
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
						<label class="operation-row-cell operation-row-unit">
							<span class="operation-phone-field-label">单位</span>
							<SearchSelect
								:label="`${lineName(line)}单位`"
								external-label
								:aria-label="`${lineName(line)}单位`"
								:model-value="line.entryUom || line.uom"
								:disabled="disabled || hydrating"
								:clearable="false"
								data-field="uom"
								:options="[
									unitOption(line.uom),
									...(stockItem(line.code)?.alternateUnits?.map((row) =>
										unitOption(row.uom, {
											factor: row.factor,
											stockUom: line.uom,
										}),
									) || []),
									{ value: '__other', label: '设置换算…' },
								]"
								@update:model-value="selectUnit(line, $event)"
							/>
						</label>
						<span
							v-if="line.entryUom && line.entryUom !== line.uom"
							class="operation-row-stock-total muted"
							>=
							{{
								formatQuantity(
									enteredQty(line) * Number(line.conversionFactor || 1),
								)
							}}
							{{ unitLabel(line.uom) }}</span
						>
						<span
							v-else
							class="operation-row-stock-total-empty"
							aria-hidden="true"
						></span>
						<label
							v-if="draft.kind === 'Transfer'"
							class="operation-row-cell operation-row-destination"
						>
							<span class="operation-phone-field-label">调入</span>
							<SearchSelect
								:label="`${lineName(line)}调入位置`"
								external-label
								:aria-label="`${lineName(line)}调入位置`"
								:model-value="line.location"
								:disabled="disabled || hydrating"
								:invalid="lineInvalid(line, 'location')"
								:options="
									places
										.filter(
											(name) =>
												name !== (line.sourceLocation || line.location),
										)
										.map((name) => ({
											value: name,
											label: warehouseLabel(name, reference.warehouses),
											title: warehousePath(name, reference.warehouses),
											detail: warehousePath(name, reference.warehouses),
										}))
								"
								@update:model-value="line.location = $event"
							/>
						</label>
						<label
							v-if="['Damage', 'Loss'].includes(draft.kind)"
							class="operation-row-cell operation-row-reason"
						>
							<span class="operation-phone-field-label">原因</span>
							<input
								v-model="line.reason"
								:disabled="disabled || hydrating"
								:aria-label="`${lineName(line)}原因`"
								placeholder="填写原因"
							/>
							<p
								v-if="lineInvalid(line, 'reason')"
								:id="lineIssueId(line, 'reason')"
								class="utility-error"
							>
								{{ lineIssue(line, "reason")?.message }}
							</p>
						</label>
						<label
							v-if="draft.kind === 'Return' && line.loanName"
							class="operation-row-cell operation-row-outcome"
						>
							<span class="operation-phone-field-label">归还结果</span>
							<SearchSelect
								:label="`${lineName(line)}归还结果`"
								external-label
								:aria-label="`${lineName(line)}归还结果`"
								:model-value="line.returnOutcome || 'returned'"
								:disabled="disabled || hydrating"
								:clearable="false"
								:options="[
									{ value: 'returned', label: '完好归还' },
									{ value: 'damaged', label: '损坏归还' },
									{ value: 'lost', label: '遗失' },
								]"
								@update:model-value="
									line.returnOutcome = $event as 'returned' | 'damaged' | 'lost'
								"
							/>
						</label>
						<span
							v-if="sectionHasOutcome(section) && !line.loanName"
							class="operation-row-cell operation-row-empty"
							aria-hidden="true"
						></span>
					</div>
					<details class="operation-row-menu">
						<summary aria-label="明细操作">⋯</summary>
						<div class="operation-row-menu-content">
							<SearchSelect
								:label="'移到其他位置'"
								external-label
								aria-label="移到其他位置"
								model-value=""
								placeholder="选择其他位置"
								:disabled="disabled || hydrating || fixedSectionLocation"
								:options="lineLocationOptions(section, line)"
								@update:model-value="moveLineFromMenu(line, $event)"
							/>
							<button type="button" :disabled="disabled" @click="pick([line])">
								更换物品
							</button>
							<button
								type="button"
								:disabled="disabled"
								@click="duplicateLine(line)"
							>
								复制为新行
							</button>
							<button type="button" :disabled="disabled" @click="remove(line)">
								删除
							</button>
						</div>
					</details>
				</article>
			</section>
			<div
				v-if="!disabled && !settlement && draft.items.length"
				class="operation-add-section"
			>
				<button
					v-if="!addingSection"
					class="operation-add-section-quiet"
					type="button"
					@click="startAddingSection"
				>
					{{ addSectionLabel }}
				</button>
				<div
					v-else
					ref="addSectionPicker"
					class="operation-add-section-picker"
					@keydown.esc.capture.prevent="cancelAddingSection"
					@focusout="blurAddSection"
				>
					<span :id="`${sectionHeaderId}-add`" class="operation-add-section-label">{{
						addSectionLabel
					}}</span>
					<SearchSelect
						ref="addSectionSelect"
						:label="addSectionLabel"
						external-label
						:aria-labelled-by="`${sectionHeaderId}-add`"
						placeholder="搜索库位"
						model-value=""
						:clearable="false"
						:options="locationOptions"
						@update:model-value="addEmptySection($event)"
					/>
				</div>
			</div>
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
	display: grid;
	grid-template-columns: auto minmax(180px, 1fr) auto auto auto;
	align-items: center;
	gap: var(--p-space-2);
	background: var(--p-surface);
	border: 1px solid var(--p-border-soft);
	border-radius: var(--p-radius-card);
	box-shadow: 0 3px 12px rgb(20 30 25 / 8%);
	padding: var(--p-space-2);
}
.preview-line-toolbar.has-transfer-destination {
	grid-template-columns: minmax(200px, 240px) auto minmax(180px, 1fr) auto auto auto;
}
.preview-line-toolbar.is-keyboard-open {
	display: none;
}
.preview-line-toolbar .preview-receive-target {
	margin: 0;
	min-width: 0;
}
.preview-line-toolbar .preview-receive-target .preview-search-select {
	min-width: 0;
}
.preview-line-toolbar-actions,
.preview-line-toolbar-status,
.preview-line-toolbar-incomplete {
	display: contents;
}
.preview-line-search {
	display: flex;
	align-items: center;
	gap: var(--p-space-2);
	min-width: 0;
	margin: 0;
	white-space: nowrap;
}
.preview-line-search input {
	min-height: 36px;
}
.preview-line-toolbar-summary {
	min-width: 0;
	color: var(--p-muted);
	font-size: var(--p-small);
	white-space: nowrap;
}
.preview-line-toolbar-incomplete > button {
	flex: 0 0 auto;
	white-space: nowrap;
}
.preview-line-toolbar > span[role="status"] {
	grid-column: 1 / -1;
	color: var(--p-muted);
	font-size: var(--p-small);
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
	display: grid;
	grid-template-columns: max-content minmax(0, 1fr);
	align-items: center;
	column-gap: var(--p-space-2);
	width: min(100%, 28rem);
}
.operation-empty-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--p-space-2);
}

.operation-lines-loading-caption {
	margin: 0;
	color: var(--p-muted);
}

.operation-line-skeletons {
	display: grid;
	gap: var(--p-space-3);
}

.operation-compact-row--recent {
	border-color: var(--p-accent);
	background: color-mix(in srgb, var(--p-accent) 8%, var(--p-surface));
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-accent) 18%, transparent);
}

@media (max-width: 1023px) {
	.preview-line-toolbar {
		position: static;
		top: auto;
		box-shadow: none;
		grid-template-columns: auto minmax(0, 1fr);
	}
	.preview-line-toolbar.has-transfer-destination {
		grid-template-columns: minmax(0, 1fr);
	}

	.preview-line-toolbar.has-transfer-destination .preview-receive-target,
	.preview-line-search,
	.preview-line-toolbar-summary,
	.preview-line-toolbar-incomplete,
	.preview-line-toolbar > span[role="status"] {
		grid-column: 1 / -1;
	}

	.preview-line-toolbar-status {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--p-space-1);
	}
	.preview-line-search {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 4px;
		white-space: normal;
	}

	.preview-line-toolbar-incomplete {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--p-space-2);
	}

	.preview-line-toolbar-actions .ui-button {
		min-height: 36px;
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
}
</style>
