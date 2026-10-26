<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import { warehouseLabel, warehousePath } from "../../lib/warehouseLabel";
import { computed, ref, nextTick, watch, onMounted } from "vue";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ItemImage from "../../components/ItemImage.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseChip from "../../components/ui/BrowseChip.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import ScanPanel from "../scanner/ScanPanel.vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { scopeFilterFieldChips, type ScopeFilterField } from "../../lib/filterPresentation";
import { emptyScope, type BrowseScope } from "../../lib/browseQuery";
import ItemEditorView from "./ItemEditorView.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import { useItemEditor } from "./useItemEditor";
import { useItemPicker } from "./useItemPicker";
import type { StockItem } from "../../lib/stockPresentation";
import DataTable from "../../components/ui/DataTable.vue";
import type { DataColumn, DataTableRecord } from "../../lib/dataTable";
import { useColumnPreferences } from "../../composables/useColumnPreferences";
import { itemPickerColumns } from "./itemPickerColumns";
import { earliestBatchExpiry, showOnlyStockFilter } from "../documents/creationFormPresentation";
import { useOptionalInventoryServices } from "../../services/contracts";
import FilterRailEdge from "../../components/ui/FilterRailEdge.vue";
import { useConfirm } from "../../services/confirm";

export type ItemScanOption = {
	value: string;
	label: string;
	detail?: string;
	keywords?: string;
	available?: number;
};
export type ItemScanResolution = {
	code: string;
	name: string;
	uom: string;
	sourceOptions: ItemScanOption[];
	batchOptions: Array<ItemScanOption & { source: string }>;
	destinationOptions: ItemScanOption[];
	defaultSource: string;
	defaultBatch: string;
	defaultDestination: string;
	sourceRequired: boolean;
	batchRequired: boolean;
	destinationRequired: boolean;
	destinationExcludesSource: boolean;
};
export type ItemScanDraftLine = {
	id?: string;
	code: string;
	name: string;
	qty: number;
	uom: string;
	warehouse: string;
	batch: string;
};
const props = defineProps<{
	allowCreate?: boolean;
	mode?: "add-multiple" | "replace-single";
	context?: string;
	eligible?: string[];
	createBarcode?: string;
	timestamp?: string;
	scanMode?: "selection" | "operation";
	scanFeedback?: string;
	scanError?: string;
	canUndoScan?: boolean;
	startInScanMode?: boolean;
	activeWarehouse?: string;
	purpose?: "outbound" | "damaged" | "inbound" | "count";
	receivingWarehouse?: string;
	scanResolution?: ItemScanResolution;
	scanLines?: ItemScanDraftLine[];
	scanDestination?: string;
	scanDestinationLabel?: string;
	scanDestinationOptions?: ItemScanOption[];
	onOperationScan?: (code: string, batch: string | undefined, context: unknown) => Promise<void>;
}>();
const emit = defineEmits<{
	close: [];
	select: [selection: { code: string; warehouse: string }];
	selectMultiple: [selections: { code: string; warehouse: string }[]];
	itemLoaded: [item: StockItem];
	scanItem: [code: string, batch?: string, context?: unknown];
	scanLocation: [name: string];
	scanDestination: [name: string];
	undoScan: [];
	retryScan: [];
	resolveScan: [selection: { code: string; source: string; batch: string; destination: string }];
	cancelScanResolution: [];
	finishScan: [];
}>();
const multiple = computed(
	() => props.mode === "add-multiple" && props.createBarcode === undefined,
);
const creating = ref(!!props.allowCreate && props.createBarcode !== undefined),
	pendingMultiple = ref(false);
const picker = useItemPicker(props, (item) => emit("itemLoaded", item));
const createdPreview = ref<{ code: string; name: string; image: string }>();
const createdImageItem = computed<StockItem | undefined>(
	() =>
		createdPreview.value && {
			code: createdPreview.value.code,
			name: createdPreview.value.name,
			image: createdPreview.value.image,
			category: "",
			uom: "",
			description: "",
			tracksBatch: false,
			tracksExpiry: false,
			locations: [],
			available: 0,
			loaned: 0,
			damaged: 0,
		},
);
const {
	reference,
	search,
	categoryFilters,
	uncategorizedFilter,
	warehouseFilters,
	onlyStock,
	selected,
	result,
	load,
	ensureSelected,
} = picker;
const visible = computed(() => result.rows);
const quantityLabel = computed(() =>
	props.purpose === "damaged"
		? "受损库存"
		: props.purpose === "inbound"
			? `${props.receivingWarehouse ? warehouseLabel(props.receivingWarehouse, reference.warehouses) : "目标库位"} 现有`
			: props.purpose === "count"
				? "账面库存"
				: "可用库存",
);
const pickerColumns = computed<DataColumn[]>(() => {
	return itemPickerColumns(quantityLabel.value, props.purpose || "outbound", multiple.value);
});
function earliestExpiry(row: Record<string, unknown>) {
	const item = row as unknown as StockItem;
	const earliest = earliestBatchExpiry(item);
	return earliest ? `最早到期 ${earliest}` : "";
}
const services = useOptionalInventoryServices();
const pickerPrefs = services
	? useColumnPreferences("item-picker.rows.v2", pickerColumns, reference, services)
	: undefined;
