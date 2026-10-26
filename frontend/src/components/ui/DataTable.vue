<script setup lang="ts">
import UiButton from "./UiButton.vue";
import InventoryIcon from "../InventoryIcon.vue";
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import type {
	DataColumn,
	DataTableEntry,
	DataTableGroup,
	DataTableRecord,
	ColumnPreferencesController,
	TableCellValue,
} from "../../lib/dataTable";
import { dataColumnAlignment } from "../../lib/dataTable";
import DisclosureIcon from "./DisclosureIcon.vue";
import { useOverflowEdges } from "../../composables/useOverflowEdges";
import FloatingTableScrollbar from "./FloatingTableScrollbar.vue";

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
		tableClass?: string;
		retryText?: string;
		columnPreferences?: ColumnPreferencesController;
	}>(),
	{
		loading: false,
		initialized: true,
		error: "",
		retained: false,
		emptyText: "没有符合条件的记录",
		emptyAction: "",
		loadingText: "表格数据加载中…",
		retryText: "重试",
		selectionEnabled: false,
		selectedKeys: () => [],
		hasMore: false,
		loadingMore: false,
		loadedCount: undefined,
		totalCount: undefined,
		rowClass: undefined,
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
const headerHeight = ref(56);
let headerObserver: ResizeObserver | undefined;
const {
	overflowStart,
	overflowEnd,
	pinnedStartInset,
	pinnedEndInset,
	mobileUnpinStart,
	mobileUnpinEnd,
	hintTop,
	hintLeft,
	hintRight,
	hintVisible,
	scrollMore,
} = useOverflowEdges(tableScroll, tableFrame);
const isMobile = ref(typeof window !== "undefined" && window.innerWidth < 1024);
const stale = computed(() => props.stale ?? props.retained);
const refreshing = computed(() => props.loading && props.initialized && !props.loadingMore);
const settingsOpen = ref(false);
const settingsTrigger = ref<HTMLButtonElement>();
const settingsOutlet = ref<HTMLElement>();
const settingsPanel = ref<HTMLDivElement>();
const settingsPanelStyle = ref<Record<string, string>>({});
const focusedRowId = ref<string>();
const focusedRowElement = ref<HTMLTableRowElement>();
const bodyRows = computed(() => props.rows);
const focusedRowIndex = computed(() => {
	const index = bodyRows.value.findIndex((row) => row.id === focusedRowId.value);
	return index < 0 ? 0 : index;
});
const rowTabIndex = (row: DataTableEntry) =>
	bodyRows.value.length && bodyRows.value[focusedRowIndex.value]?.id === row.id ? 0 : -1;

watch(
	bodyRows,
	(rows, previous) => {
		if (isMobile.value && !settingsOutlet.value?.isConnected)
			void nextTick(updateSettingsViewport);
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
function onRowKeydown(entry: DataTableEntry, event: KeyboardEvent) {
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
			emit("toggleGroup", entry.id);
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

function positionSettingsPanel() {
	const trigger = settingsTrigger.value;
	const panel = settingsPanel.value;
	if (!settingsOpen.value || !trigger || !panel) return;
	const margin = 12;
	const gap = 8;
	const viewportHeight = window.innerHeight;
	const viewportWidth = window.innerWidth;
	const triggerRect = trigger.getBoundingClientRect();
	const panelRect = panel.getBoundingClientRect();
	const panelHeight = panelRect.height || panel.offsetHeight;
	const panelWidth = panelRect.width || panel.offsetWidth;
	const roomBelow = viewportHeight - triggerRect.bottom - margin;
	const roomAbove = triggerRect.top - margin;
	let top: number;
	if (panelHeight <= roomBelow) top = triggerRect.bottom + gap;
	else if (panelHeight <= roomAbove) top = triggerRect.top - panelHeight - gap;
	else if (roomAbove > roomBelow) top = margin;
	else top = Math.max(margin, viewportHeight - margin - panelHeight);
	const left = Math.min(
		Math.max(margin, triggerRect.right - panelWidth),
		Math.max(margin, viewportWidth - panelWidth - margin),
	);
	settingsPanelStyle.value = {
		position: "fixed",
		top: `${top}px`,
		left: `${left}px`,
		maxHeight: `${Math.max(80, Math.min(520, viewportHeight - margin * 2))}px`,
	};
}

function closeSettings(returnFocus = false) {
	settingsOpen.value = false;
	if (returnFocus) void nextTick(() => settingsTrigger.value?.focus());
}

function onDocumentKeydown(event: KeyboardEvent) {
	if (!settingsOpen.value || event.key !== "Escape") return;
	event.stopImmediatePropagation();
	event.preventDefault();
	closeSettings(true);
}

function toggleSettings() {
	updateSettingsViewport();
	settingsOpen.value = !settingsOpen.value;
	if (settingsOpen.value)
		void nextTick(() => {
			positionSettingsPanel();
			settingsPanel.value?.focus();
		});
}

function updateSettingsViewport() {
	const mobile = typeof window !== "undefined" && window.innerWidth < 1024;
	if (mobile === isMobile.value && (!mobile || settingsOutlet.value?.isConnected)) return;
	isMobile.value = mobile;
	settingsOutlet.value = undefined;
	if (!isMobile.value || !tableFrame.value) return;
	for (
		let parent = tableFrame.value.parentElement;
		parent && parent !== document.body;
		parent = parent.parentElement
	) {
		const outlet = parent.querySelector<HTMLElement>(".browse-summary-copy");
		if (outlet) {
			settingsOutlet.value = outlet;
			return;
		}
	}
}

function repositionOpenPanel() {
	updateSettingsViewport();
	if (settingsOpen.value) void nextTick(positionSettingsPanel);
}

function onDocumentPointer(event: PointerEvent) {
	const target = event.target;
	if (
		settingsOpen.value &&
		target instanceof Node &&
		!settingsPanel.value?.contains(target) &&
		!settingsTrigger.value?.contains(target)
	)
		closeSettings();
}

function moveColumn(id: string, direction: -1 | 1) {
	if (!preferences.value) return;
	const order = [...preferences.value.order.value];
	const index = order.indexOf(id);
	const next = index + direction;
	if (index < 0 || next < 0 || next >= order.length) return;
	[order[index], order[next]] = [order[next]!, order[index]!];
	preferences.value.reorder(order);
	void nextTick(() => {
		const buttons = Array.from(
			settingsPanel.value?.querySelectorAll<HTMLButtonElement>("button[data-column-move]") ||
				[],
		);
		const validButtons = buttons.filter(
			(button) => button.dataset.columnMove === id && !button.disabled,
		);
		(
			validButtons.find((button) => button.dataset.columnDirection === String(direction)) ||
			validButtons[0]
		)?.focus();
	});
}

watch(
	[
		settingsOpen,
		() => props.columns.length,
		() => preferences.value?.order.value.length,
		() => preferences.value?.visible.value.length,
	],
	repositionOpenPanel,
	{ flush: "post" },
);
onMounted(() => {
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
	document.addEventListener("pointerdown", onDocumentPointer);
	document.addEventListener("keydown", onDocumentKeydown);
	window.addEventListener("resize", repositionOpenPanel);
	window.addEventListener("scroll", repositionOpenPanel, true);
});
onScopeDispose(() => {
	headerObserver?.disconnect();
	document.removeEventListener("pointerdown", onDocumentPointer);
	document.removeEventListener("keydown", onDocumentKeydown);
	window.removeEventListener("resize", repositionOpenPanel);
	window.removeEventListener("scroll", repositionOpenPanel, true);
});

const orderedColumns = computed(() => {
	const visible = preferences.value?.visible.value;
	const order = preferences.value?.order.value;
	const byId = new Map(props.columns.map((column) => [String(column.id), column]));
	if (!visible || !order)
		return props.columns.filter(
			(column) => column.defaultVisible !== false || column.required,
		);
	return order
		.filter((id) => visible.includes(id))
		.map((id) => byId.get(id))
		.filter((column): column is DataColumn => Boolean(column));
});
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
	emit("toggleGroup", entry.id);
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
	<section class="data-table" :aria-label="ariaLabel">
		<Teleport to="body">
			<div
				v-if="settingsOpen && preferences"
				ref="settingsPanel"
				class="data-table-column-panel"
				role="group"
				aria-label="设置表格列"
				tabindex="-1"
				:style="settingsPanelStyle"
			>
				<div class="data-table-column-panel-heading">
					<strong>设置列</strong>
					<button
						type="button"
						class="data-table-link-button"
						@click="preferences.reset"
					>
						恢复默认
					</button>
				</div>
				<ul>
					<li v-for="(column, index) in preferences.order.value" :key="column">
						<label>
							<input
								type="checkbox"
								:checked="preferences.visible.value.includes(column)"
								:disabled="
									Boolean(
										props.columns.find((item) => String(item.id) === column)
											?.required,
									)
								"
								@change="preferences.toggle(column)"
							/>
							<span>{{
								props.columns.find((item) => String(item.id) === column)?.label ||
								column
							}}</span>
						</label>
						<div class="data-table-column-order">
							<button
								type="button"
								:disabled="index === 0"
								:data-column-move="column"
								data-column-direction="-1"
								:aria-label="`上移${props.columns.find((item) => String(item.id) === column)?.label || column}`"
								@click="moveColumn(column, -1)"
							>
								↑
							</button>
							<button
								type="button"
								:disabled="index === preferences.order.value.length - 1"
								:data-column-move="column"
								data-column-direction="1"
								:aria-label="`下移${props.columns.find((item) => String(item.id) === column)?.label || column}`"
								@click="moveColumn(column, 1)"
							>
								↓
							</button>
						</div>
					</li>
				</ul>
				<p v-if="preferences.saveState.value === 'saving'" role="status">
					正在保存列设置…
				</p>
				<div
					v-else-if="preferences.saveState.value === 'error'"
					class="data-table-save-error"
					role="alert"
				>
					<span>{{ preferences.saveError.value }}</span
					><button type="button" @click="preferences.retry">重试</button>
				</div>
			</div>
		</Teleport>
		<Teleport v-if="preferences && isMobile && settingsOutlet" :to="settingsOutlet">
			<div class="data-table-settings-outlet">
				<button
					ref="settingsTrigger"
					type="button"
					class="data-table-column-trigger"
					:aria-expanded="settingsOpen"
					aria-label="设置列"
					title="设置列"
					@click="toggleSettings"
				>
					☷
				</button>
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
					isMobile && settingsOutlet ? '0px' : undefined,
			}"
		>
			<div
				ref="tableScroll"
				class="data-table-scroll"
				:class="{
					'is-refreshing': refreshing,
					'is-overflow-start': overflowStart,
					'is-overflow-end': overflowEnd,
					'is-mobile-unpin-start': mobileUnpinStart,
					'is-mobile-unpin-end': mobileUnpinEnd,
				}"
				role="region"
				:aria-label="`可横向滚动：${ariaLabel}`"
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
							<th v-if="selectionEnabled" class="data-table-selection-column">
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
								:style="{ minWidth: column.minWidth }"
								:class="[`align-${dataColumnAlignment(column)}`, column.className]"
							>
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
									<span class="data-table-sort-indicator" aria-hidden="true">{{
										sortBy === String(column.sortField || column.id)
											? sortDirection === "asc"
												? "↑"
												: "↓"
											: "↕"
									}}</span>
								</button>
								<template v-else>{{ column.label }}</template>
							</th>
							<th
								v-if="preferences && (!isMobile || !settingsOutlet)"
								class="data-table-settings-heading"
							>
								<button
									ref="settingsTrigger"
									type="button"
									class="data-table-column-trigger"
									:aria-expanded="settingsOpen"
									aria-label="设置列"
									title="设置列"
									@click="toggleSettings"
								>
									☷
								</button>
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
									v-if="preferences && !isMobile"
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
												@click.stop="emit('toggleGroup', entry.id)"
											>
												<DisclosureIcon variant="inline" />
												{{ entry.label }}
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
									<td
										v-for="(column, groupColumnIndex) in orderedColumns"
										:key="String(column.id)"
										:class="[
											`align-${dataColumnAlignment(column)}`,
											column.className,
											'data-table-group-cell',
										]"
										:style="
											groupColumnIndex ===
											Math.max(
												0,
												orderedColumns.findIndex(
													(item) =>
														String(item.id) === entry.labelColumn,
												),
											)
												? { '--group-depth': entry.depth }
												: undefined
										"
									>
										<template
											v-if="
												groupColumnIndex ===
												Math.max(
													0,
													orderedColumns.findIndex(
														(item) =>
															String(item.id) === entry.labelColumn,
													),
												)
											"
										>
											<div class="data-table-group-identity">
												<slot name="group-label" :group="entry" />
												<button
													type="button"
													class="data-table-group-toggle"
													:aria-expanded="entry.expanded"
													:disabled="!entry.hasChildren"
													@click.stop="emit('toggleGroup', entry.id)"
												>
													<DisclosureIcon variant="inline" />{{
														entry.label
													}}
												</button>
												<span
													v-if="
														!entry.countColumn ||
														!orderedColumns.some(
															(item) =>
																String(item.id) ===
																entry.countColumn,
														) ||
														entry.countColumn === entry.labelColumn
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
											</div>
										</template>
										<span
											v-else-if="
												String(column.id) === entry.countColumn &&
												entry.countColumn !== entry.labelColumn
											"
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
									</td>
									<td
										v-if="preferences && !isMobile"
										class="data-table-settings-cell"
									></td>
								</template>
								<template v-else>
									<td
										v-for="column in orderedColumns"
										:key="String(column.id)"
										:class="[
											`align-${dataColumnAlignment(column)}`,
											column.className,
											cellClass?.(String(column.id), recordValue(entry)),
										]"
									>
										<slot
											name="cell"
											:column="column"
											:row="recordValue(entry)"
											:value="cellValue(entry, column)"
											:index="index"
										>
											{{ cellValue(entry, column) }}
										</slot>
									</td>
									<td
										v-if="preferences && !isMobile"
										class="data-table-settings-cell"
									></td>
								</template>
							</tr>
							<tr
								v-if="group(entry) && (entry.detailRow || entry.expanded)"
								class="data-table-group-detail-row"
							>
								<td
									:colspan="
										orderedColumns.length +
										Number(selectionEnabled) +
										Number(Boolean(preferences && !isMobile))
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
		<FloatingTableScrollbar :get-scroll-element="getTableScroll" />
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
