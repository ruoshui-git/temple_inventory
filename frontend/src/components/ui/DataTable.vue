<script setup lang="ts">
import UiButton from "./UiButton.vue";
import InventoryIcon from "../InventoryIcon.vue";
import { computed, nextTick, onMounted, onScopeDispose, ref, useId, watch } from "vue";
import type {
	DataColumn,
	DataTableEntry,
	DataTableGroup,
	DataTableRecord,
	ColumnPreferencesController,
	TableCellValue,
} from "../../lib/dataTable";
import { dataColumnAlignment, dataColumnKind, orderedVisibleColumns } from "../../lib/dataTable";
import DisclosureIcon from "./DisclosureIcon.vue";
import { useOverflowEdges } from "../../composables/useOverflowEdges";
import { useStickyGroupRows, type StickyGroupMeta } from "../../composables/useStickyGroupRows";
import FloatingTableScrollbar from "./FloatingTableScrollbar.vue";
import DetailPopover from "./DetailPopover.vue";
import ColumnSettings from "./ColumnSettings.vue";
import { presentationText } from "../../lib/presentationLabels";
import DataCell from "./DataCell.vue";
import { getColumnWidths, preferenceUser, setColumnWidths } from "../../lib/uiPreferences";

const props = withDefaults(
	defineProps<{
		ariaLabel: string;
		columns: DataColumn[];
		rows: DataTableEntry[];
		rowKey?: (row: Record<string, unknown>) => string;
		selectionLabel?: (row: Record<string, unknown>) => string;
		sortBy?: string;
		sortDirection?: "asc" | "desc";
		loading?: boolean;
		initialized?: boolean;
		error?: string;
		retained?: boolean;
		stale?: boolean;
		emptyText?: string;
		emptyAction?: string;
		loadingText?: string;
		selectionEnabled?: boolean;
		selectedKeys?: string[];
		hasMore?: boolean;
		loadingMore?: boolean;
		loadedCount?: number;
		totalCount?: number;
		rowClass?: (row: Record<string, unknown>) => string | Record<string, boolean>;
		rowLabel?: (row: Record<string, unknown>) => string | undefined;
		rowAttributes?: (row: Record<string, unknown>) => Record<string, string>;
		cellClass?: (columnId: string, row: Record<string, unknown>) => string;
		groupSummaryColumns?: (group: DataTableGroup) => string[];
		/** Column ids a grouped table omits, because its group headers already show them. */
		suppressedColumns?: readonly string[];
		tableClass?: string;
		retryText?: string;
		columnPreferences?: ColumnPreferencesController;
		compact?: boolean;
		/** Sticks the column header to the page below the browse toolbar. */
		stickyHeader?: boolean;
	}>(),
	{
		loading: false,
		initialized: true,
		error: "",
		retained: false,
		emptyText: presentationText.noMatches,
		emptyAction: "",
		loadingText: presentationText.loading,
		retryText: "重试",
		selectionEnabled: false,
		selectedKeys: () => [],
		hasMore: false,
		loadingMore: false,
		loadedCount: undefined,
		totalCount: undefined,
		rowClass: undefined,
		stickyHeader: false,
		sortDirection: "asc",
	},
);

const emit = defineEmits<{
	sort: [columnId: string];
	select: [rowKey: string, selected: boolean];
	selectVisible: [rowKeys: string[], selected: boolean];
	toggleGroup: [groupId: string];
	loadMore: [];
	emptyAction: [];
	retry: [];
}>();

