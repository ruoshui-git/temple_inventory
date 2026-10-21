<script setup lang="ts">
import { useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, ref, nextTick, watch, onMounted } from "vue";
import VirtualList from "../../components/ui/VirtualList.vue";
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

export type ItemScanOption = {
	value: string;
	label: string;
	detail?: string;
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
	activeWarehouse?: string;
	scanResolution?: ItemScanResolution;
	scanLines?: ItemScanDraftLine[];
	scanDestination?: string;
	scanDestinationLabel?: string;
	scanDestinationOptions?: ItemScanOption[];
	onOperationScan?: (code: string, batch: string | undefined, context: unknown) => Promise<void>;
}>();
const emit = defineEmits<{
	close: [];
	select: [code: string];
	selectMultiple: [codes: string[]];
	notify: [message: string];
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
	discard = ref(false),
	pendingMultiple = ref(false),
	pendingSelection = ref<string>();
const picker = useItemPicker(props, (item) => emit("itemLoaded", item));
const {
	reference,
	search,
	categoryFilters,
	uncategorizedFilter,
	warehouseFilters,
	onlyStock,
	selected,
	result,
	details: detailItem,
	detailError,
	detailLoading,
	load,
	toggle,
} = picker;
const visible = computed(() => result.rows);
const { isMobile } = useResponsiveLayout();
const sidebarOpen = ref(true);
const scanPanel = ref<InstanceType<typeof ScanPanel>>();
const scanStage = ref(false);
const browseScope = computed<BrowseScope>({
	get: () => ({
		...emptyScope(),
		categories: categoryFilters.value,
		uncategorized: uncategorizedFilter.value,
		warehouses: warehouseFilters.value,
	}),
	set: (scope) => {
		categoryFilters.value = scope.categories;
		uncategorizedFilter.value = scope.uncategorized;
		warehouseFilters.value = scope.warehouses;
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
		emit("notify", "物品已创建；取消操作单不会删除物品、分类或单位。");
		if (props.scanMode === "operation" && scanCreate.value) {
			creating.value = false;
			void load();
			void itemEditor.reset();
			scanCreateCode.value = item.item_code;
			scanStage.value = true;
			void acceptCreatedScan();
		} else if (multiple.value) {
			if (!selected.value.includes(item.item_code)) selected.value.push(item.item_code);
			creating.value = false;
			void load();
			void itemEditor.reset();
		} else emit("select", item.item_code);
	},
);
const dirty = computed(() => itemEditor.dirty.value);
const content = ref<HTMLElement>(),
	discardPanel = ref<HTMLElement>(),
	detailPanel = ref<HTMLElement>(),
	resultsPort = ref<HTMLElement>();
const detailCode = ref("");
let detailInvoker: HTMLElement | undefined;
let selectionScroll = 0,
	creationScroll = 0;
watch(discard, async (value) => {
	if (value) {
		await nextTick();
		discardPanel.value?.focus();
	}
});
async function showStockDetails(code: string) {
	if (code) detailInvoker = document.activeElement as HTMLElement;
	detailCode.value = code;
	await picker.showDetail(code);
	await nextTick();
	if (code) detailPanel.value?.focus({ preventScroll: true });
	else {
		detailInvoker?.focus({ preventScroll: true });
		detailInvoker?.scrollIntoView({ block: "nearest" });
	}
}
onMounted(() => {
	if (creating.value) void itemEditor.load();
});
async function showCreate(value: boolean) {
	if (value && !itemEditor.initialized.value) void itemEditor.load();
	const scrollport = resultsPort.value;
	if (creating.value) creationScroll = scrollport?.scrollTop || 0;
	else selectionScroll = scrollport?.scrollTop || 0;
	creating.value = value;
	discard.value = false;
	pendingMultiple.value = false;
	pendingSelection.value = undefined;
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
async function openScanner() {
	scanStage.value = true;
	await nextTick();
	scanPanel.value?.show();
}
function scanItem(code: string, batch?: string, context?: unknown) {
	if (props.scanMode === "operation") {
		if (multiple.value) {
			const index = selected.value.indexOf(code);
			if (index >= 0) selected.value.splice(index, 1);
		}
		if (props.onOperationScan) return props.onOperationScan(code, batch, context);
		emit("scanItem", code, batch);
	} else if (multiple.value) {
		if (!selected.value.includes(code)) selected.value.push(code);
	} else selectExisting(code);
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
function close() {
	if (itemEditor.busy.value || itemEditor.files.busy.value) return;
	pendingSelection.value = undefined;
	pendingMultiple.value = false;
	if (dirty.value) discard.value = true;
	else emit("close");
}
function commitSelection() {
	if (dirty.value) {
		pendingMultiple.value = true;
		discard.value = true;
	} else emit("selectMultiple", [...selected.value]);
}
function selectExisting(code: string) {
	if (dirty.value) {
		pendingSelection.value = code;
		discard.value = true;
	} else emit("select", code);
}
function discardEdits() {
	itemEditor.discard();
	if (pendingMultiple.value) emit("selectMultiple", [...selected.value]);
	else if (pendingSelection.value) emit("select", pendingSelection.value);
	else emit("close");
}
const warehouseReference = useOptionalReferenceData();
</script>
<template>
	<Overlay
		:title="creating ? '新建物品' : '选择物品'"
		:subtitle="creating ? context || '入库登记' : undefined"
		panel-class="preview-item-picker-dialog"
		content-class="preview-item-picker-content"
		:adaptive-creation="creating"
		@close="close"
	>
		<div ref="content" class="preview-picker-content">
			<div
				v-show="!creating"
				class="preview-picker-selection"
				:inert="discard ? true : undefined"
			>
				<BrowseToolbar
					class="picker-chrome"
					title="物品"
					:summary="`${result.total} 个匹配物品 · 已选 ${selected.length}`"
					v-model:search="search"
					search-label="搜索物品名称、编号或条码"
					:filter-count="activeFilterCount"
					:active="true"
					:scannable="true"
					:sidebar-open="sidebarOpen"
					:sidebar-available="true"
					@sidebar="sidebarOpen = !sidebarOpen"
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
								:fields="['categories', 'warehouses']"
								:hierarchy-in-rail="sidebarOpen && !isMobile"
							/>
							<details
								class="browse-filter-disclosure"
								data-filter-field="onlyStock"
							>
								<summary>
									库存条件<small>{{
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
					<aside v-if="sidebarOpen && !isMobile" class="picker-filter-rail">
						<h3>类别与仓库</h3>
						<BrowseFilters
							v-model="browseScope"
							:fields="['categories', 'warehouses']"
						/>
					</aside>
					<div
						ref="resultsPort"
						class="picker-results-scroll"
						data-browse-scroll="picker-results"
					>
						<p v-if="result.loading" role="status">正在加载物品…</p>
						<p v-if="result.error" role="alert">
							{{ result.error }}
							<UiButton @click="picker.retry()">重试加载</UiButton>
						</p>
						<div v-show="!detailCode && (!result.loading || result.rows.length)">
							<VirtualList :keys="visible.map((item) => item.code)" :estimate="150">
								<template #default="{ index }">
									<div
										v-if="visible[index]"
										class="picker-row"
										:class="{
											'is-selected': selected.includes(visible[index]!.code),
										}"
										:data-picker-code="visible[index]!.code"
									>
										<input
											v-if="multiple"
											type="checkbox"
											:checked="selected.includes(visible[index]!.code)"
											:aria-label="`选择${visible[index]!.name}`"
											@change="toggle(visible[index]!.code)"
										/>
										<span v-else class="picker-checkbox-slot"></span>
										<span class="preview-picker-thumb"
											><ItemImage :item="visible[index]!"
										/></span>
										<span class="picker-identity">
											<strong>{{ visible[index]!.name }}</strong>
											<small
												>{{ visible[index]!.code
												}}<template v-if="visible[index]!.category">
													· {{ visible[index]!.category }}</template
												></small
											>
											<small
												>可用 {{ visible[index]!.available }}
												{{ visible[index]!.uom }}</small
											>
										</span>
										<span class="picker-actions">
											<UiButton
												v-if="!multiple"
												:disabled="result.stale"
												@click="selectExisting(visible[index]!.code)"
												>选择</UiButton
											>
											<UiButton
												:disabled="result.stale"
												@click="showStockDetails(visible[index]!.code)"
												>库存详情</UiButton
											>
										</span>
									</div>
								</template>
							</VirtualList>
							<UiButton
								v-if="result.next !== null"
								:loading="result.loading"
								@click="load(true)"
								>加载更多 · {{ result.rows.length }} / {{ result.total }}</UiButton
							>
						</div>
						<p v-if="detailLoading" role="status">正在读取库存详情…</p>
						<p v-if="detailError" role="alert">{{ detailError }}</p>
						<section
							v-if="detailItem"
							ref="detailPanel"
							tabindex="-1"
							class="picker-detail"
						>
							<h3>{{ detailItem.name }}</h3>
							<p v-for="place in detailItem.locations" :key="place.location">
								{{
									warehouseLabel(
										place.location,
										warehouseReference?.warehouses || [],
										place.label,
									)
								}}
								· 可用 {{ place.available }} {{ detailItem.uom }}
								<small v-for="batch in place.batches" :key="batch.id"
									>{{ batch.id }} · {{ batch.expiry || "无效期" }} ·
									{{ batch.available }} {{ detailItem.uom }}</small
								>
							</p>
							<UiButton @click="showStockDetails('')">返回物品列表</UiButton>
						</section>
						<p v-if="!result.loading && !result.error && !visible.length">
							没有匹配的物品
						</p>
					</div>
				</div>
			</div>
			<div v-show="creating" class="picker-creation-scroll" :inert="discard || undefined">
				<ItemEditorView :controller="itemEditor" contextual @cancel="showCreate(false)" />
			</div>

			<div v-if="discard" ref="discardPanel" tabindex="-1" role="alert">
				<p>放弃未保存的物品、分类或单位资料？已创建的分类和单位仍会保留。</p>
				<UiButton @click="showCreate(true)">继续填写</UiButton
				><UiButton @click="discardEdits">放弃填写</UiButton>
			</div>
		</div>
		<template #footer>
			<UiButton
				v-if="scanStage && !creating && !discard"
				variant="primary"
				@click="scanPanel?.finishScanning()"
				>完成扫描</UiButton
			>
			<UiButton v-else-if="creating && !discard" @click="showCreate(false)"
				>返回选择物品（保留填写）</UiButton
			>
			<UiButton
				v-else-if="multiple && !discard"
				variant="primary"
				:disabled="!selected.length || result.stale || itemEditor.busy.value"
				@click="commitSelection"
				>添加所选（{{ selected.length }}）</UiButton
			>
		</template>
	</Overlay>
</template>

<style scoped>
.picker-row {
	display: grid;
	grid-template-columns: 24px 48px minmax(0, 1fr);
	gap: var(--p-space-3);
	align-items: start;
	width: 100%;
	min-height: 44px;
	padding: var(--p-space-3);
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	text-align: left;
	margin-block: var(--p-space-2);
	cursor: pointer;
}
.picker-row.is-selected {
	background: var(--p-soft);
	border-color: var(--p-accent);
}
.picker-row:focus-within {
	box-shadow: var(--p-focus);
}
.picker-row > input {
	margin-top: 12px;
}
.preview-picker-thumb {
	grid-column: 2;
	width: 48px;
	height: 48px;
}
.picker-identity {
	grid-column: 3;
	min-width: 0;
	overflow-wrap: anywhere;
}
.picker-actions {
	grid-column: 3;
	display: flex;
	flex-wrap: wrap;
	gap: var(--p-space-2);
}
.picker-stock {
	grid-column: 3;
	min-width: 0;
	overflow-wrap: anywhere;
}
.picker-row small {
	display: block;
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
