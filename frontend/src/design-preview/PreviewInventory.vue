<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePreviewFocusVisibility } from "./focusVisibility";
import { usePreviewScroll, previewScrollOwner } from "./scroll";
import PreviewReturnToTop from "./components/PreviewReturnToTop.vue";
import PreviewSearchSelect from "./components/PreviewSearchSelect.vue";
import { matchesCategory } from "./browseModel";
import PreviewFilterButton from "./components/PreviewFilterButton.vue";
import UiButton from "./components/PreviewUiButton.vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import HierarchyFilter from "./components/PreviewHierarchyFilter.vue";
import QuantitySummary from "./components/PreviewQuantitySummary.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import { reviewSession, createDraft, type OperationKind } from "./reviewModel";
import PreviewOverlay from "./PreviewOverlay.vue";
import { emptyScope, matchesItem, matchesWarehouse } from "./browseModel";
import PreviewItemImage from "./PreviewItemImage.vue";
import PreviewStockDetails from "./PreviewStockDetails.vue";
import {
	filterItems,
	expiryStatus,
	itemBatches,
	items,
	quantities,
	type Pattern,
	type StockItem,
} from "./model";
const props = defineProps<{ pattern: Pattern; variant?: string; active?: boolean }>();
const emit = defineEmits<{
	receive: [];
	notify: [message: string];
	navigate: [page: string, variant: string];
}>();
const { isMobile } = useResponsiveLayout();
const inventoryRoot = ref<HTMLElement>();
const browseHeader = ref<HTMLElement>();
const results = ref<HTMLElement>();
usePreviewFocusVisibility(
	inventoryRoot,
	ref<HTMLElement>(),
	() => true,
	() => props.active !== false,
	browseHeader,
);
const toolsOpen = ref(false);
const compact = ref(false);
const secondaryTools = ref<HTMLElement>();
const toolsTrigger = ref<HTMLButtonElement>();
const expandedContext = ref<HTMLElement>();
const compactContext = ref<HTMLElement>();
watch(compact, async (value) => {
	const previousContext = value ? expandedContext.value : compactContext.value;
	const contextFocused = previousContext?.contains(document.activeElement);
	const triggerFocused = document.activeElement === toolsTrigger.value;
	if (value && secondaryTools.value?.contains(document.activeElement)) {
		toolsOpen.value = true;
	} else if (contextFocused || (!value && triggerFocused)) {
		await nextTick();
		if (compact.value !== value || props.active === false) return;
		const destination = contextFocused
			? value
				? compactContext.value
				: expandedContext.value
			: secondaryTools.value;
		destination?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
	}
});
const { top, viewport } = usePreviewScroll(inventoryRoot, () => props.active !== false);
function updateCompact() {
	const owner = previewScrollOwner(results.value || null);
	const edge = owner === window ? 0 : (owner as HTMLElement).getBoundingClientRect().top;
	compact.value = !!results.value && results.value.getBoundingClientRect().top < edge - 80;
}
watch([top, viewport, isMobile], updateCompact, { flush: "post" });
const search = ref("");
const warehouses = ref<string[]>([]);
const category = ref("");
const view = ref("card");
const sort = ref("name");
const descending = ref(false);
const selected = ref<string[]>([]);
const inStockOnly = ref(true);
const filtersOpen = ref(false);
const menuOpen = ref(false);
function openItem(item: StockItem) {
	reviewSession.selectedItemCode = item.code;
	emit("navigate", "item-detail", "overview");
}
const summaryOpen = ref(false);
const resultLimit = ref(20);
const analysisDimension = ref("category");
const scanOpen = ref(false);
const exportOpen = ref(false);
const exportFormat = ref("xlsx");
const exportDataset = ref("summary");
function openExport() {
	exportDataset.value = "summary";
	exportOpen.value = true;
}
const exportRows = computed(() =>
	exportDataset.value === "summary"
		? rows.value.map(
				(item) =>
					`${item.code} · ${item.name} · ${item.category} · 可用 ${item.available} ${item.uom} · 借出 ${item.loaned} · 损坏 ${item.damaged}`,
			)
		: rows.value.flatMap((item) =>
				item.locations.map(
					(location) =>
						`${item.code} · ${item.name} · ${location.location} · 可用 ${location.available} ${item.uom} · 借出 ${location.loaned} · 损坏 ${location.damaged}`,
				),
			),
);
const status = ref("ready");
const menu = ref<HTMLElement>();
watch(
	() => props.variant,
	(variant) => {
		if (!variant) return;
		if (variant === "list") status.value = "ready";
		if (variant === "filtered" || variant === "empty") {
			warehouses.value = [];
			category.value = "";
			search.value = variant === "filtered" ? "东北" : "";
			status.value = variant === "empty" ? "empty" : "ready";
		}
	},
	{ immediate: true },
);
watch(
	() => props.active,
	(active) => {
		if (active) return;
		filtersOpen.value = false;
		menuOpen.value = false;
		summaryOpen.value = false;
		scanOpen.value = false;
		exportOpen.value = false;
	},
);
watch(
	() => reviewSession.filters.inventory.scope,
	() => {
		search.value = "";
		warehouses.value = [];
		category.value = "";
		status.value = "ready";
	},
);
function closeMenuOutside(event: PointerEvent) {
	if (event.target instanceof Node && !menu.value?.contains(event.target))
		menuOpen.value = false;
}
function closeMenuWithKeyboard() {
	menuOpen.value = false;
	menu.value?.querySelector<HTMLButtonElement>("button")?.focus();
}
onMounted(() => document.addEventListener("pointerdown", closeMenuOutside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", closeMenuOutside));
const rows = computed(() => {
	if (status.value === "empty") return [];
	const scope = reviewSession.filters.inventory.scope;
	const source = reviewSession.stock
		.filter(
			(item) =>
				matchesItem(item.code, scope, reviewSession) &&
				(!inStockOnly.value || item.available + item.loaned + item.damaged > 0),
		)
		.map((item) => ({
			...item,
			locations: item.locations.filter((row) =>
				matchesWarehouse(row.location, scope.warehouses, reviewSession),
			),
		}))
		.filter((item) => !scope.warehouses.length || item.locations.length);
	return filterItems(
		search.value,
		[],
		"",
		source.map((item) => ({
			...item,
			locations: item.locations.filter((row) =>
				matchesWarehouse(row.location, warehouses.value, reviewSession),
			),
		})),
	)
		.filter(
			(item) =>
				(!warehouses.value.length || item.locations.length) &&
				matchesCategory(
					item.category,
					category.value ? [category.value] : [],
					reviewSession,
				),
		)
		.sort((a, b) => {
			const result =
				sort.value === "available"
					? a.available - b.available
					: a.name.localeCompare(b.name, "zh-CN");
			return descending.value ? -result : result;
		});
});
const analysis = computed(() => {
	const grouped = new Map<
		string,
		{ items: Set<string>; available: number; loaned: number; damaged: number }
	>();
	for (const item of rows.value) {
		const parts =
			analysisDimension.value === "category"
				? [
						{
							key: item.category,
							available: item.available,
							loaned: item.loaned,
							damaged: item.damaged,
						},
					]
				: item.locations.map((row) => ({ key: row.location, ...row }));
		for (const part of parts) {
			const key = `${part.key} · ${item.uom}`;
			const group = grouped.get(key) || {
				items: new Set<string>(),
				available: 0,
				loaned: 0,
				damaged: 0,
			};
			group.items.add(item.code);
			group.available += part.available;
			group.loaned += part.loaned;
			group.damaged += part.damaged;
			grouped.set(key, group);
		}
	}
	return [...grouped.entries()];
});
watch(
	() => [search.value, category.value, warehouses.value, inStockOnly.value],
	() => {
		resultLimit.value = 20;
	},
	{ deep: true },
);
const metrics = computed(() => [
	{
		key: "available",
		label: "可用库存",
		icon: "box",
		quantities: quantities(rows.value),
		tone: "available",
	},
	{
		key: "loaned",
		label: "借出",
		icon: "loan",
		quantities: quantities(rows.value, "loaned"),
		tone: "loaned",
	},
	{
		key: "damaged",
		label: "损坏待处理",
		icon: "warning",
		quantities: quantities(rows.value, "damaged"),
		tone: "damaged",
	},
]);
function toggle(code: string) {
	selected.value = selected.value.includes(code)
		? selected.value.filter((key) => key !== code)
		: [...selected.value, code];
}
function clear() {
	reviewSession.filters.inventory.scope = emptyScope();
	warehouses.value = [];
	category.value = "";
	search.value = "";
	status.value = "ready";
}
function sortBy(key: string) {
	descending.value = sort.value === key ? !descending.value : false;
	sort.value = key;
}
function action(name: string) {
	menuOpen.value = false;
	if (selected.value.length && name !== "新建物品") {
		const kind: OperationKind =
			name === "入库" ? "Receive" : name === "出库" ? "Issue" : "Transfer";
		const draft = createDraft(
			kind,
			`MAT-STE-2026-${String(reviewSession.drafts.length + 401).padStart(5, "0")}`,
		);
		draft.lines = selected.value.map((code, index) => ({
			id: `${draft.name}/${index}`,
			code,
			qty: 1,
			uom: reviewSession.stock.find((row) => row.code === code)?.uom || "Nos",
			location: "",
			sourceLocation: "",
		}));
		reviewSession.selectedDraftName = draft.name;
		emit("navigate", "movement-form", kind);
		return;
	}
	if (name === "入库") emit("receive");
	else if (name === "新建物品") emit("navigate", "item-form", "new");
	else emit("navigate", "movement-form", name === "出库" ? "Issue" : "Transfer");
}
</script>
<template>
	<div ref="inventoryRoot" class="inventory-example" :class="{ 'is-compact': compact }">
		<div
			v-if="
				reviewSession.filters.inventory.scope.categories.length ||
				reviewSession.filters.inventory.scope.warehouses.length
			"
			class="preview-active-filters"
		>
			<span
				>总览范围：{{
					[
						...reviewSession.filters.inventory.scope.categories,
						...reviewSession.filters.inventory.scope.warehouses,
					].join(" · ")
				}}</span
			><button @click="reviewSession.filters.inventory.scope = emptyScope()">
				清除总览范围
			</button>
		</div>
		<header ref="browseHeader" class="inventory-browse-header">
			<div class="page-heading">
				<div>
					<span class="eyebrow">INVENTORY / 库存管理</span>
					<h1>每一份物资，都有去处。</h1>
					<p class="muted">查看库存、找到位置，让下一次取用更从容。</p>
				</div>
				<div v-if="pattern === 'current' && !isMobile" class="button-row">
					<UiButton icon="download" @click="action('入库')">入库</UiButton
					><UiButton icon="loan" @click="action('出库')">出库</UiButton
					><UiButton icon="movement" @click="action('调拨')">调拨</UiButton
					><UiButton variant="primary" icon="box" @click="action('新建物品')"
						>新建物品</UiButton
					>
				</div>
				<div
					v-else
					ref="menu"
					class="action-menu"
					:class="{ 'current-fab': pattern === 'current' && isMobile }"
					@keydown.esc="closeMenuWithKeyboard"
					@focusout="
						!($event.currentTarget as HTMLElement).contains(
							$event.relatedTarget as Node,
						) && (menuOpen = false)
					"
				>
					<UiButton
						variant="primary"
						aria-label="新建操作"
						:aria-expanded="menuOpen"
						aria-controls="inventory-action-options"
						@click="menuOpen = !menuOpen"
						>{{ pattern === "current" && isMobile ? "＋" : "＋ 新建操作" }}</UiButton
					>
					<div v-if="menuOpen" id="inventory-action-options" class="menu-popover">
						<button
							v-for="name in ['入库', '出库', '调拨', '新建物品']"
							:key="name"
							@click="action(name)"
						>
							{{ name }}<InventoryIcon name="open" />
						</button>
					</div>
				</div>
			</div>
			<div class="inventory-context"><slot name="context" /></div>
			<div class="inventory-toolbar">
				<label class="search-box"
					><InventoryIcon name="search" /><input
						v-model="search"
						aria-label="搜索物品或条码"
						placeholder="搜索物品名称、编号…" /></label
				><UiButton
					icon="scan"
					:icon-only="compact && isMobile"
					label="扫码"
					@click="scanOpen = true"
					>扫码</UiButton
				><PreviewFilterButton
					:expanded="filtersOpen"
					:count="
						warehouses.length +
						Number(!!category) +
						reviewSession.filters.inventory.scope.warehouses.length +
						reviewSession.filters.inventory.scope.categories.length
					"
					@click="filtersOpen = !filtersOpen"
				/>
			</div>
			<div v-if="compact" class="inventory-compact-tools">
				<button
					ref="toolsTrigger"
					class="text-button"
					:aria-expanded="toolsOpen"
					aria-controls="inventory-secondary-tools"
					@click="toolsOpen = !toolsOpen"
				>
					浏览工具
					<InventoryIcon name="chevron-down" :class="{ 'is-expanded': toolsOpen }" />
				</button>
				<div ref="compactContext"><slot name="context-actions" /></div>
			</div>
			<div
				ref="secondaryTools"
				id="inventory-secondary-tools"
				v-show="!compact || toolsOpen"
				class="inventory-secondary-tools"
			>
				<div class="result-tools">
					<div class="button-row">
						<div class="segmented" aria-label="库存显示方式">
							<button :aria-pressed="view === 'card'" @click="view = 'card'">
								<InventoryIcon name="card" />卡片</button
							><button :aria-pressed="view === 'table'" @click="view = 'table'">
								<InventoryIcon name="table" />列表
							</button>
						</div>
						<span class="muted">{{ rows.length }} 种物品</span>
					</div>
					<div class="button-row">
						<label class="inline-field"
							>排序<select v-model="sort" aria-label="库存排序">
								<option value="name">物品名称</option>
								<option value="available">可用数量</option>
							</select></label
						><UiButton v-if="!isMobile" icon="download" @click="openExport"
							>导出</UiButton
						><UiButton variant="ghost" icon="sigma" @click="summaryOpen = true"
							>列汇总</UiButton
						>
					</div>
				</div>
				<div v-if="warehouses.length || category || search" class="chip-row">
					<button
						v-for="warehouse in warehouses"
						:key="warehouse"
						class="chip"
						@click="warehouses = warehouses.filter((value) => value !== warehouse)"
					>
						{{ warehouse }} ×</button
					><button v-if="category" class="chip" @click="category = ''">
						{{ category }} ×</button
					><button v-if="search" class="chip" @click="search = ''">{{ search }} ×</button
					><UiButton variant="ghost" @click="clear">清空筛选</UiButton>
				</div>
				<label class="preview-choice-label preview-check"
					><input type="checkbox" v-model="inStockOnly" />仅有库存</label
				>
				<div v-if="selected.length" class="selection-bar" role="status">
					<span>已选择 {{ selected.length }} 项物品</span
					><UiButton variant="ghost" @click="selected = []">取消选择</UiButton>
				</div>
			</div>
		</header>

		<div class="proposal-note">
			<InventoryIcon name="notice" /><span>{{
				pattern === "current"
					? "当前结构：桌面并列操作，手机使用浮动 ＋ 按钮。"
					: "实验操作提案：以有文字说明的「新建操作」统一入口；搜索、扫码与筛选始终直接可见。"
			}}</span>
		</div>
		<div v-if="!compact" ref="expandedContext" class="preview-context-actions">
			<slot name="context-actions" />
		</div>
		<section class="surface inventory-surface">
			<div class="inventory-body" :class="{ 'with-filters': filtersOpen && !isMobile }">
				<aside v-if="filtersOpen && !isMobile" class="filter-rail">
					<h3>筛选库存</h3>
					<HierarchyFilter
						v-model="warehouses"
						:options="reviewSession.warehouses"
						title="仓库位置"
						placeholder="查找仓库"
					/><PreviewSearchSelect
						label="物品类别"
						v-model="category"
						:options="
							reviewSession.categories.map((row) => ({
								value: row.name,
								label: row.label,
								detail: row.parent,
							}))
						"
					/><UiButton variant="ghost" @click="clear">恢复默认筛选</UiButton>
				</aside>
				<div
					ref="results"
					class="results-region"
					:aria-busy="status === 'loading' || status === 'refresh'"
				>
					<div v-if="status === 'loading'" class="empty-panel" role="status">
						<span class="spinner" />正在加载库存…
						<div class="skeleton" />
					</div>
					<div v-else-if="status === 'error'" class="empty-panel">
						<InventoryIcon name="warning" />
						<h3>暂时无法读取库存</h3>
						<p>筛选与选择已保留，请重试。</p>
						<UiButton @click="status = 'ready'">重试</UiButton>
					</div>
					<div v-else-if="!rows.length" class="empty-panel">
						<InventoryIcon name="search" />
						<h3>没有找到匹配的物品</h3>
						<p>试试更短的关键词，或清除筛选。</p>
						<UiButton @click="clear">显示全部物品</UiButton>
					</div>
					<template v-else>
						<p v-if="status === 'refresh'" class="notice-bar" role="status">
							<span class="spinner" />正在更新，已有结果仍然保留。
						</p>
						<div
							v-if="view === 'card'"
							class="stock-grid"
							:class="{ refreshing: status === 'refresh' }"
						>
							<article
								v-for="item in rows.slice(0, resultLimit)"
								:key="item.code"
								class="stock-card"
								:class="{ selected: selected.includes(item.code) }"
							>
								<div class="stock-card-image">
									<PreviewItemImage
										:item="item"
										interaction="detail"
										@detail="openItem(item)"
									/><label class="card-checkbox"
										><input
											type="checkbox"
											:checked="selected.includes(item.code)"
											:aria-label="`选择${item.name}`"
											@change="toggle(item.code)" /></label
									><span
										v-if="expiryStatus(item)"
										class="badge art-badge"
										:class="
											expiryStatus(item) === '未过期'
												? 'neutral'
												: expiryStatus(item) === '已过期'
													? 'danger'
													: 'warning'
										"
										>{{ expiryStatus(item) }}</span
									>
								</div>
								<div class="stock-card-content">
									<span class="eyebrow"
										>{{ item.category }} · {{ item.code }}</span
									><button class="item-name" @click="openItem(item)">
										{{ item.name }}
									</button>
									<div class="stock-number">
										<span
											><strong>{{ item.available }}</strong>
											{{ item.uom }}</span
										><small>可用库存</small>
									</div>
									<div class="stock-secondary">
										<span
											>总量
											{{ item.available + item.loaned + item.damaged }}</span
										><span>借出 {{ item.loaned }}</span
										><span>损坏 {{ item.damaged }}</span>
									</div>

									<PreviewStockDetails :item="item" />
								</div>
							</article>
						</div>
						<div v-else class="table-scroll">
							<table class="preview-table">
								<caption class="sr-only">
									库存物品，可按名称或可用数量排序
								</caption>
								<thead>
									<tr>
										<th>选择</th>
										<th
											:aria-sort="
												sort === 'name'
													? descending
														? 'descending'
														: 'ascending'
													: 'none'
											"
										>
											<button @click="sortBy('name')">物品名称 ↕</button>
										</th>
										<th>位置</th>
										<th
											:aria-sort="
												sort === 'available'
													? descending
														? 'descending'
														: 'ascending'
													: 'none'
											"
										>
											<button @click="sortBy('available')">
												可用数量 ↕
											</button>
										</th>
										<th>效期</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="item in rows.slice(0, resultLimit)"
										:key="item.code"
										:class="{ selected: selected.includes(item.code) }"
									>
										<td>
											<input
												type="checkbox"
												:checked="selected.includes(item.code)"
												:aria-label="`选择${item.name}`"
												@change="toggle(item.code)"
											/>
										</td>
										<td>
											<div class="table-item-identity">
												<div class="table-item-image">
													<PreviewItemImage :item="item" />
												</div>
												<div>
													<button
														class="item-name"
														@click="openItem(item)"
													>
														{{ item.name }}</button
													><small class="muted">{{ item.code }}</small>
												</div>
											</div>
										</td>
										<td><PreviewStockDetails :item="item" /></td>
										<td class="numeric">
											{{ item.available }} {{ item.uom }}
										</td>
										<td>
											<span
												v-if="expiryStatus(item)"
												class="badge"
												:class="
													expiryStatus(item) === '未过期'
														? 'success'
														: expiryStatus(item) === '已过期'
															? 'danger'
															: 'warning'
												"
												>{{ expiryStatus(item) }}</span
											>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
					</template>
				</div>
			</div>
			<details class="form-section">
				<summary>分析当前结果</summary>
				<label class="preview-field"
					>分组<select v-model="analysisDimension">
						<option value="category">类别 / 单位</option>
						<option value="location">位置 / 单位</option>
					</select></label
				>
				<p v-for="[key, group] in analysis" :key="key">
					{{ key }} · {{ group.items.size }} 种物品 · 可用 {{ group.available }} · 借出
					{{ group.loaned }} · 损坏 {{ group.damaged }}
				</p>
				<p class="muted">统计完整筛选结果；跨位置的物品数不可相加。</p>
			</details>
			<footer class="result-footer">
				<span
					>已加载 {{ Math.min(resultLimit, rows.length) }} · 筛选结果 {{ rows.length }} ·
					全部 {{ reviewSession.stock.length }}</span
				><span>示例数据 · 不连接真实库存</span>
				<span v-if="status === 'load-more-error'" role="alert"
					>加载更多失败，选择保留。<UiButton
						@click="
							status = 'ready';
							resultLimit += 20;
						"
						>重试加载</UiButton
					></span
				><UiButton v-else-if="resultLimit < rows.length" @click="resultLimit += 20"
					>加载更多</UiButton
				>
			</footer>
		</section>
		<label class="demo-state-control"
			>评审工具 · 数据状态<select v-model="status">
				<option value="ready">正常</option>
				<option value="loading">首次加载</option>
				<option value="refresh">保留结果并刷新</option>
				<option value="empty">无结果</option>
				<option value="error">加载失败</option>
				<option value="load-more-error">加载更多失败</option>
			</select></label
		>
		<PreviewReturnToTop :active="active !== false" :hidden="isMobile && filtersOpen" />
		<PreviewOverlay
			v-if="filtersOpen && isMobile"
			title="筛选库存"
			drawer
			@close="filtersOpen = false"
			><HierarchyFilter
				v-model="warehouses"
				:options="reviewSession.warehouses"
				title="仓库位置"
				placeholder="查找仓库"
			/><PreviewSearchSelect
				label="物品类别"
				v-model="category"
				:options="
					reviewSession.categories.map((row) => ({
						value: row.name,
						label: row.label,
						detail: row.parent,
					}))
				"
			/><template #footer
				><UiButton @click="clear">恢复默认筛选</UiButton
				><UiButton variant="primary" @click="filtersOpen = false">完成</UiButton></template
			></PreviewOverlay
		>
		<PreviewOverlay v-if="summaryOpen" title="当前筛选的数量汇总" @close="summaryOpen = false"
			><p class="muted">覆盖 {{ rows.length }} 种匹配物品，按单位分别计算。</p>
			<QuantitySummary :metrics="metrics" /><template #footer
				><UiButton @click="summaryOpen = false">完成</UiButton></template
			></PreviewOverlay
		>
		<PreviewOverlay v-if="exportOpen" title="导出当前筛选结果" @close="exportOpen = false"
			><p>共 {{ rows.length }} 种物品，包含当前筛选的全部匹配记录。</p>
			<dl class="detail-list">
				<dt>搜索</dt>
				<dd>{{ search || "不限" }}</dd>
				<dt>仓库</dt>
				<dd>{{ warehouses.join("、") || "全部" }}</dd>
				<dt>类别</dt>
				<dd>{{ category || "全部" }}</dd>
			</dl>
			<label class="preview-field field"
				>文件格式<select v-model="exportFormat">
					<option value="xlsx">XLSX</option>
					<option value="csv">CSV</option>
				</select></label
			>
			<label class="preview-field"
				>导出内容<select v-model="exportDataset">
					<option value="summary">物品汇总</option>
					<option value="details">逐库位明细</option>
				</select></label
			>
			<p>{{ exportRows.length }} 行 · 当前完整筛选范围</p>
			<ul>
				<li v-for="(row, index) in exportRows" :key="index">{{ row }}</li>
			</ul>
			<p class="muted">设计演示，不生成真实文件。筛选和已选物品保持不变。</p>
			<template #footer
				><UiButton @click="exportOpen = false">取消</UiButton
				><UiButton
					variant="primary"
					icon="download"
					@click="
						exportOpen = false;
						emit(
							'notify',
							`已模拟导出 ${exportRows.length} 行（${exportFormat.toUpperCase()}），未生成文件。`,
						);
					"
					>模拟导出</UiButton
				></template
			></PreviewOverlay
		>
		<PreviewOverlay v-if="scanOpen" title="扫码查找物品 · 模拟" @close="scanOpen = false"
			><div class="scan-placeholder">
				<InventoryIcon name="scan" /><span>本预览不申请相机权限</span>
			</div>
			<p>手动输入仍然可用。模拟扫描会填入示例物品编号。</p>
			<template #footer
				><UiButton @click="scanOpen = false">取消</UiButton
				><UiButton
					variant="primary"
					@click="
						search = items[0].code;
						scanOpen = false;
					"
					>模拟识别珍珠米</UiButton
				></template
			></PreviewOverlay
		>
	</div>
</template>