const preferences = computed(() => props.columnPreferences);
const tableScroll = ref<HTMLElement>();
const tableFrame = ref<HTMLElement>();
const desktopResizable = ref(false);
const tableId = useId();
const resizeTableKey = computed(
	() => `${props.ariaLabel}:${props.columns.map((column) => String(column.id)).join(",")}`,
);
const columnWidths = ref<Record<string, number>>({});
let resizeCleanup: (() => void) | undefined;
function readColumnWidths() {
	columnWidths.value = getColumnWidths(preferenceUser.value, resizeTableKey.value);
}
function saveColumnWidths() {
	setColumnWidths(preferenceUser.value, resizeTableKey.value, columnWidths.value);
}
watch([preferenceUser, resizeTableKey], readColumnWidths, { immediate: true });
function columnWidth(column: DataColumn) {
	const width = columnWidths.value[String(column.id)];
	return width ? { width: `${width}px`, minWidth: `${column.minWidth || 72}px` } : undefined;
}
function columnStyle(column: DataColumn) {
	return { ...pinStyle(column), ...columnWidth(column) };
}
function resizeKeydown(event: KeyboardEvent, column: DataColumn) {
	if (event.key === "Home" || event.key === "End") {
		event.preventDefault();
		columnWidths.value[String(column.id)] = event.key === "Home" ? column.minWidth || 72 : 720;
		saveColumnWidths();
		return;
	}
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	event.preventDefault();
	const id = String(column.id);
	const base = columnWidths.value[id] || 180;
	columnWidths.value = {
		...columnWidths.value,
		[id]: Math.max(column.minWidth || 72, base + (event.key === "ArrowRight" ? 12 : -12)),
	};
	saveColumnWidths();
}
function resetColumnWidth(column: DataColumn) {
	const next = { ...columnWidths.value };
	delete next[String(column.id)];
	columnWidths.value = next;
	saveColumnWidths();
}
function beginResize(event: PointerEvent, column: DataColumn) {
	event.preventDefault();
	event.stopPropagation();
	const th = (event.currentTarget as HTMLElement).parentElement;
	if (!th) return;
	const startX = event.clientX;
	const startWidth = th.getBoundingClientRect().width;
	const id = String(column.id);
	const move = (moveEvent: PointerEvent) => {
		columnWidths.value = {
			...columnWidths.value,
			[id]: Math.max(
				column.minWidth || 72,
				Math.round(startWidth + moveEvent.clientX - startX),
			),
		};
	};
	const end = () => {
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", end);
		window.removeEventListener("pointercancel", end);
		resizeCleanup = undefined;
		saveColumnWidths();
	};
	resizeCleanup?.();
	resizeCleanup = end;
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", end, { once: true });
	window.addEventListener("pointercancel", end, { once: true });
}
onScopeDispose(() => resizeCleanup?.());
const headerHeight = ref(56);
let headerObserver: ResizeObserver | undefined;
let resizeMedia: MediaQueryList | undefined;
let updateResizeMode: (() => void) | undefined;
const {
	overflowStart,
	overflowEnd,
	pinnedStartInset,
	pinnedEndInset,
	mobileUnpinEnd,
	hintTop,
	hintLeft,
	hintRight,
	hintVisible,
	measure,
	scrollMore,
} = useOverflowEdges(tableScroll, tableFrame);
const stale = computed(() => props.stale ?? props.retained);
const refreshing = computed(() => props.loading && props.initialized && !props.loadingMore);
const settingsOutlet = ref<HTMLElement>();
const focusedRowId = ref<string>();
const focusedRowElement = ref<HTMLTableRowElement>();
const bodyRows = computed(() => props.rows);
const focusedRowIndex = computed(() => {
	const index = bodyRows.value.findIndex((row) => row.id === focusedRowId.value);
	return index < 0 ? 0 : index;
});
const rowTabIndex = (row: DataTableEntry) =>
	bodyRows.value.length && bodyRows.value[focusedRowIndex.value]?.id === row.id ? 0 : -1;
function groupLabelSpan(group: DataTableGroup) {
	const summaries = new Set([
		...(props.groupSummaryColumns?.(group) || []),
		...(group.countColumn ? [group.countColumn] : []),
	]);
	const firstSummary = orderedColumns.value.findIndex((column) =>
		summaries.has(String(column.id)),
	);
	const labelColumn = orderedColumns.value.findIndex(
		(column) => String(column.id) === group.labelColumn,
	);
	if (labelColumn >= 0) return labelColumn + 1;
	return firstSummary < 0 ? orderedColumns.value.length : Math.max(1, firstSummary);
}

const stickyRowMeta = computed<StickyGroupMeta[]>(() =>
	props.rows.map((entry) =>
		entry.kind === "group" ? { kind: "group", depth: entry.depth } : { kind: "record" },
	),
);
const stickyGroups = useStickyGroupRows({
	table: tableScroll,
	entries: () => stickyRowMeta.value,
	rowElements,
	enabled: () => props.stickyHeader,
});
watch(
	[stickyRowMeta, overflowStart, overflowEnd, headerHeight, () => props.stickyHeader],
	() => stickyGroups.refresh(),
	{ flush: "post" },
);

function pinStyle(column: DataColumn) {
	if (column.pinned !== "start") return undefined;
	const selectionWidth = props.selectionEnabled
		? (tableScroll.value?.querySelector<HTMLElement>("thead th.data-table-selection-column")
				?.offsetWidth ?? 0)
		: 0;
	return { "--data-table-pinned-offset": `${selectionWidth}px` };
}

