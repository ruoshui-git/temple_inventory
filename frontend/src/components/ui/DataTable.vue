<script setup lang="ts">
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
	retry: [];
}>();

const preferences = computed(() => props.columnPreferences);
const stale = computed(() => props.stale ?? props.retained);
const refreshing = computed(() => props.loading && props.initialized && !props.loadingMore);
const settingsOpen = ref(false);
const settingsTrigger = ref<HTMLButtonElement>();
const settingsPanel = ref<HTMLDivElement>();
const settingsPanelStyle = ref<Record<string, string>>({});

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
	settingsOpen.value = !settingsOpen.value;
	if (settingsOpen.value)
		void nextTick(() => {
			positionSettingsPanel();
			settingsPanel.value?.focus();
		});
}

function repositionOpenPanel() {
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
	document.addEventListener("pointerdown", onDocumentPointer);
	document.addEventListener("keydown", onDocumentKeydown);
	window.addEventListener("resize", repositionOpenPanel);
	window.addEventListener("scroll", repositionOpenPanel, true);
});
onScopeDispose(() => {
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
			class="data-table-scroll"
			:class="{ 'is-refreshing': refreshing }"
			role="region"
			:aria-label="`可横向滚动：${ariaLabel}`"
			:aria-busy="refreshing ? 'true' : undefined"
			:inert="refreshing ? true : undefined"
			tabindex="0"
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
								<span
									v-if="dataColumnAlignment(column) === 'end'"
									class="data-table-sort-indicator"
									aria-hidden="true"
									>{{
										sortBy === String(column.sortField || column.id)
											? sortDirection === "asc"
												? "↑"
												: "↓"
											: "↕"
									}}</span
								>
								<span class="data-table-sort-label">{{ column.label }}</span>
								<span
									v-if="dataColumnAlignment(column) !== 'end'"
									class="data-table-sort-indicator"
									aria-hidden="true"
									>{{
										sortBy === String(column.sortField || column.id)
											? sortDirection === "asc"
												? "↑"
												: "↓"
											: "↕"
									}}</span
								>
							</button>
							<template v-else>{{ column.label }}</template>
						</th>
						<th v-if="preferences" class="data-table-settings-heading">
							<button
								ref="settingsTrigger"
								type="button"
								class="data-table-column-trigger"
								:aria-expanded="settingsOpen"
								aria-label="设置列"
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
							<td v-if="preferences" class="data-table-settings-cell"></td>
						</tr>
					</template>
					<template v-else v-for="(entry, index) in rows" :key="entry.id">
						<tr
							:class="[
								group(entry) ? 'data-table-group-row' : undefined,
								!group(entry) && rowClass
									? rowClass(entry.value as Record<string, unknown>)
									: undefined,
							]"
							:tabindex="group(entry) && entry.hasChildren ? 0 : undefined"
							:role="group(entry) ? 'row' : undefined"
							:aria-expanded="
								group(entry) && entry.hasChildren ? entry.expanded : undefined
							"
							@click="group(entry) && activateGroup(entry, $event)"
							@keydown="group(entry) && activateGroupKey(entry, $event)"
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
							</td>
							<td
								v-else-if="selectionEnabled"
								class="data-table-selection-column"
							></td>
							<template v-if="group(entry)">
								<td v-if="!orderedColumns.length" class="data-table-group-cell">
									<div class="data-table-group-identity">
										<slot name="group-label" :group="entry" />
										<button
											type="button"
											class="data-table-group-toggle"
											:aria-expanded="entry.expanded"
											:disabled="!entry.hasChildren"
											@click.stop="emit('toggleGroup', entry.id)"
										>
											{{ entry.expanded ? "▾" : "▸" }} {{ entry.label }}
										</button>
										<span class="data-table-group-count"
											>{{ entry.countLabel || "记录数" }}
											{{ entry.count }}</span
										>
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
												(item) => String(item.id) === entry.labelColumn,
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
												<span aria-hidden="true">{{
													entry.expanded ? "▾" : "▸"
												}}</span
												>{{ entry.label }}
											</button>
											<span
												v-if="
													!entry.countColumn ||
													!orderedColumns.some(
														(item) =>
															String(item.id) === entry.countColumn,
													) ||
													entry.countColumn === entry.labelColumn
												"
												class="data-table-group-count"
												>{{ entry.countLabel || "记录数" }}
												{{ entry.count }}</span
											>
										</div>
									</template>
									<span
										v-else-if="
											String(column.id) === entry.countColumn &&
											entry.countColumn !== entry.labelColumn
										"
										class="data-table-group-count"
										>{{ entry.countLabel || "记录数" }} {{ entry.count }}</span
									>
									<slot
										v-else
										name="group-column"
										:group="entry"
										:column="column"
									/>
								</td>
								<td v-if="preferences" class="data-table-settings-cell"></td>
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
								<td v-if="preferences" class="data-table-settings-cell"></td>
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
									Number(Boolean(preferences))
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
		<p v-if="!rows.length && !loading && initialized && !error" class="data-table-state">
			{{ emptyText }}
		</p>
		<p v-if="error && rows.length" class="data-table-refresh-error" role="alert">
			{{ error }} <button type="button" @click="emit('retry')">{{ retryText }}</button>
		</p>
		<div v-if="hasMore" class="data-table-more">
			<button type="button" :disabled="loadingMore" @click="emit('loadMore')">
				{{
					loadingMore
						? `正在读取… · ${loadedCount ?? rows.length} / ${totalCount ?? "?"}`
						: `加载更多 · ${loadedCount ?? rows.length} / ${totalCount ?? "?"}`
				}}
			</button>
		</div>
	</section>
</template>