const tableRows = computed<DataTableRecord[]>(() =>
	visible.value.map((item) => ({
		kind: "record",
		id: picker.pickerRowKey(item),
		value: item as unknown as Record<string, unknown>,
	})),
);
function rowKey(row: Record<string, unknown>) {
	return picker.pickerRowKey(row as unknown as (typeof visible.value)[number]);
}
function setSelected(key: string, checked: boolean) {
	if (checked && !selected.value.includes(key)) selected.value.push(key);
	else if (!checked) selected.value = selected.value.filter((value) => value !== key);
}
function togglePickerRow(item: (typeof visible.value)[number]) {
	if (result.stale) return;
	if (multiple.value)
		setSelected(
			picker.pickerRowKey(item),
			!selected.value.includes(picker.pickerRowKey(item)),
		);
	else void selectExisting(item.code, item.pickerWarehouse || "");
}
function onPickerRowKeydown(event: KeyboardEvent, item: (typeof visible.value)[number]) {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	togglePickerRow(item);
}
function selectedRows() {
	return selected.value.map((key) => {
		const [code = "", warehouse = ""] = key.split("\u0000");
		return { code, warehouse };
	});
}
function asStockItem(row: Record<string, unknown>) {
	return row as unknown as (typeof visible.value)[number];
}
const { isMobile } = useResponsiveLayout();
const sidebarOpen = ref(true);
const { confirm } = useConfirm();
const creationSubtitle = computed(() => (props.context || "入库登记").replace(/\s*·\s*$/, ""));
const scanPanel = ref<InstanceType<typeof ScanPanel>>();
const scanStage = ref(false);
const browseScope = computed<BrowseScope>({
	get: () => ({
		...emptyScope(),
		categories: categoryFilters.value,
		uncategorized: uncategorizedFilter.value,
		warehouses: props.purpose === "inbound" ? [] : warehouseFilters.value,
	}),
	set: (scope) => {
		categoryFilters.value = scope.categories;
		uncategorizedFilter.value = scope.uncategorized;
		warehouseFilters.value = props.purpose === "inbound" ? [] : scope.warehouses;
	},
});
const scopeChips = computed(() => scopeFilterFieldChips(browseScope.value, reference));
const activeFilterCount = computed(() => scopeChips.value.length + Number(onlyStock.value));
const activeWarehouseLabel = computed(() =>
	props.activeWarehouse
		? warehouseLabel(props.activeWarehouse, reference.warehouses, props.activeWarehouse)
		: "",
);
const resolutionSource = ref("");
const resolutionBatch = ref("");
const resolutionDestination = ref("");
const resolutionBatches = computed(() => [
	...new Map(
		(props.scanResolution?.batchOptions || [])
			.filter(
				(option) =>
					(!props.scanResolution?.sourceRequired || resolutionSource.value) &&
					(!resolutionSource.value || option.source === resolutionSource.value),
			)
			.map((option) => [option.value, option]),
	).values(),
]);
const resolutionDestinations = computed(() =>
	(props.scanResolution?.destinationOptions || []).filter(
		(option) =>
			!props.scanResolution?.destinationExcludesSource ||
			option.value !== resolutionSource.value,
	),
);
const canResolveScan = computed(() => {
	const resolution = props.scanResolution;
	if (!resolution) return false;
	if (
		resolution.sourceRequired &&
		!resolution.sourceOptions.some((option) => option.value === resolutionSource.value)
	)
		return false;
	if (
		resolution.batchRequired &&
		!resolutionBatches.value.some((option) => option.value === resolutionBatch.value)
	)
		return false;
	if (
		resolution.destinationRequired &&
		!resolutionDestinations.value.some(
			(option) => option.value === resolutionDestination.value,
		)
	)
		return false;
	return true;
});
const scanCreate = ref(false);
const scanCreateContext = ref<unknown>();
const scanCreateCode = ref("");
const scanCreateError = ref("");
watch(
	() => props.scanResolution,
	(resolution) => {
		resolutionSource.value = resolution?.defaultSource || "";
		resolutionBatch.value = resolution?.defaultBatch || "";
		resolutionDestination.value = resolution?.defaultDestination || "";
	},
	{ immediate: true },
);
watch(resolutionSource, () => {
	if (!resolutionBatches.value.some((option) => option.value === resolutionBatch.value))
		resolutionBatch.value =
			resolutionBatches.value.length === 1 ? resolutionBatches.value[0]!.value : "";
	if (
		!resolutionDestinations.value.some(
			(option) => option.value === resolutionDestination.value,
		)
	)
		resolutionDestination.value =
			resolutionDestinations.value.length === 1
				? resolutionDestinations.value[0]!.value
				: "";
});
const itemEditor = useItemEditor(
	{ barcode: props.createBarcode, contextual: true, lazy: true },
	(item) => {
		createdPreview.value = {
			code: item.item_code,
			name: item.item_name,
			image: item.image || "",
		};
		if (props.scanMode === "operation" && scanCreate.value) {
			creating.value = false;
			void load();
			void itemEditor.reset();
			scanCreateCode.value = item.item_code;
			scanStage.value = true;
			void acceptCreatedScan();
		} else if (multiple.value) {
			const key = `${item.item_code}\u0000${props.activeWarehouse || ""}`;
			if (!selected.value.includes(key)) selected.value.push(key);
			creating.value = false;
			void load();
			void itemEditor.reset();
		} else emit("select", { code: item.item_code, warehouse: props.activeWarehouse || "" });
	},
);
const dirty = computed(() => itemEditor.dirty.value);
const content = ref<HTMLElement>(),
	resultsPort = ref<HTMLElement>();