watch(
	bodyRows,
	(rows, previous) => {
		if (!settingsOutlet.value?.isConnected) void nextTick(updateSettingsViewport);
		if (!rows.length) {
			focusedRowId.value = undefined;
			return;
		}
		if (rows.some((row) => row.id === focusedRowId.value)) return;
		const oldIndex = Math.max(
			0,
			previous.findIndex((row) => row.id === focusedRowId.value),
		);
		const restoreFocus =
			focusedRowElement.value &&
			!focusedRowElement.value.isConnected &&
			document.activeElement === document.body;
		focusedRowId.value = rows[Math.min(oldIndex, rows.length - 1)]!.id;
		if (restoreFocus) void nextTick(() => focusRow(Math.min(oldIndex, rows.length - 1)));
	},
	{ flush: "post" },
);

watch([overflowStart, overflowEnd], () => {
	void nextTick(measure);
});

function rowElements() {
	return Array.from(
		tableScroll.value?.querySelectorAll<HTMLTableRowElement>(
			":scope > table > tbody > tr[data-row-id]",
		) || [],
	);
}
function focusRow(index: number) {
	const elements = rowElements();
	if (!elements.length) return;
	const next = Math.max(0, Math.min(elements.length - 1, index));
	const row = elements[next]!;
	focusedRowId.value = row.dataset.rowId;
	row.focus({ preventScroll: true });
	row.scrollIntoView?.({ block: "nearest" });
}
function isInteractiveTarget(target: EventTarget | null) {
	return (
		target instanceof Element &&
		Boolean(
			target.closest(
				"a,input,textarea,select,button,[contenteditable]:not([contenteditable='false']),[role='textbox']",
			),
		)
	);
}
function onRowPointerDown(entry: DataTableEntry, event: PointerEvent) {
	if (isInteractiveTarget(event.target)) return;
	const row = event.currentTarget as HTMLTableRowElement;
	const scroll = tableScroll.value;
	const scrollLeft = scroll?.scrollLeft ?? 0;
	focusedRowId.value = entry.id;
	focusedRowElement.value = row;
	row.focus({ preventScroll: true });
	if (scroll && scroll.scrollLeft !== scrollLeft) scroll.scrollLeft = scrollLeft;
}
function onRowFocus(entry: DataTableEntry, event: FocusEvent) {
	focusedRowId.value = entry.id;
	focusedRowElement.value = event.currentTarget as HTMLTableRowElement;
}
function onRowClick(entry: DataTableEntry, event: MouseEvent) {
	if (!props.selectionEnabled || entry.kind !== "record" || entry.selectable === false) return;
	const openTarget = event.target instanceof Element && event.target.closest(".browse-row-link");
	if (isInteractiveTarget(event.target) && !openTarget) return;
	event.preventDefault();
	const key = keyFor(entry);
	emit("select", key, !props.selectedKeys.includes(key));
	if (openTarget) event.stopPropagation();
}
function onRowKeydown(entry: DataTableEntry, event: KeyboardEvent) {
	const openTarget = event.target instanceof Element && event.target.closest(".browse-row-link");
	if (
		props.selectionEnabled &&
		entry.kind === "record" &&
		entry.selectable !== false &&
		openTarget &&
		(event.key === "Enter" || event.key === " ")
	) {
		event.preventDefault();
		event.stopPropagation();
		const key = keyFor(entry);
		emit("select", key, !props.selectedKeys.includes(key));
		return;
	}
	if (isInteractiveTarget(event.target)) return;
	const index = bodyRows.value.findIndex((row) => row.id === entry.id);
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		focusRow(index + (event.key === "ArrowDown" ? 1 : -1));
		return;
	}
	if (event.key === "Home" || event.key === "End") {
		event.preventDefault();
		focusRow(event.key === "Home" ? 0 : bodyRows.value.length - 1);
		return;
	}
	if (group(entry) && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
		const shouldExpand = event.key === "ArrowRight";
		if (entry.hasChildren && entry.expanded !== shouldExpand) {
			event.preventDefault();
			toggleGroupInPlace(entry);
		}
		return;
	}
	if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
		if (!group(entry) && tableScroll.value) {
			tableScroll.value.scrollBy?.({ left: event.key === "ArrowRight" ? 80 : -80 });
			event.preventDefault();
		}
		return;
	}
	if (event.key === "Enter") {
		if (group(entry)) {
			activateGroupKey(entry, event);
			return;
		}
		if (props.selectionEnabled && entry.kind === "record" && entry.selectable !== false) {
			event.preventDefault();
			const key = keyFor(entry);
			emit("select", key, !props.selectedKeys.includes(key));
			return;
		}
		event.preventDefault();
		rowElements()
			.find((row) => row.dataset.rowId === entry.id)
			?.querySelector<HTMLElement>(".browse-row-link, button.item-name")
			?.click();
		return;
	}
	if (event.key === " ") {
		if (group(entry)) {
			activateGroupKey(entry, event);
			return;
		}
		if (props.selectionEnabled && entry.kind === "record" && entry.selectable !== false) {
			event.preventDefault();
			const key = keyFor(entry);
			emit("select", key, !props.selectedKeys.includes(key));
		}
	}
}

