<script setup lang="ts">
import { useOptionalReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
import { computed, ref, nextTick, watch, onMounted } from "vue";
import VirtualList from "../../components/ui/VirtualList.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import HierarchyFilter from "../../components/ui/HierarchyFilter.vue";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ItemImage from "../../components/ItemImage.vue";
import ItemEditorView from "./ItemEditorView.vue";
import { useItemEditor } from "./useItemEditor";
import { useItemPicker } from "./useItemPicker";
import type { StockItem } from "../../lib/stockPresentation";
const props = defineProps<{
	allowCreate?: boolean;
	mode?: "add-multiple" | "replace-single";
	context?: string;
	eligible?: string[];
	createBarcode?: string;
	timestamp?: string;
}>();
const emit = defineEmits<{
	close: [];
	select: [code: string];
	selectMultiple: [codes: string[]];
	notify: [message: string];
	itemLoaded: [item: StockItem];
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
	locationFilter,
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
const itemEditor = useItemEditor(
	{ barcode: props.createBarcode, contextual: true, lazy: true },
	(item) => {
		emit("notify", "物品已创建；取消操作单不会删除物品、分类或单位。");
		if (multiple.value) {
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
	detailPanel = ref<HTMLElement>();
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
	const scrollport = content.value?.closest<HTMLElement>(".dialog-content");
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
		drawer
		:adaptive-creation="creating"
		@close="close"
	>
		<div ref="content" class="preview-picker-content">
			<div
				v-show="!creating"
				class="preview-picker-selection"
				:inert="discard ? true : undefined"
			>
				<label class="preview-field"
					>搜索物品<input v-model="search" type="search"
				/></label>
				<HierarchyFilter
					v-model="categoryFilters"
					:options="reference.categories"
					title="物品类别"
					placeholder="搜索类别"
					initial-expansion="first-level"
				/>
				<label class="preview-choice-label"
					><input type="checkbox" v-model="uncategorizedFilter" />无分类</label
				>
				<SearchSelect
					label="库位筛选"
					v-model="locationFilter"
					:options="
						reference.warehouses
							.filter((row) => !row.is_group)
							.map((row) => ({
								value: row.name,
								label: warehouseLabel(row.name, reference.warehouses),
							}))
					"
				/>
				<label class="preview-choice-label"
					><input type="checkbox" v-model="onlyStock" />仅有可用库存</label
				>
				<UiButton v-if="allowCreate" @click="showCreate(true)">新建物品</UiButton>
				<p v-if="result.loading" role="status">正在加载物品…</p>
				<p v-if="result.error" role="alert">
					{{ result.error }} <UiButton @click="picker.retry()">重试加载</UiButton>
				</p>
				<div v-show="!detailCode && (!result.loading || result.rows.length)">
					<p role="status">{{ result.total }} 个匹配物品 · 已选 {{ selected.length }}</p>
					<VirtualList :keys="visible.map((item) => item.code)" :estimate="150">
						<template #default="{ index }">
							<div
								v-if="visible[index]"
								class="picker-row"
								:class="{ 'is-selected': selected.includes(visible[index]!.code) }"
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
								<span class="picker-identity"
									><strong>{{ visible[index]!.name }}</strong
									><small
										>{{ visible[index]!.code
										}}<template v-if="visible[index]!.category">
											· {{ visible[index]!.category }}</template
										></small
									><small
										>可用 {{ visible[index]!.available }}
										{{ visible[index]!.uom }}</small
									></span
								>
								<span class="picker-actions"
									><UiButton
										v-if="!multiple"
										:disabled="result.stale"
										@click="selectExisting(visible[index]!.code)"
										>选择</UiButton
									><UiButton
										:disabled="result.stale"
										@click="showStockDetails(visible[index]!.code)"
										>库存详情</UiButton
									></span
								>
							</div>
						</template> </VirtualList
					><UiButton
						v-if="result.next !== null"
						:loading="result.loading"
						@click="load(true)"
						>加载更多 · {{ result.rows.length }} / {{ result.total }}</UiButton
					>
				</div>
				<p v-if="detailLoading" role="status">正在读取库存详情…</p>
				<p v-if="detailError" role="alert">{{ detailError }}</p>
				<section v-if="detailItem" ref="detailPanel" tabindex="-1" class="picker-detail">
					<h3>{{ detailItem.name }}</h3>
					<p v-for="place in detailItem.locations" :key="place.location">
						{{
							warehouseLabel(
								place.location,
								warehouseReference?.warehouses || [],
								place.label,
							)
						}}
						· 可用 {{ place.available }} {{ detailItem.uom
						}}<small v-for="batch in place.batches" :key="batch.id"
							>{{ batch.id }} · {{ batch.expiry || "无效期" }} ·
							{{ batch.available }} {{ detailItem.uom }}</small
						>
					</p>
					<UiButton @click="showStockDetails('')">返回物品列表</UiButton>
				</section>
				<p v-if="!result.loading && !result.error && !visible.length">没有匹配的物品</p>
			</div>
			<div v-show="creating" :inert="discard || undefined">
				<ItemEditorView :controller="itemEditor" contextual @cancel="showCreate(false)" />
			</div>

			<div v-if="discard" ref="discardPanel" tabindex="-1" role="alert">
				<p>放弃未保存的物品、分类或单位资料？已创建的分类和单位仍会保留。</p>
				<UiButton @click="showCreate(true)">继续填写</UiButton
				><UiButton @click="discardEdits">放弃填写</UiButton>
			</div>
		</div>
		<template #footer>
			<UiButton v-if="creating && !discard" @click="showCreate(false)"
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