let selectionScroll = 0,
	creationScroll = 0;
onMounted(() => {
	if (creating.value) void itemEditor.load();
});
async function showCreate(value: boolean) {
	if (value && !itemEditor.initialized.value) void itemEditor.load();
	const scrollport = resultsPort.value;
	if (creating.value) creationScroll = scrollport?.scrollTop || 0;
	else selectionScroll = scrollport?.scrollTop || 0;
	creating.value = value;
	pendingMultiple.value = false;
	await nextTick();
	content.value
		?.querySelector<HTMLInputElement>(value ? "form input" : ".preview-picker-selection input")
		?.focus({ preventScroll: true });
	if (scrollport) scrollport.scrollTop = value ? creationScroll : selectionScroll;
}
function clearScope(field: ScopeFilterField | "period") {
	if (field === "categories") {
		categoryFilters.value = [];
		uncategorizedFilter.value = false;
	} else if (field === "warehouses") warehouseFilters.value = [];
}
function createItem() {
	content.value?.querySelector<HTMLFormElement>(".picker-creation-scroll form")?.requestSubmit();
}
async function openScanner() {
	scanStage.value = true;
	await nextTick();
	scanPanel.value?.show();
}
onMounted(() => {
	if (props.startInScanMode) void openScanner();
});
function scanItem(code: string, batch?: string, context?: unknown) {
	if (props.scanMode === "operation") {
		if (multiple.value) {
			const index = selected.value.indexOf(`${code}\u0000`);
			if (index >= 0) selected.value.splice(index, 1);
		}
		if (props.onOperationScan) return props.onOperationScan(code, batch, context);
		emit("scanItem", code, batch);
	} else if (multiple.value) {
		const key = `${code}\u0000`;
		if (!selected.value.includes(key)) selected.value.push(key);
	} else selectExisting(code, "");
}
function scanLocation(name: string) {
	if (props.scanMode === "operation") emit("scanLocation", name);
	else warehouseFilters.value = [name];
}
function captureScanContext() {
	return {
		activeWarehouse: props.activeWarehouse || "",
		destination: props.scanDestination || "",
		timestamp: props.timestamp || "",
	};
}
function scanCreateBarcode(barcode: string, context?: unknown) {
	if (!props.allowCreate) return;
	scanCreate.value = true;
	scanCreateError.value = "";
	scanCreateCode.value = "";
	scanCreateContext.value = context;
	itemEditor.setBarcode(barcode);
	void showCreate(true);
}
async function acceptCreatedScan() {
	const code = scanCreateCode.value;
	if (!code || !props.onOperationScan) return;
	scanCreateError.value = "";
	await nextTick();
	scanPanel.value?.show();
	try {
		await props.onOperationScan(code, undefined, scanCreateContext.value);
		scanCreate.value = false;
		scanPanel.value?.resumeAfterCreate();
	} catch (reason) {
		scanCreateError.value = reason instanceof Error ? reason.message : "扫描物品未能添加";
	}
}
function finishScan() {
	scanStage.value = false;
	emit("finishScan");
}
function confirmScanResolution() {
	if (!props.scanResolution || !canResolveScan.value) return;
	emit("resolveScan", {
		code: props.scanResolution.code,
		source: resolutionSource.value,
		batch: resolutionBatch.value,
		destination: resolutionDestination.value,
	});
}
async function close() {
	if (itemEditor.busy.value || itemEditor.files.busy.value) return;
	pendingMultiple.value = false;
	if (
		dirty.value &&
		!(await confirm({ title: "放弃填写？", message: "未保存的物品输入将丢失。" }))
	)
		return;
	itemEditor.discard();
	emit("close");
}
async function commitSelection() {
	if (pendingMultiple.value || !selected.value.length) return;
	if (
		dirty.value &&
		!(await confirm({ title: "放弃填写？", message: "未保存的物品输入将丢失。" }))
	)
		return;
	pendingMultiple.value = true;
	try {
		if (dirty.value) itemEditor.discard();
		picker.result.error = "";
		await Promise.all([...new Set(selectedRows().map((row) => row.code))].map(ensureSelected));
		if (!picker.result.error) emit("selectMultiple", selectedRows());
	} catch (reason) {
		picker.result.error = reason instanceof Error ? reason.message : "物品资料加载失败";
	} finally {
		pendingMultiple.value = false;
	}
}