function updateSettingsViewport() {
	if (settingsOutlet.value?.isConnected) return;
	settingsOutlet.value = undefined;
	const frame = tableFrame.value;
	// Only a top-level table may move its column settings into the nearest result summary or
	// caption marked `data-table-settings-outlet`; nested tables and a second table sharing the
	// same outlet keep their settings header cell.
	if (!frame || frame.parentElement?.closest(".data-table-frame")) return;
	for (
		let parent = frame.parentElement;
		parent && parent !== document.body;
		parent = parent.parentElement
	) {
		const outlet =
			parent.querySelector<HTMLElement>(".browse-summary-controls") ||
			parent.querySelector<HTMLElement>("[data-table-settings-outlet]") ||
			parent.querySelector<HTMLElement>(".browse-summary-copy");
		if (!outlet) continue;
		if (!outlet.querySelector(".data-table-settings-outlet")) settingsOutlet.value = outlet;
		return;
	}
}

function syncSettingsOutlet() {
	updateSettingsViewport();
}

onMounted(() => {
	if (typeof window.matchMedia === "function") {
		resizeMedia = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
		updateResizeMode = () => (desktopResizable.value = resizeMedia?.matches === true);
		updateResizeMode();
		resizeMedia.addEventListener?.("change", updateResizeMode);
	}
	updateSettingsViewport();
	const updateHeaderHeight = () => {
		const header = tableScroll.value?.querySelector("thead");
		if (header) headerHeight.value = Math.ceil(header.getBoundingClientRect().height);
	};
	updateHeaderHeight();
	headerObserver =
		tableScroll.value && typeof ResizeObserver !== "undefined"
			? new ResizeObserver(updateHeaderHeight)
			: undefined;
	const header = tableScroll.value?.querySelector("thead");
	if (header) headerObserver?.observe(header);
	window.addEventListener("resize", syncSettingsOutlet);
	window.addEventListener("scroll", syncSettingsOutlet, true);
});
onScopeDispose(() => {
	headerObserver?.disconnect();
	if (resizeMedia && updateResizeMode)
		resizeMedia.removeEventListener?.("change", updateResizeMode);
	window.removeEventListener("resize", syncSettingsOutlet);
	window.removeEventListener("scroll", syncSettingsOutlet, true);
});

const visibleColumns = computed(() => orderedVisibleColumns(props.columns, preferences.value));
/** Only grouped tables hide columns; keeps the full list when grouping would hide every column. */
const groupSuppressed = computed<string[]>(() => {
	if (!props.suppressedColumns?.length || !props.rows.some((entry) => group(entry))) return [];
	const hidden = visibleColumns.value
		.map((column) => String(column.id))
		.filter((id) => props.suppressedColumns!.includes(id));
	return hidden.length < visibleColumns.value.length ? hidden : [];
});
const orderedColumns = computed(() =>
	groupSuppressed.value.length
		? visibleColumns.value.filter(
				(column) => !groupSuppressed.value.includes(String(column.id)),
			)
		: visibleColumns.value,
);
function columnKind(column: DataColumn) {
	const kind = dataColumnKind(column);
	const firstPrimary = orderedColumns.value.find(
		(candidate) => dataColumnKind(candidate) === "primary",
	);
	if (kind !== "primary") return kind;
	return firstPrimary === column ? "primary" : "text";
}
const recordRows = computed(() =>
	props.rows.filter(
		(row): row is DataTableRecord => row.kind === "record" && row.selectable !== false,
	),
);
function keyFor(row: DataTableRecord) {
	return props.rowKey ? props.rowKey(row.value as Record<string, unknown>) : row.id;
}
const allVisibleSelected = computed(
	() =>
		recordRows.value.length > 0 &&
		recordRows.value.every((row) => props.selectedKeys.includes(keyFor(row))),
);
const hasSomeSelected = computed(() => {
	const visibleKeys = new Set(recordRows.value.map(keyFor));
	return props.selectedKeys.some((key) => visibleKeys.has(key)) && !allVisibleSelected.value;
});

