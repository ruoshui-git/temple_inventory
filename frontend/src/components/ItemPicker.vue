<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from "vue";
import { api, workspaceApi } from "../lib/api";
import { warehousePresentation } from "../lib/warehousePresenter";
import { Combobox } from "frappe-ui";
import ItemCreateForm from "./ItemCreateForm.vue";
import ScannableInput from "./ScannableInput.vue";
const props = defineProps<{
	boot: any;
	barcode?: string;
	stockOnly?: boolean;
	warehouse?: string;
	postingDate?: string;
	postingTime?: string;
	movementKind?: string;
}>();
const emit = defineEmits<{
	select: [item: any];
	close: [];
	"warehouse-change": [warehouse: string];
}>();
const query = ref(props.barcode || ""),
	category = ref(""),
	selectedWarehouse = ref(props.warehouse || ""),
	rows = ref<any[]>([]),
	total = ref(0),
	start = ref(0),
	error = ref(""),
	busy = ref(false),
	appending = ref(false);
const creating = ref(!!props.barcode);
const recent = ref<any[]>([]),
	recentLoading = ref(true);
const drawer = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
const warehouseRows = computed(
	() => props.boot.warehouses || props.boot.physical_warehouses || [],
);
const categoryOptions = computed(() => [
	{ label: "全部类别", value: "" },
	...props.boot.item_groups.map((group: any) => ({
		label: group.item_group_name,
		value: group.name,
	})),
]);
const warehouseOptions = computed(() => [
	{ label: "所有有库存仓库", value: "" },
	...warehouseRows.value.map((warehouse: any) => ({
		label: warehousePresentation(warehouse.name, props.boot.warehouse_tree || []).breadcrumb,
		value: warehouse.name,
	})),
]);
let sequence = 0;
let observer: IntersectionObserver | undefined;
async function search(offset = 0, append = false) {
	if (append && appending.value) return;
	const seq = ++sequence;
	if (append) appending.value = true;
	try {
		const d = await api("search_items", {
			search: query.value,
			category: category.value,
			start: offset,
			page_length: 25,
			warehouse: selectedWarehouse.value || undefined,
			in_stock_only: props.stockOnly || undefined,
			posting_date: props.postingDate || undefined,
			posting_time: props.postingTime || undefined,
		});
		if (seq !== sequence) return;
		rows.value = append
			? [
					...rows.value,
					...(d.results || []).filter(
						(row: any) => !rows.value.some((old) => old.item_code === row.item_code),
					),
				]
			: d.results || [];
		total.value = d.total;
		start.value = offset;
	} catch (e: any) {
		error.value = e.message;
	} finally {
		if (seq === sequence) appending.value = false;
	}
}
function drawerScroll(event: Event) {
	if (typeof IntersectionObserver !== "undefined") return;
	const target = event.currentTarget as HTMLElement;
	if (
		target.scrollHeight - target.scrollTop - target.clientHeight < 180 &&
		rows.value.length < total.value &&
		!busy.value &&
		!appending.value
	)
		void search(rows.value.length, true);
}
async function select(code: string) {
	busy.value = true;
	try {
		const d = await workspaceApi("item_detail", { item_code: code });
		const key = `ti-recent:${props.boot.user}`;
		const codes = [
			code,
			...JSON.parse(localStorage.getItem(key) || "[]").filter((c: string) => c !== code),
		].slice(0, 8);
		localStorage.setItem(key, JSON.stringify(codes));
		emit("select", d);
	} catch (e: any) {
		error.value = e.message;
	} finally {
		busy.value = false;
	}
}
async function createdItem(itemCode: string) {
	await select(itemCode);
}
watch([query, category, selectedWarehouse], () => search());
onMounted(async () => {
	void search();
	try {
		const codes = JSON.parse(localStorage.getItem(`ti-recent:${props.boot.user}`) || "[]");
		const loaded = await Promise.all(
			codes.map(async (code: string) => {
				try {
					return await workspaceApi("item_detail", { item_code: code });
				} catch {
					return undefined;
				}
			}),
		);
		recent.value = loaded.filter(Boolean);
	} catch {
		recent.value = [];
	} finally {
		recentLoading.value = false;
	}
	await nextTick();
	if (typeof IntersectionObserver !== "undefined") {
		observer = new IntersectionObserver(
			(entries) => {
				if (
					entries.some((entry) => entry.isIntersecting) &&
					rows.value.length < total.value &&
					!busy.value &&
					!appending.value
				)
					void search(rows.value.length, true);
			},
			{ root: drawer.value, rootMargin: "180px" },
		);
		if (sentinel.value) observer.observe(sentinel.value);
	}
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
	<div class="drawer-backdrop">
		<aside
			ref="drawer"
			class="drawer wide"
			role="dialog"
			aria-modal="true"
			aria-label="选择物品"
			@scroll.passive="drawerScroll"
		>
			<button class="drawer-close" @click="emit('close')">×</button>
			<h2>{{ creating ? "创建新物品" : "添加物品" }}</h2>
			<p v-if="error" class="error">{{ error }}</p>
			<button
				v-if="!creating && boot.capabilities.Item"
				class="primary item-picker-create"
				type="button"
				@click="creating = true"
			>
				＋创建新物品
			</button>
			<template v-if="!creating">
				<ScannableInput
					v-model="query"
					label="搜索物品"
					placeholder="搜索名称、编号、条码"
					scan-label="扫描物品条码"
				/>
				<label
					>类别<Combobox
						v-model="category"
						:options="categoryOptions"
						placeholder="全部类别"
						aria-label="类别"
				/></label>
				<label v-if="stockOnly"
					>仓库筛选<Combobox
						v-model="selectedWarehouse"
						:options="warehouseOptions"
						placeholder="所有有库存仓库"
						aria-label="仓库筛选"
						@update:model-value="emit('warehouse-change', String($event || ''))"
				/></label>
				<section
					v-if="!query && (recentLoading || recent.length)"
					class="recent-items"
					aria-label="最近使用"
				>
					<h3>最近使用</h3>
					<div class="recent-strip">
						<span v-if="recentLoading" class="recent-placeholder"
							>正在加载最近物品…</span
						><button
							v-for="r in recent"
							:key="r.item_code"
							class="recent-item"
							:disabled="busy"
							@click="select(r.item_code)"
						>
							<img v-if="r.image" :src="r.image" class="thumb" /><span
								>{{ r.item_name }}<small>{{ r.item_code }}</small></span
							>
						</button>
					</div>
				</section>
				<h3>搜索结果</h3>
				<button
					v-for="r in rows"
					:key="r.item_code"
					class="selection-row compact-selection"
					:disabled="busy"
					@click="select(r.item_code)"
				>
					<img v-if="r.image" :src="r.image" class="thumb" /><span
						><b>{{ r.item_name }}</b
						><small
							>{{ r.item_code }} · {{ r.item_group
							}}<template v-if="stockOnly">
								· 可用 {{ r.available_qty }} {{ r.stock_uom }}</template
							></small
						></span
					>
				</button>
				<p v-if="!rows.length && !recentLoading">没有找到物品</p>
				<p>已加载 {{ rows.length }} · 筛选结果 {{ total }}</p>
				<div ref="sentinel" aria-hidden="true"></div>
				<div v-if="appending" class="mobile-loading" role="status">正在加载更多结果…</div>
			</template>
			<ItemCreateForm
				v-else
				:boot="boot"
				:barcode="barcode"
				submit-label="创建并使用"
				cancel-label="返回搜索"
				@created="createdItem"
				@cancel="creating = false"
			/>
		</aside>
	</div>
</template>