async function selectExisting(code: string, warehouse: string) {
	if (
		dirty.value &&
		!(await confirm({ title: "放弃填写？", message: "未保存的物品输入将丢失。" }))
	)
		return;
	if (dirty.value) itemEditor.discard();
	await ensureSelected(code);
	emit("select", { code, warehouse });
}
</script>
<template>
	<Overlay
		:title="creating ? '新建物品' : '选择物品'"
		:subtitle="creating ? creationSubtitle : undefined"
		panel-class="preview-item-picker-dialog"
		content-class="preview-item-picker-content"
		:adaptive-creation="creating"
		@close="close"
	>
		<div ref="content" class="preview-picker-content">
			<div v-show="!creating" class="preview-picker-selection">
				<BrowseToolbar
					class="picker-chrome"
					title="物品"
					:summary="
						result.initialized
							? `${result.total} 个匹配物品 · 已选 ${selected.length}`
							: ''
					"
					v-model:search="search"
					search-label="搜索物品名称、编号或条码"
					:filter-count="activeFilterCount"
					:active="true"
					:scannable="true"
					:sidebar-open="sidebarOpen"
					:sidebar-available="true"
					:show-sidebar-toggle="false"
					@scan="openScanner"
				>
					<template #persistent>
						<UiButton v-if="allowCreate" @click="showCreate(true)">新建物品</UiButton>
					</template>
					<template #filters>
						<div class="browse-filter-mega picker-filter-panel">
							<BrowseFilters
								v-model="browseScope"
								disclosure-mode
								:fields="
									purpose === 'inbound'
										? ['categories']
										: ['categories', 'warehouses']
								"
								:hierarchy-in-rail="sidebarOpen && !isMobile"
							/>
							<details
								v-if="showOnlyStockFilter(purpose)"
								class="browse-filter-disclosure"
								data-filter-field="onlyStock"
							>
								<summary class="ti-disclosure">
									<DisclosureIcon variant="inline" /> 库存条件<small>{{
										onlyStock ? "仅有可用库存" : "不限"
									}}</small>
								</summary>
								<label class="preview-choice-label"
									><input
										type="checkbox"
										v-model="onlyStock"
									/>仅有可用库存</label
								>
							</details>
						</div>
					</template>
					<template #chips="{ openFilters, editFilter }">
						<BrowseChip
							v-for="chip in scopeChips"
							:key="chip.key"
							:label="chip.label"
							@edit="editFilter(chip.field)"
							@remove="clearScope(chip.field)"
						/>
						<BrowseChip
							v-if="onlyStock"
							label="仅有可用库存"
							@edit="openFilters"
							@remove="onlyStock = false"
						/>
					</template>
				</BrowseToolbar>
				<p v-if="result.error" class="notice-bar danger" role="alert">
					{{ result.error }}
				</p>
				<section v-show="scanStage" class="picker-scan-stage" aria-label="快速扫描">
					<p v-if="scanMode === 'operation'" class="muted scan-help">
						每次扫描添加1个库存单位
					</p>
					<p v-if="activeWarehouseLabel" class="muted">
						{{
							scanMode === "operation"
								? scanDestinationLabel === "入库位置"
									? "当前入库位置"
									: "当前来源库位"
								: "扫描库位筛选"
						}}：{{ activeWarehouseLabel }}
					</p>
					<SearchSelect
						v-if="scanMode === 'operation' && scanDestinationOptions?.length"
						:label="scanDestinationLabel || '目标库位'"
						:model-value="scanDestination"
						:options="scanDestinationOptions"
						@update:model-value="emit('scanDestination', $event)"
					/>
					<p
						v-else-if="scanMode === 'operation' && scanDestinationLabel"
						class="muted"
						role="alert"
					>
						没有可用的{{ scanDestinationLabel }}；请检查操作库位设置。
					</p>
					<p v-if="scanFeedback" class="notice-bar success" role="status">
						{{ scanFeedback }}
						<UiButton v-if="canUndoScan" variant="ghost" @click="emit('undoScan')"
							>撤销最近扫描</UiButton
						>
					</p>
					<p v-if="scanCreateError" class="notice-bar danger" role="alert">
						{{ scanCreateError }}
						<UiButton @click="acceptCreatedScan">重试添加物品</UiButton>
					</p>
					<p v-if="scanError" class="notice-bar danger" role="alert">
						{{ scanError }}
						<UiButton @click="emit('retryScan')">重试扫描</UiButton>
					</p>
					<section
						v-if="scanResolution"
						class="scan-resolution surface"
						aria-labelledby="scan-resolution-title"
					>
						<h3 id="scan-resolution-title">
							确认扫描明细 · {{ scanResolution.name }}
						</h3>
						<p class="muted">
							请先确认来源、批次和目标位置，再添加 1 {{ scanResolution.uom }}。
						</p>
						<SearchSelect
							v-if="scanResolution.sourceOptions.length"
							label="来源库位"
							v-model="resolutionSource"
							:options="scanResolution.sourceOptions"
						/>
						<p v-else-if="scanResolution.sourceRequired" role="alert">
							没有可用来源库位；请检查现有草稿数量和库存。
						</p>
						<SearchSelect
							v-if="scanResolution.batchOptions.length"
							label="批次"
							v-model="resolutionBatch"
							:options="
								resolutionBatches.map((option) => ({
									value: option.value,
									label: option.label,
									detail: option.detail,
								}))
							"
						/>
						<p v-else-if="scanResolution.batchRequired" role="alert">
							没有可用批次可供选择。
						</p>
						<SearchSelect
							v-if="resolutionDestinations.length"
							label="目标库位"
							v-model="resolutionDestination"
							:options="resolutionDestinations"
						/>
						<p v-else-if="scanResolution.destinationRequired" role="alert">
							请先选择有效的目标库位。
						</p>
						<div class="picker-actions">
							<UiButton @click="emit('cancelScanResolution')">取消此扫描</UiButton>
							<UiButton
								variant="primary"
								:disabled="!canResolveScan"
								@click="confirmScanResolution"
								>添加 1 {{ scanResolution.uom }}</UiButton
							>
						</div>
					</section>
					<section
						v-if="scanMode === 'operation' && scanLines?.length"
						class="scan-draft-summary surface"
						aria-label="已扫描明细"
					>
						<h3>已扫描明细</h3>
						<ul>
							<li
								v-for="line in scanLines"
								:key="line.id || line.code + line.warehouse + line.batch"
							>
								<strong>{{ line.name }} · {{ line.code }}</strong>
								<span>{{ line.qty }} {{ line.uom }}</span>
								<small
									>{{ line.warehouse
									}}<template v-if="line.batch">
										· 批次 {{ line.batch }}</template
									></small
								>
							</li>
						</ul>
					</section>
					<ScanPanel
						ref="scanPanel"
						:allow-create="allowCreate"
						:hide-trigger="true"
						:inline="true"
						:hide-finish-action="true"
						:auto-unique="scanMode === 'operation'"
						:paused="creating || scanCreate || Boolean(scanResolution)"
						:capture-context="captureScanContext"
						:accept-item="scanItem"
						:accept-location="scanLocation"
						@close="scanStage = false"
						@finish="finishScan"
						@create="scanCreateBarcode"
					/>
				</section>
				<div v-show="!scanStage" class="picker-browser-grid">
					<aside
						v-if="!isMobile"
						class="picker-filter-rail"
						:class="{ 'picker-filter-rail--collapsed': !sidebarOpen }"
					>
						<div class="filter-rail-heading">
							<h3 v-if="sidebarOpen">筛选</h3>
							<FilterRailEdge
								:open="sidebarOpen"
								:active="activeFilterCount > 0"
								@toggle="sidebarOpen = !sidebarOpen"
							/>
						</div>
						<div v-if="sidebarOpen">
							<BrowseFilters
								v-model="browseScope"
								:fields="
									purpose === 'inbound'
										? ['categories']
										: ['categories', 'warehouses']
								"
							/>
						</div>
					</aside>
					<div
						ref="resultsPort"
						class="picker-results-scroll"
						data-browse-scroll="picker-results"
						@scroll="
							if (
								isMobile &&
								result.next !== null &&
								!result.loadingMore &&
								resultsPort &&
								resultsPort.scrollTop + resultsPort.clientHeight >=
									resultsPort.scrollHeight - 160
							)
								load(true);
						"
					>
						<section
							v-if="createdPreview && multiple"
							class="picker-created-preview"
							aria-label="刚创建并已选择的物品"
						>
							<div class="picker-created-image">
								<ItemImage
									v-if="createdImageItem"
									:item="createdImageItem"
									:thumbnail-size="48"
									:target-size="48"
								/>
							</div>
							<div class="picker-created-copy">
								<strong>刚创建 · 已选择</strong
								><span>{{ createdPreview.name }} · {{ createdPreview.code }}</span>
								<small v-if="props.activeWarehouse"
									>入库位置：{{
										warehouseLabel(props.activeWarehouse, reference.warehouses)
									}}</small
								>
							</div>
						</section>
						<div
							class="picker-table-region"
							:data-refreshing="
								result.loading && result.rows.length > 0 && !result.loadingMore
									? 'true'
									: undefined
							"
							:inert="
								result.loading && result.rows.length > 0 && !result.loadingMore
									? true
									: undefined
							"
							:aria-busy="
								result.loading && result.rows.length > 0 && !result.loadingMore
									? 'true'
									: undefined
							"
						>
							<p v-if="result.stale" class="muted" role="status">
								物品列表正在更新…
							</p>
							<div
								v-if="isMobile"
								class="picker-phone-list stock-list"
								role="listbox"
								aria-label="选择物品"
								:aria-multiselectable="multiple ? 'true' : undefined"
							>
								<p v-if="result.error" class="empty-panel" role="alert">
									{{ result.error }}
									<UiButton @click="picker.retry()">重试</UiButton>
								</p>
								<p
									v-else-if="!result.initialized && result.loading"
									class="muted picker-list-message"
									role="status"
								>
									正在加载物品…
								</p>
								<p v-else-if="!visible.length" class="muted picker-list-message">
									{{ onlyStock ? "没有匹配的库存位置" : "没有匹配的物品" }}
								</p>
								<article
									v-for="item in visible"
									:key="picker.pickerRowKey(item)"
									class="stock-list-row picker-phone-row"
									:class="{
										selected: selected.includes(picker.pickerRowKey(item)),
									}"
									:aria-selected="selected.includes(picker.pickerRowKey(item))"
									:aria-label="`${item.name}，${item.code}${item.category ? ` · ${item.category}` : ''}`"
									:aria-disabled="result.stale"
									:tabindex="result.stale ? -1 : 0"
									role="option"
									@click="togglePickerRow(item)"
									@keydown="onPickerRowKeydown($event, item)"
								>
									<div class="stock-list-image picker-phone-image" @click.stop>
										<ItemImage
											:item="item"
											:thumbnail-size="56"
											:target-size="56"
										/>
									</div>
									<span class="stock-list-identity picker-phone-identity">
										<strong class="stock-list-name">{{ item.name }}</strong>
										<span class="stock-list-meta"
											>{{ item.code
											}}<template v-if="item.category">
												· {{ item.category }}</template
											></span
										>
										<small
											v-if="purpose === 'inbound' && receivingWarehouse"
											class="picker-phone-location"
											>目标位置 ·
											{{
												warehouseLabel(
													receivingWarehouse,
													reference.warehouses,
												)
											}}</small
										>
										<small
											v-if="item.pickerWarehouse && purpose !== 'inbound'"
											class="picker-phone-location"
											:title="
												warehousePath(
													item.pickerWarehouse,
													reference.warehouses,
												)
											"
											>{{
												warehouseLabel(
													item.pickerWarehouse,
													reference.warehouses,
												)
											}}</small
										>
										<small
											v-else-if="purpose !== 'inbound'"
											class="picker-phone-location"
											>暂无库存 · 选择目标库位</small
										>
										<small
											v-if="earliestExpiry(item)"
											class="picker-phone-expiry"
											>{{ earliestExpiry(item) }}</small
										>
									</span>
									<span class="stock-list-quantity picker-phone-quantity">
										<strong
											>{{ item.pickerQuantity || 0 }} {{ item.uom }}</strong
										>
										<span>{{
											purpose === "inbound" ? "现有" : quantityLabel
										}}</span>
									</span>
									<span
										class="stock-list-checkbox picker-phone-check"
										aria-hidden="true"
									>
										<span class="picker-phone-checkmark">{{
											selected.includes(picker.pickerRowKey(item)) ? "✓" : ""
										}}</span>
									</span>
								</article>
								<p
									v-if="result.loading && result.rows.length"
									class="muted picker-list-message"
									role="status"
								>
									物品列表正在更新…
								</p>
								<UiButton
									v-if="result.next !== null"
									class="picker-phone-more"
									:disabled="result.loadingMore"
									@click="load(true)"
									>{{ result.loadingMore ? "正在加载…" : "加载更多" }}</UiButton
								>
							</div>
							<DataTable
								v-else
								ariaLabel="按库存位置显示的物品"
								:columns="pickerColumns"
								:column-preferences="pickerPrefs"
								:rows="tableRows"
								:loading="result.loading"
								:initialized="result.initialized"
								:error="result.error"
								:retained="
									result.stale ||
									(result.loading &&
										result.rows.length > 0 &&
										!result.loadingMore)
								"
								:stale="
									result.stale ||
									(result.loading &&
										result.rows.length > 0 &&
										!result.loadingMore)
								"
								:empty-text="onlyStock ? '没有匹配的库存位置' : '没有匹配的物品'"
								:selection-enabled="multiple"
								:selected-keys="selected"
								:row-key="rowKey"
								:selection-label="(row) => String(row.name || row.code || '')"
								:has-more="result.next !== null"
								:loading-more="result.loadingMore"
								:loaded-count="result.rows.length"
								:total-count="result.total"
								@select="setSelected"
								@load-more="load(true)"
								@retry="picker.retry()"
								class="picker-data-table browse-table--compact"
							>
								<template #cell="{ column, row }">
									<div v-if="column.id === 'image'" class="picker-image-cell">
										<ItemImage
											:item="asStockItem(row)"
											:thumbnail-size="isMobile ? 36 : 32"
											:target-size="isMobile ? 44 : 36"
										/>
									</div>
									<div
										v-else-if="column.id === 'name'"
										class="picker-table-name"
									>
										<strong>{{ row.name }}</strong>
										<small v-if="earliestExpiry(row)">{{
											earliestExpiry(row)
										}}</small>
									</div>
									<template v-else-if="column.id === 'warehouse'">
										<span
											v-if="row.pickerWarehouse"
											:title="
												warehousePath(
													String(row.pickerWarehouse),
													reference.warehouses,
												)
											"
											>{{
												warehouseLabel(
													String(row.pickerWarehouse),
													reference.warehouses,
												)
											}}</span
										>
										<template v-else>暂无库存 · 选择目标库位</template>
									</template>
									<template v-else-if="column.id === 'quantity'">
										{{ row.pickerQuantity || 0 }} {{ row.uom }}
									</template>
									<UiButton
										v-else-if="column.id === 'action' && !multiple"
										size="compact"
										:disabled="result.stale"
										@click="
											selectExisting(
												String(row.code),
												String(row.pickerWarehouse || ''),
											)
										"
										>选择</UiButton
									>
									<template v-else>{{ row[column.id] }}</template>
								</template>
							</DataTable>
						</div>
					</div>
				</div>
			</div>
			<div v-show="creating" class="picker-creation-scroll">
				<ItemEditorView :controller="itemEditor" contextual @cancel="showCreate(false)" />
			</div>
		</div>
		<template #footer>
			<UiButton
				v-if="scanStage && !creating"
				variant="primary"
				@click="scanPanel?.finishScanning()"
				>完成扫描</UiButton
			>
			<template v-else-if="creating">
				<UiButton @click="close">取消编辑</UiButton>
				<UiButton
					class="picker-return-choice"
					aria-label="返回选择物品（保留填写）"
					title="返回选择物品（保留填写）"
					@click="showCreate(false)"
					><span class="picker-return-short">返回选择</span
					><span class="picker-return-full">返回选择物品（保留填写）</span></UiButton
				>
				<UiButton
					variant="primary"
					:disabled="itemEditor.busy.value || pendingMultiple"
					:loading="itemEditor.busy.value"
					@click="createItem"
					>创建并使用物品</UiButton
				>
			</template>
			<UiButton
				v-else-if="multiple"
				variant="primary"
				:disabled="!selected.length || pendingMultiple"
				:loading="pendingMultiple"
				loading-label="正在添加所选物品…"
				@click="commitSelection"
				>添加所选（{{ selected.length }}）</UiButton
			>
		</template>
	</Overlay>