function value(row: Record<string, unknown>, id: string): TableCellValue {
	const found = row[id];
	return typeof found === "string" ||
		typeof found === "number" ||
		typeof found === "boolean" ||
		found == null
		? found
		: String(found);
}

function group(row: DataTableEntry): row is DataTableGroup {
	return row.kind === "group";
}

function recordValue(entry: DataTableEntry): Record<string, unknown> {
	return entry.kind === "record" ? (entry.value as Record<string, unknown>) : {};
}

function cellValue(entry: DataTableEntry, column: DataColumn) {
	return value(recordValue(entry), String(column.id));
}
/** Only plain text works as a native tooltip; structured cells render their own detail. */
function cellTitle(cell: unknown) {
	return typeof cell === "string" || typeof cell === "number" ? String(cell) : undefined;
}

function toggleVisible(event: Event) {
	const selected = (event.target as HTMLInputElement).checked;
	emit("selectVisible", recordRows.value.map(keyFor), selected);
}
function getTableScroll() {
	return tableScroll.value;
}
function activateGroup(entry: DataTableGroup, event: Event) {
	if (!entry.hasChildren) return;
	const target = event.target;
	if (target instanceof Element) {
		const control = target.closest("button,input,select,a,[role='button']");
		if (control && control !== event.currentTarget) return;
	}
	toggleGroupInPlace(entry);
}
/** A stuck group keeps its place under the column header when it toggles. */
function toggleGroupInPlace(entry: DataTableGroup) {
	const keepInPlace = stickyGroups.placeOf(entry.id);
	emit("toggleGroup", entry.id);
	if (keepInPlace) void nextTick(keepInPlace);
}
function activateGroupKey(entry: DataTableGroup, event: KeyboardEvent) {
	if (event.key !== "Enter" && event.key !== " ") return;
	const target = event.target;
	if (target instanceof Element) {
		const control = target.closest("button,input,select,a,[role='button']");
		if (control && control !== event.currentTarget) return;
	}
	event.preventDefault();
	activateGroup(entry, event);
}
</script>

