<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiButton from "./components/PreviewUiButton.vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import HierarchyFilter from "./components/PreviewHierarchyFilter.vue";
import QuantitySummary from "./components/PreviewQuantitySummary.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import { reviewSession } from "./reviewModel";
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
	warehouseNodes,
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
const search = ref("");
const warehouses = ref<string[]>([]);
const category = ref("");
const view = ref("card");
const sort = ref("name");
const descending = ref(false);
const selected = ref<string[]>([]);
const filtersOpen = ref(false);
const menuOpen = ref(false);
const detail = ref<StockItem>();
const summaryOpen = ref(false);
const scanOpen = ref(false);
const exportOpen = ref(false);
const exportFormat = ref("xlsx");
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
		detail.value = undefined;
		scanOpen.value = false;
		exportOpen.value = false;
	},
);
watch(() => reviewSession.filters.inventory.scope, () => {
 search.value = ""; warehouses.value = []; category.value = ""; status.value = "ready";
});
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
 const source = reviewSession.stock.filter(item => matchesItem(item.code, scope, reviewSession)).map(item => ({...item, locations: item.locations.filter(row => matchesWarehouse(row.location, scope.warehouses, reviewSession))})).filter(item => !scope.warehouses.length || item.locations.length);
 return filterItems(search.value, warehouses.value, category.value, source)
		.sort((a, b) => {
			const result =
				sort.value === "available"
					? a.available - b.available
					: a.name.localeCompare(b.name, "zh-CN");
			return descending.value ? -result : result;
		});
});
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
	if (name === "入库") emit("receive");
	else if (name === "新建物品") emit("navigate", "item-form", "new");
	else emit("navigate", "movement-form", name === "出库" ? "Issue" : "Transfer");
}
</script>
<template>
	<div class="inventory-example">
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
		<div class="proposal-note">
			<InventoryIcon name="notice" /><span>{{
				pattern === "current"
					? "当前结构：桌面并列操作，手机使用浮动 ＋ 按钮。"
					: "实验操作提案：以有文字说明的「新建操作」统一入口；搜索、扫码与筛选始终直接可见。"
			}}</span>
		</div>
		<div class="section-tabs">
			<button class="active" aria-current="page">库存列表</button
			><button
				@click="
					emit('notify', '效期批次：保留批次级浏览。完整页面不在本轮两个示例范围内。')
				"
			>
				效期批次</button
			><span class="muted">示例基准日 · 2026.10.11</span>
		</div>
		<section class="surface inventory-surface">
			<div class="inventory-toolbar">
				<label class="search-box"
					><InventoryIcon name="search" /><input
						v-model="search"
						aria-label="搜索物品或条码"
						placeholder="搜索物品名称、编号…" /></label
				><UiButton icon="scan" @click="scanOpen = true">扫码</UiButton
				><UiButton
					icon="filter"
					:aria-expanded="filtersOpen"
					@click="filtersOpen = !filtersOpen"
					>筛选<span v-if="warehouses.length || category" class="count-dot">{{
						warehouses.length + (category ? 1 : 0)
					}}</span></UiButton
				>
			</div>
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
					><UiButton v-if="!isMobile" icon="download" @click="exportOpen = true"
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
			<div v-if="selected.length" class="selection-bar" role="status">
				<span>已选择 {{ selected.length }} 项物品</span
				><UiButton variant="ghost" @click="selected = []">取消选择</UiButton>
			</div>
			<div class="inventory-body" :class="{ 'with-filters': filtersOpen && !isMobile }">
				<aside v-if="filtersOpen && !isMobile" class="filter-rail">
					<h3>筛选库存</h3>
					<HierarchyFilter
						v-model="warehouses"
						:options="warehouseNodes"
						title="仓库位置"
						placeholder="查找仓库"
					/><label class="field"
						>物品类别<select v-model="category">
							<option value="">全部类别</option>
							<option>食品</option>
							<option>服装</option>
							<option>日用品</option>
						</select></label
					><UiButton variant="ghost" @click="clear">恢复默认筛选</UiButton>
				</aside>
				<div
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
								v-for="item in rows"
								:key="item.code"
								class="stock-card"
								:class="{ selected: selected.includes(item.code) }"
							>
								<div class="stock-card-image">
									<PreviewItemImage
										:item="item"
										interaction="detail"
										@detail="detail = item"
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
											expiryStatus(item) === '有效期内'
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
									><button class="item-name" @click="detail = item">
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
										v-for="item in rows"
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
														@click="detail = item"
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
													expiryStatus(item) === '有效期内'
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
			<footer class="result-footer">
				<span
					>已加载 {{ rows.length }} · 筛选结果 {{ rows.length }} · 全部
					{{ items.length }}</span
				><span>示例数据 · 不连接真实库存</span>
			</footer>
		</section>
		<label class="demo-state-control"
			>评审工具 · 数据状态<select v-model="status">
				<option value="ready">正常</option>
				<option value="loading">首次加载</option>
				<option value="refresh">保留结果并刷新</option>
				<option value="empty">无结果</option>
				<option value="error">加载失败</option>
			</select></label
		>
		<PreviewOverlay
			v-if="filtersOpen && isMobile"
			title="筛选库存"
			drawer
			@close="filtersOpen = false"
			><HierarchyFilter
				v-model="warehouses"
				:options="warehouseNodes"
				title="仓库位置"
				placeholder="查找仓库"
			/><label class="field"
				>物品类别<select v-model="category">
					<option value="">全部类别</option>
					<option>食品</option>
					<option>服装</option>
					<option>日用品</option>
				</select></label
			><template #footer
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
		<PreviewOverlay v-if="detail" :title="detail.name" @close="detail = undefined">
			<PreviewItemImage :item="detail" />
			<dl class="detail-list">
				<dt>物品编号</dt>
				<dd>{{ detail.code }}</dd>
				<dt>可用数量</dt>
				<dd>{{ detail.available }} {{ detail.uom }}</dd>
				<template v-if="detail.tracksBatch"
					><dt>批次数量</dt>
					<dd>{{ itemBatches(detail).length }}</dd></template
				>
			</dl>
			<p class="muted">当前筛选范围 · 库存分布</p>
			<section v-for="row in detail.locations" :key="row.location" class="batch-location">
				<strong>{{ row.location }} · 可用 {{ row.available }} {{ detail.uom }}</strong>
				<p class="muted">
					借出 {{ row.loaned }} · 损坏 {{ row.damaged }} {{ detail.uom }}
				</p>
				<div v-for="batch in detail.tracksBatch ? row.batches || [] : []" :key="batch.id">
					{{ batch.id }} · 可用 {{ batch.available }} {{ detail.uom
					}}<small v-if="detail.tracksExpiry && batch.expiry"
						>到期 {{ batch.expiry }}</small
					>
				</div>
			</section>
			<UiButton
				@click="
					reviewSession.selectedItemCode = detail!.code;
					detail = undefined;
					emit('navigate', 'item-detail', 'overview');
				"
				>打开完整物品详情</UiButton
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
			<label class="field"
				>文件格式<select v-model="exportFormat">
					<option value="xlsx">XLSX · 汇总与明细</option>
					<option value="csv">CSV · 明细</option>
				</select></label
			>
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
							`已模拟导出 ${rows.length} 种物品（${exportFormat.toUpperCase()}），未生成文件。`,
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