</template>

<style scoped>
.picker-data-table :deep(table) {
	min-width: 780px;
}
.picker-browser-grid:has(> .picker-filter-rail--collapsed) {
	grid-template-columns: 40px minmax(0, 1fr);
}
.picker-filter-rail--collapsed {
	padding: 8px 0;
	overflow: visible;
}
.picker-filter-rail--collapsed .filter-rail-heading {
	justify-content: center;
}
:global(.preview-item-picker-dialog .dialog-footer) {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 8px;
}
@media (min-width: 1024px) {
	.picker-chrome :deep(.preview-filter-control) {
		display: none;
	}
}
@media (min-width: 641px) {
	.picker-return-short {
		display: none;
	}
}
@media (max-width: 640px) {
	.picker-return-full {
		display: none;
	}
	.picker-return-short {
		white-space: nowrap;
	}
	:global(.preview-item-picker-dialog .dialog-footer) {
		flex-wrap: wrap;
	}
	:global(.preview-item-picker-dialog .dialog-footer > :last-child) {
		order: 2;
		width: 100%;
	}
	:global(.preview-item-picker-dialog .dialog-footer > :not(:last-child)) {
		order: 1;
		flex: 1;
	}
}
.picker-data-table :deep(.picker-code-column),
.picker-data-table :deep(.picker-quantity-column),
.picker-data-table :deep(.picker-category-column) {
	white-space: nowrap;
}
.picker-data-table :deep(.picker-image-column) {
	width: 56px;
	min-width: 56px;
}
.picker-data-table :deep(.picker-name-column) {
	width: auto;
	min-width: 260px;
}
.picker-data-table :deep(.picker-code-column) {
	word-break: keep-all;
}
.picker-data-table :deep(td) {
	padding-block: var(--p-space-1);
}
.picker-data-table :deep(td:first-child img),
.picker-data-table :deep(td:first-child .item-image) {
	width: 36px;
	height: 36px;
}
.picker-image-cell {
	display: grid;
	width: 36px;
	height: 36px;
	flex: none;
	place-items: center;
}
.picker-image-cell :deep(.item-image-button),
.picker-image-cell :deep(.async-image) {
	flex: none;
}
.picker-table-name {
	display: grid;
	gap: 2px;
}
.picker-table-name small {
	color: var(--p-muted);
}
.picker-phone-list {
	align-content: start;
}
.picker-phone-row {
	grid-template-columns: 56px minmax(0, 1fr) auto 44px;
	min-height: 72px;
	gap: 8px;
	padding: 8px 4px;
}
.picker-phone-row[aria-disabled="true"] {
	opacity: 0.72;
}
.picker-phone-image,
.picker-phone-image :deep(.item-image-button),
.picker-phone-image :deep(.preview-item-image),
.picker-phone-image :deep(.async-image) {
	width: 56px;
	height: 56px;
	min-width: 56px;
}
.picker-phone-identity {
	align-self: center;
}
.picker-phone-location,
.picker-phone-expiry {
	color: var(--p-muted);
	font-size: var(--p-small);
	line-height: 1.3;
}
.picker-phone-quantity {
	max-width: 92px;
	white-space: normal;
	text-align: right;
}
.picker-phone-quantity > strong {
	font-size: var(--p-small);
}
.picker-phone-quantity > span {
	color: var(--p-muted);
	font-size: var(--p-small);
}
.picker-phone-checkmark {
	display: grid;
	width: 22px;
	height: 22px;
	place-items: center;
	border: 1px solid var(--p-border-strong, var(--p-border));
	border-radius: 5px;
	color: white;
	font-size: 15px;
}
.picker-phone-row.selected .picker-phone-checkmark {
	border-color: var(--p-accent);
	background: var(--p-accent);
}
.picker-list-message {
	margin: var(--p-space-4);
}
.picker-phone-more {
	justify-self: center;
	margin: var(--p-space-3);
}
@media (min-width: 1280px) {
	.picker-data-table :deep(table) {
		width: 100%;
		min-width: 0;
		table-layout: fixed;
	}
	.picker-data-table :deep(.picker-quantity-column),
	.picker-data-table :deep(.picker-warehouse-column) {
		width: 112px;
	}
	.picker-data-table :deep(.picker-category-column) {
		width: 128px;
	}
	.picker-data-table :deep(.data-table-settings-heading) {
		width: 56px;
	}
	.picker-data-table :deep(.picker-name-column) {
		width: auto;
		min-width: 180px;
	}
	.picker-data-table :deep(.picker-code-column) {
		width: 164px;
	}
}
@media (max-width: 767px) {
	.picker-image-cell {
		width: 44px;
		height: 44px;
	}
}
.picker-created-preview {
	display: flex;
	align-items: center;
	gap: var(--p-space-3);
	margin-block-end: var(--p-space-2);
	padding: var(--p-space-2) var(--p-space-3);
	border: 1px solid var(--p-accent);
	border-radius: var(--p-radius-control);
	background: var(--p-soft);
}
.picker-created-image {
	width: 48px;
	height: 48px;
	flex: 0 0 48px;
	overflow: hidden;
}
.picker-created-image :deep(.item-image-button),
.picker-created-image :deep(.async-image) {
	flex: none;
}
.picker-created-copy {
	display: grid;
	flex: 1;
	min-width: 0;
	gap: 2px;
	overflow-wrap: anywhere;
}
.picker-created-copy > * {
	min-width: 0;
	overflow-wrap: anywhere;
}
.picker-created-preview small {
	color: var(--p-muted);
}
.picker-scan-stage {
	display: grid;
	flex: 1;
	gap: var(--p-space-3);
	min-width: 0;
	min-height: 0;
	overflow: auto;
	overscroll-behavior: contain;
	padding: var(--p-space-3);
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
}
.picker-scan-stage > .scan-resolution,
.picker-scan-stage > .scan-draft-summary {
	min-width: 0;
}
.picker-scan-stage .scan-draft-summary ul {
	max-height: 9rem;
	overflow: auto;
	margin: var(--p-space-2) 0 0;
	padding-inline-start: 1.25rem;
}
.picker-scan-stage .scan-draft-summary li {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0 var(--p-space-3);
	padding-block: var(--p-space-2);
	border-top: 1px solid var(--p-border);
}
.picker-scan-stage .scan-draft-summary small {
	grid-column: 1 / -1;
}
.picker-scan-stage .scan-panel-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--p-space-3);
}
.picker-scan-stage .scan-panel-heading h2 {
	margin: 0;
}
.picker-creation-scroll {
	flex: 1;
	min-height: 0;
	overflow: auto;
	overscroll-behavior: contain;
}
.preview-picker-thumb :deep(svg) {
	width: 100%;
	height: 100%;
}
.preview-picker-content {
	container: preview-creation / inline-size;
}
.preview-creation-fields {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--p-space-4);
}
.preview-creation-fields > * {
	min-width: 0;
}
.preview-creation-fields .full-width {
	grid-column: 1 / -1;
}
.preview-supporting-editors:empty {
	display: none;
}
.preview-creation-fields > .muted,
.preview-creation-fields > [role="alert"] {
	grid-column: 1 / -1;
}
/* The dialog body, rather than the viewport, determines readable columns. */
@container preview-creation (max-width: 38em) {
	.preview-creation-fields {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