<template>
	<section
		class="data-table"
		:aria-label="ariaLabel"
		:style="{ '--data-table-head-height': `${headerHeight}px` }"
	>
		<Teleport v-if="preferences && !compact && settingsOutlet" :to="settingsOutlet">
			<div class="data-table-settings-outlet">
				<ColumnSettings
					:preferences="preferences"
					:columns="columns"
					:suppressed="groupSuppressed"
				/>
			</div>
		</Teleport>

		<p v-if="loading && !initialized" class="sr-only" role="status">
			{{ loadingText }}
		</p>
		<p v-if="error && !rows.length" class="data-table-state error" role="alert">
			{{ error }} <button type="button" @click="emit('retry')">{{ retryText }}</button>
		</p>
		<span v-if="refreshing" class="sr-only data-table-refresh-status" role="status">
			保留当前结果，更新完成后可用。
		</span>
		<div
			ref="tableFrame"
			class="data-table-frame"
			:style="{
				'--data-table-pinned-start': `${pinnedStartInset}px`,
				'--data-table-pinned-end': `${pinnedEndInset}px`,
				'--data-table-header-height': `${headerHeight}px`,
				'--data-table-settings-column-width':
					settingsOutlet || !preferences || compact ? '0px' : undefined,
			}"
		>
			<div
				ref="tableScroll"
				class="data-table-scroll"
				:class="{
					'is-sticky-header': stickyHeader,
					'is-refreshing': refreshing,
					'is-overflow-start': overflowStart,
					'is-overflow-end': overflowEnd,
					'is-overflowing': overflowStart || overflowEnd,
					'is-mobile-unpin-end': mobileUnpinEnd,
				}"
				role="region"
				:aria-label="compact ? ariaLabel : `可横向滚动：${ariaLabel}`"
				:aria-busy="refreshing ? 'true' : undefined"
				:inert="refreshing ? true : undefined"
				tabindex="-1"
			>
				<table
					:class="[
						tableClass,
						{
							'data-table-has-groups': props.rows.some(
								(entry) => entry.kind === 'group',
							),
						},
					]"
				>
					<caption v-if="$slots.caption">
						<slot name="caption" />
					</caption>
					<thead>
						<tr>
							<th
								v-if="selectionEnabled"
								class="data-table-selection-column"
								:class="{
									'data-table-selection-pinned': orderedColumns.some(
										(column) => column.pinned === 'start',
									),
								}"
							>
								<input
									type="checkbox"
									aria-label="选择当前已加载记录"
									:checked="allVisibleSelected"
									:indeterminate="hasSomeSelected"
									@change="toggleVisible"
								/>
							</th>
							<th
								v-for="column in orderedColumns"
								:key="String(column.id)"
								:aria-sort="
									column.sortable
										? sortBy === String(column.sortField || column.id)
											? sortDirection === 'asc'
												? 'ascending'
												: 'descending'
											: 'none'
										: undefined
								"
								:aria-describedby="
									column.hint
										? `${tableId}-hint-desc-${String(column.id)}`
										: undefined
								"
								:class="[
									`align-${dataColumnAlignment(column)}`,
									`data-column-${columnKind(column)}`,
									column.className,
									column.pinned === 'start'
										? 'data-table-pinned-start'
										: undefined,
									column.pinned === 'end' ? 'data-table-pinned-end' : undefined,
									column.quantity ? 'quantity-column' : undefined,
								]"
								:style="columnStyle(column)"
							>
								<span
									v-if="column.resizable !== false"
									class="data-table-resize-handle"
									role="separator"
									aria-orientation="vertical"
									:aria-label="`调整${column.label}列宽`"
									:aria-valuenow="columnWidths[String(column.id)] || undefined"
									:aria-valuemin="column.minWidth || 72"
									:tabindex="0"
									@pointerdown="beginResize($event, column)"
									@keydown="resizeKeydown($event, column)"
									@dblclick.stop="resetColumnWidth(column)"
								></span>
								<button
									v-if="column.sortable"
									type="button"
									:class="[
										'data-table-sort',
										`align-${dataColumnAlignment(column)}`,
									]"
									:aria-label="`${column.label}排序${sortBy === String(column.sortField || column.id) ? (sortDirection === 'asc' ? '：升序' : '：降序') : '：未排序'}`"
									@click="emit('sort', String(column.sortField || column.id))"
								>
									<span class="data-table-sort-label">{{ column.label }}</span>
									<span class="data-table-sort-indicator" aria-hidden="true">
										<InventoryIcon
											:name="
												sortBy === String(column.sortField || column.id)
													? sortDirection === 'asc'
														? 'sort-asc'
														: 'sort-desc'
													: 'sort-none'
											"
										/>
									</span>
								</button>
								<template v-else>{{ column.label }}</template>
								<DetailPopover
									v-if="column.hint"
									:label="`${column.label}说明：${column.hint}`"
									trigger-class="data-table-header-hint"
								>
									<template #trigger><InventoryIcon name="info" /></template>
									{{ column.hint }}
								</DetailPopover>
								<span
									v-if="column.hint"
									:id="`${tableId}-hint-desc-${String(column.id)}`"
									class="sr-only"
									>{{ column.hint }}</span
								>
							</th>
							<th
								v-if="preferences && !compact && !settingsOutlet"
								class="data-table-settings-heading"
							>
								<ColumnSettings
									:preferences="preferences"
									:columns="columns"
									:suppressed="groupSuppressed"
								/>
							</th>
						</tr>
					</thead>
					<tbody :inert="refreshing || stale || undefined">
						<template v-if="loading && !initialized">
							<tr
								v-for="row in 5"
								:key="`loading-${row}`"
								class="data-table-skeleton-row"
								aria-hidden="true"
							>
								<td v-if="selectionEnabled" class="data-table-selection-column">
									<span class="data-table-skeleton-control"></span>
								</td>
								<td
									v-for="(column, index) in orderedColumns"
									:key="String(column.id)"
									:class="`align-${dataColumnAlignment(column)}`"
								>
									<span
										class="data-table-skeleton-line"
										:style="{
											'--skeleton-width': `${38 + ((row + index) % 4) * 13}%`,
										}"
									></span>
								</td>
								<td
									v-if="preferences && !compact && !settingsOutlet"
									class="data-table-settings-cell"
								></td>
							</tr>
						</template>
						<template v-else v-for="(entry, index) in rows" :key="entry.id">
							<tr
								:class="[
									group(entry) ? 'data-table-group-row' : undefined,
									group(entry) && entry.expanded ? 'is-expanded' : undefined,
									!group(entry) && rowClass
										? rowClass(entry.value as Record<string, unknown>)
										: undefined,
								]"
								:data-row-id="entry.id"
								:data-browse-row="
									rowAttributes?.(recordValue(entry))?.['data-browse-row'] ||
									entry.id
								"
								:tabindex="rowTabIndex(entry)"
								:role="group(entry) ? 'row' : undefined"
								:aria-expanded="
									group(entry) && entry.hasChildren ? entry.expanded : undefined
								"
								@click.capture="onRowClick(entry, $event)"
								@click="group(entry) && activateGroup(entry, $event)"
								@focus="onRowFocus(entry, $event)"
								@pointerdown="onRowPointerDown(entry, $event)"
								@keydown="onRowKeydown(entry, $event)"
								:aria-label="
									!group(entry) && rowLabel
										? rowLabel(entry.value as Record<string, unknown>)
										: undefined
								"
								v-bind="
									!group(entry) && rowAttributes
										? rowAttributes(entry.value as Record<string, unknown>)
										: undefined
								"
							>
								<td
									v-if="selectionEnabled && !group(entry)"
									class="data-table-selection-column"
									:class="{
										'data-table-selection-pinned': orderedColumns.some(
											(column) => column.pinned === 'start',
										),
									}"
								>
									<label class="data-table-row-checkbox">
										<input
											type="checkbox"
											:aria-label="
												props.selectionLabel
													? `选择${props.selectionLabel(entry.value as Record<string, unknown>)}`
													: `选择记录 ${entry.id}`
											"
											:checked="selectedKeys.includes(keyFor(entry))"
											:disabled="entry.selectable === false"
											@change="
												emit(
													'select',
													keyFor(entry),
													($event.target as HTMLInputElement).checked,
												)
											"
										/>
									</label>
								</td>
								<td
									v-else-if="selectionEnabled"
									class="data-table-selection-column"
									:class="{
										'data-table-selection-pinned': orderedColumns.some(
											(column) => column.pinned === 'start',
										),
									}"
								></td>
								<template v-if="group(entry)">
									<td
										v-if="!orderedColumns.length"
										class="data-table-group-cell"
									>
										<div class="data-table-group-identity">
											<slot name="group-label" :group="entry" />
											<button
												type="button"
												class="data-table-group-toggle"
												:aria-expanded="entry.expanded"
												:disabled="!entry.hasChildren"
												@click.stop="toggleGroupInPlace(entry)"
											>
												<DisclosureIcon variant="inline" />
												<span
													class="data-table-group-name"
													:title="entry.label"
													>{{ entry.label }}</span
												>
											</button>
											<span class="data-table-group-count"
												>{{ entry.countLabel || "记录数" }}
												{{ entry.count }}</span
											>
											<slot
												name="group-metrics"
												:group="entry"
												:visible-columns="
													orderedColumns.map((column) =>
														String(column.id),
													)
												"
											/>
										</div>
									</td>
									<template
										v-for="(column, groupColumnIndex) in orderedColumns"
										:key="String(column.id)"
									>
										<td
											v-if="
												groupColumnIndex === 0 ||
												groupColumnIndex >= groupLabelSpan(entry)
											"
											:colspan="
												groupColumnIndex === 0
													? groupLabelSpan(entry)
													: undefined
											"
											:class="[
												`align-${dataColumnAlignment(column)}`,
												`data-column-${columnKind(column)}`,
												column.className,
												column.pinned === 'start'
													? 'data-table-pinned-start'
													: undefined,
												column.pinned === 'end'
													? 'data-table-pinned-end'
													: undefined,
												column.quantity ? 'quantity-column' : undefined,
												'data-table-group-cell',
												groupColumnIndex === 0
													? 'data-table-group-identity-cell'
													: undefined,
											]"
											:style="
												groupColumnIndex === 0
													? {
															'--group-depth': entry.depth,
															...pinStyle(column),
														}
													: pinStyle(column)
											"
										>
											<div
												v-if="groupColumnIndex === 0"
												class="data-table-group-identity"
											>
												<slot name="group-label" :group="entry" />
												<button
													type="button"
													class="data-table-group-toggle"
													:aria-expanded="entry.expanded"
													:disabled="!entry.hasChildren"
													@click.stop="toggleGroupInPlace(entry)"
												>
													<DisclosureIcon variant="inline" />
													<span
														class="data-table-group-name"
														:title="entry.label"
														>{{ entry.label }}</span
													>
												</button>
												<span
													v-if="
														!entry.countColumn ||
														!orderedColumns.some(
															(item) =>
																String(item.id) ===
																entry.countColumn,
														) ||
														orderedColumns.findIndex(
															(item) =>
																String(item.id) ===
																entry.countColumn,
														) < groupLabelSpan(entry)
													"
													class="data-table-group-count"
													>{{ entry.countLabel || "记录数" }}
													{{ entry.count }}</span
												>
												<slot
													name="group-metrics"
													:group="entry"
													:visible-columns="
														orderedColumns.map((item) =>
															String(item.id),
														)
													"
												/>
												<slot
													v-if="
														props
															.groupSummaryColumns?.(entry)
															.includes(String(column.id))
													"
													name="group-column"
													:group="entry"
													:column="column"
												/>
											</div>
											<template v-else>
												<span
													v-if="String(column.id) === entry.countColumn"
													class="data-table-group-count"
													>{{ entry.countLabel || "记录数" }}
													{{ entry.count }}</span
												>
												<slot
													v-else
													name="group-column"
													:group="entry"
													:column="column"
												/>
											</template>
										</td>
									</template>
									<td
										v-if="preferences && !compact && !settingsOutlet"
										class="data-table-settings-cell"
									></td>
								</template>
								<template v-else>
									<td
										v-for="column in orderedColumns"
										:key="String(column.id)"
										:class="[
											`align-${dataColumnAlignment(column)}`,
											`data-column-${columnKind(column)}`,
											column.className,
											column.pinned === 'start'
												? 'data-table-pinned-start'
												: undefined,
											column.pinned === 'end'
												? 'data-table-pinned-end'
												: undefined,
											column.quantity ? 'quantity-column' : undefined,
											cellClass?.(String(column.id), recordValue(entry)),
										]"
										:style="columnStyle(column)"
										:title="
											['primary', 'code', 'chip'].includes(
												columnKind(column),
											)
												? cellTitle(recordValue(entry)[String(column.id)])
												: undefined
										"
									>
										<slot
											name="cell"
											:column="column"
											:row="recordValue(entry)"
											:value="cellValue(entry, column)"
											:index="index"
										>
											<DataCell
												:column="column"
												:value="cellValue(entry, column)"
											/>
										</slot>
									</td>
									<td
										v-if="preferences && !compact && !settingsOutlet"
										class="data-table-settings-cell"
									></td>
								</template>
							</tr>
							<tr
								v-if="group(entry) && entry.detailRow"
								class="data-table-group-detail-row"
							>
								<td
									:colspan="
										orderedColumns.length +
										Number(selectionEnabled) +
										Number(Boolean(preferences && !compact && !settingsOutlet))
									"
									class="data-table-group-detail-cell"
									:style="{
										'--group-depth': entry.kind === 'group' ? entry.depth : 0,
									}"
								>
									<span
										v-if="entry.loading"
										class="data-table-group-skeleton"
										aria-hidden="true"
									></span>
									<span v-if="entry.error" role="alert">{{ entry.error }}</span>
									<slot name="group" :group="entry" />
								</td>
							</tr>
						</template>
					</tbody>
				</table>
			</div>
			<button
				v-if="!compact"
				:aria-hidden="!(overflowStart && hintVisible)"
				:tabindex="overflowStart && hintVisible ? 0 : -1"
				:class="{ 'is-hidden': !(overflowStart && hintVisible) }"
				class="data-table-overflow-hint data-table-overflow-hint-start"
				:style="{ top: `${hintTop}px`, left: `${hintLeft}px` }"
				type="button"
				aria-label="向左滚动查看更多列"
				title="更多列"
				@click="scrollMore(-1)"
			>
				<InventoryIcon name="chevron-left" />
			</button>
			<button
				v-if="!compact"
				:aria-hidden="!(overflowEnd && hintVisible)"
				:tabindex="overflowEnd && hintVisible ? 0 : -1"
				:class="{ 'is-hidden': !(overflowEnd && hintVisible) }"
				class="data-table-overflow-hint data-table-overflow-hint-end"
				:style="{ top: `${hintTop}px`, right: `${hintRight}px` }"
				type="button"
				aria-label="向右滚动查看更多列"
				title="更多列"
				@click="scrollMore(1)"
			>
				<InventoryIcon name="chevron-right" />
			</button>
		</div>
		<FloatingTableScrollbar v-if="!compact" :get-scroll-element="getTableScroll" />
		<div v-if="!rows.length && !loading && initialized && !error" class="data-table-state">
			<InventoryIcon name="search" />
			<span>{{ emptyText }}</span>
			<UiButton v-if="emptyAction" variant="primary" @click="emit('emptyAction')">{{
				emptyAction
			}}</UiButton>
		</div>
		<p v-if="error && rows.length" class="data-table-refresh-error" role="alert">
			{{ error }} <button type="button" @click="emit('retry')">{{ retryText }}</button>
		</p>
		<div v-if="hasMore" class="data-table-more">
			<UiButton
				size="compact"
				:loading="loadingMore"
				loading-label="正在加载更多结果…"
				@click="emit('loadMore')"
			>
				加载更多 · {{ loadedCount ?? rows.length }} / {{ totalCount ?? "?" }}
			</UiButton>
		</div>
	</section>
</template>
