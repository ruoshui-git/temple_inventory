<script setup lang="ts">
import { computed, reactive, ref, nextTick, useId, watch } from "vue";
import { matchesCategory } from "../browseModel";
import { reviewSession } from "../reviewModel";
import PreviewVirtualList from "./PreviewVirtualList.vue";
import PreviewItemImage from "../PreviewItemImage.vue";
import { installLargePickerFixture } from "../usabilityFixtures";
import PreviewCategoryField from "./PreviewCategoryField.vue";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import PreviewProduct from "../PreviewProduct.vue";
import PreviewOverlay from "../PreviewOverlay.vue";
import PreviewUnitField from "./PreviewUnitField.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
const props = defineProps<{
	allowCreate?: boolean;
	mode?: "add-multiple" | "replace-single";
	context?: string;
	eligible?: string[];
	createBarcode?: string;
}>();
const emit = defineEmits<{
	close: [];
	select: [code: string];
	selectMultiple: [codes: string[]];
	notify: [message: string];
}>();
const multiple = computed(
	() => props.mode === "add-multiple" && props.createBarcode === undefined,
);
const selected = ref<string[]>([]);
const formId = useId();
const discardPanel = ref<HTMLElement>();
const pendingMultiple = ref(false);
function toggle(code: string) {
	const index = selected.value.indexOf(code);
	if (index < 0) selected.value.push(code);
	else selected.value.splice(index, 1);
}
function commitSelection() {
	if (dirty.value) {
		pendingMultiple.value = true;
		discard.value = true;
		return;
	}
	emit("selectMultiple", [...selected.value]);
}
const search = ref("");
const creating = ref(!!props.allowCreate && props.createBarcode !== undefined);
const categoryFilter = ref("");
const locationFilter = ref("");
const onlyStock = ref(false);
const categories = computed(() => reviewSession.categories.map((row) => row.name));
const discard = ref(false);
watch(discard, async (value) => {
	if (value) {
		await nextTick();
		discardPanel.value?.focus();
	}
});
const pendingSelection = ref<string>();
const error = ref("");
const model = reactive({
	code: `ITM-PREVIEW-${reviewSession.stock.length + 1}`,
	name: "",
	category: "日用品",
	uom: "Nos",
	barcode: props.createBarcode || "",
	tracksBatch: false,
	tracksExpiry: false,
});
const visible = computed(() =>
	reviewSession.stock.filter(
		(item) =>
			(!props.eligible || props.eligible.includes(item.code)) &&
			matchesCategory(
				item.category,
				categoryFilter.value ? [categoryFilter.value] : [],
				reviewSession,
			) &&
			(!locationFilter.value ||
				item.locations.some((row) => row.location === locationFilter.value)) &&
			(!onlyStock.value || item.available > 0) &&
			`${item.name} ${item.code} ${item.barcode || ""}`
				.toLocaleLowerCase()
				.includes(search.value.toLocaleLowerCase()),
	),
);
const loadState = ref<"ready" | "loading" | "error">("ready");
const detailCode = ref("");
const detailPanel = ref<HTMLElement>();
let detailInvoker: HTMLElement | undefined;
async function showStockDetails(code: string) {
	if (code) detailInvoker = document.activeElement as HTMLElement;
	detailCode.value = code;
	await nextTick();
	if (code) detailPanel.value?.focus({ preventScroll: true });
	else {
		detailInvoker?.focus({ preventScroll: true });
		detailInvoker?.scrollIntoView({ block: "nearest" });
	}
}
const detailItem = computed(() =>
	reviewSession.stock.find((row) => row.code === detailCode.value),
);
const content = ref<HTMLElement>();
const supportingEditors = ref<HTMLElement>();
const categoryDirty = ref(false);
const unitDirty = ref(false);
let selectionScroll = 0;
let creationScroll = 0;
async function showCreate(value: boolean) {
	const scrollport = content.value?.closest<HTMLElement>(".dialog-content");
	if (creating.value) creationScroll = scrollport?.scrollTop || 0;
	else selectionScroll = scrollport?.scrollTop || 0;
	creating.value = value;
	discard.value = false;
	pendingMultiple.value = false;
	pendingSelection.value = undefined;
	await nextTick();
	const selector = value ? "form input" : ".preview-picker-selection input";
	content.value?.querySelector<HTMLInputElement>(selector)?.focus({ preventScroll: true });
	if (scrollport) scrollport.scrollTop = value ? creationScroll : selectionScroll;
}
const initialModel = ref(JSON.stringify(model));
const dirty = computed(
	() => JSON.stringify(model) !== initialModel.value || categoryDirty.value || unitDirty.value,
);
function close() {
	pendingSelection.value = undefined;
	pendingMultiple.value = false;
	if (dirty.value) {
		discard.value = true;
		return;
	}
	emit("close");
}
function selectExisting(code: string) {
	if (dirty.value) {
		pendingSelection.value = code;
		discard.value = true;
		return;
	}
	emit("select", code);
}
function discardEdits() {
	if (pendingMultiple.value) emit("selectMultiple", [...selected.value]);
	else if (pendingSelection.value) emit("select", pendingSelection.value);
	else emit("close");
}
function save() {
	if (categoryDirty.value || unitDirty.value) {
		error.value = "请先保存或取消正在填写的分类、单位。";
		supportingEditors.value?.querySelector<HTMLInputElement>("input")?.focus();
		return;
	}

	if (
		!model.code.trim() ||
		!model.name.trim() ||
		!model.category ||
		!reviewSession.units.some((unit) => unit.name === model.uom)
	) {
		error.value = "请填写编号、名称和单位";
		return;
	}
	if (reviewSession.stock.some((item) => item.code === model.code.trim())) {
		error.value = "物品编号已存在";
		return;
	}
	reviewSession.stock.push({
		...model,
		code: model.code.trim(),
		name: model.name.trim(),
		tracksBatch: model.tracksBatch || model.tracksExpiry,
		illustration: "none",
		locations: [],
		available: 0,
		loaned: 0,
		damaged: 0,
	});
	emit("notify", "物品已创建；取消入库不会删除物品、分类或单位。");
	if (multiple.value) {
		selected.value.push(model.code.trim());
		Object.assign(model, {
			code: `ITM-PREVIEW-${reviewSession.stock.length + 1}`,
			name: "",
			category: "日用品",
			uom: "Nos",
			barcode: "",
			tracksBatch: false,
			tracksExpiry: false,
		});
		initialModel.value = JSON.stringify(model);
		error.value = "";
		showCreate(false);
	} else emit("select", model.code.trim());
}
</script>
<template>
	<PreviewOverlay
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
				<PreviewSearchSelect
					label="分类筛选"
					v-model="categoryFilter"
					:options="categories"
				/>
				<PreviewSearchSelect
					label="库位筛选"
					v-model="locationFilter"
					:options="
						reviewSession.warehouses
							.filter((row) => !row.is_group)
							.map((row) => row.name)
					"
				/>
				<label class="preview-choice-label"
					><input type="checkbox" v-model="onlyStock" />仅有可用库存</label
				>
				<PreviewUiButton v-if="allowCreate" @click="showCreate(true)"
					>新建物品</PreviewUiButton
				>
				<details>
					<summary>预览大型选择器</summary>
					<PreviewUiButton @click="installLargePickerFixture()"
						>载入 1,000 种物品</PreviewUiButton
					>
					<label class="preview-field"
						>选择器加载状态<select v-model="loadState">
							<option value="ready">正常</option>
							<option value="loading">初次加载</option>
							<option value="error">追加加载失败</option>
						</select></label
					>
				</details>
				<p v-if="loadState === 'loading'" role="status">正在加载物品…</p>
				<p v-if="loadState === 'error'" role="alert">
					追加加载失败；已有结果与选择保留。<PreviewUiButton @click="loadState = 'ready'"
						>重试加载</PreviewUiButton
					>
				</p>
				<div v-show="!detailCode && loadState !== 'loading'">
					<p role="status">
						{{ visible.length }} 个匹配物品 · 已选 {{ selected.length }}
					</p>
					<PreviewVirtualList :keys="visible.map((item) => item.code)" :estimate="150">
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
									><PreviewItemImage :item="visible[index]!"
								/></span>
								<span class="picker-identity"
									><strong>{{ visible[index]!.name }}</strong
									><small
										>{{ visible[index]!.code }} ·
										{{ visible[index]!.category }}</small
									><small
										>可用 {{ visible[index]!.available }}
										{{ visible[index]!.uom }}</small
									></span
								>
								<span class="picker-actions"
									><PreviewUiButton
										v-if="!multiple"
										@click="selectExisting(visible[index]!.code)"
										>选择</PreviewUiButton
									><PreviewUiButton
										@click="showStockDetails(visible[index]!.code)"
										>库存详情</PreviewUiButton
									></span
								>
							</div>
						</template>
					</PreviewVirtualList>
				</div>
				<section v-if="detailItem" ref="detailPanel" tabindex="-1" class="picker-detail">
					<h3>{{ detailItem.name }}</h3>
					<p v-for="place in detailItem.locations" :key="place.location">
						{{ place.location }} · 可用 {{ place.available }} {{ detailItem.uom
						}}<small v-for="batch in place.batches" :key="batch.id"
							>{{ batch.id }} · {{ batch.expiry || "无效期" }} ·
							{{ batch.available }} {{ detailItem.uom }}</small
						>
					</p>
					<PreviewUiButton @click="showStockDetails('')">返回物品列表</PreviewUiButton>
				</section>
				<p v-if="!visible.length">没有匹配的物品</p>
			</div>
			<form
				v-show="creating"
				:id="formId"
				:inert="discard ? true : undefined"
				class="preview-creation-fields"
				@submit.prevent="save"
			>
				<p class="full-width muted">
					{{ context || "入库登记" }} ·
					创建后返回此入库单。取消入库不会删除已创建的物品、分类或单位。
				</p>
				<label class="preview-field">物品编号<input v-model="model.code" /></label>
				<label class="preview-field">物品名称<input v-model="model.name" /></label>

				<PreviewCategoryField
					v-model="model.category"
					:editor-target="supportingEditors"
					@dirty-change="categoryDirty = $event"
				/>
				<PreviewUnitField
					v-model="model.uom"
					:editor-target="supportingEditors"
					@dirty-change="unitDirty = $event"
				/>
				<div ref="supportingEditors" class="preview-supporting-editors full-width"></div>
				<label class="preview-field full-width"
					>条码（每行一个，可选）<textarea v-model="model.barcode" />
				</label>
				<label class="preview-choice-label"
					><input
						v-model="model.tracksBatch"
						type="checkbox"
						:disabled="model.tracksExpiry"
					/>按批次管理</label
				>
				<label class="preview-choice-label"
					><input v-model="model.tracksExpiry" type="checkbox" />记录效期</label
				>
				<p class="muted">批次、数量和效期在入库单中填写。</p>
				<p v-if="error" role="alert">{{ error }}</p>
			</form>
			<div v-if="discard" ref="discardPanel" tabindex="-1" role="alert">
				<p>放弃未保存的物品、分类或单位资料？已创建的分类和单位仍会保留。</p>
				<PreviewUiButton @click="showCreate(true)">继续填写</PreviewUiButton
				><PreviewUiButton @click="discardEdits">放弃填写</PreviewUiButton>
			</div>
		</div>
		<template #footer>
			<template v-if="creating && !discard">
				<PreviewUiButton variant="primary" :form="formId" type="submit">{{
					multiple
						? "创建并选中"
						: mode === "replace-single"
							? "创建并更换"
							: "创建并使用"
				}}</PreviewUiButton>
				<PreviewUiButton @click="showCreate(false)"
					>返回选择物品（保留填写）</PreviewUiButton
				>
			</template>
			<PreviewUiButton
				v-else-if="multiple && !discard"
				variant="primary"
				:disabled="!selected.length"
				@click="commitSelection"
				>添加所选（{{ selected.length }}）</PreviewUiButton
			>
		</template>
	</PreviewOverlay>
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
