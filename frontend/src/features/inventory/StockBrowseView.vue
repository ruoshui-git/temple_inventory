<script setup lang="ts">
import { siteDateTime } from "../../lib/nativeTime";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { useFocusVisibility } from "../../composables/useFocusVisibility";
import { useScrollSurface, scrollOwner } from "../../composables/scrollSurface";
import UiButton from "../../components/ui/UiButton.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import FilterButton from "../../components/ui/FilterButton.vue";
import HierarchyFilter from "../../components/ui/HierarchyFilter.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import Overlay from "../../components/ui/Overlay.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import ItemImage from "../../components/ItemImage.vue";
import StockDetails from "../../components/StockDetails.vue";
import QuickExport from "../../components/QuickExport.vue";
import Scanner from "../../components/Scanner.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";

import type { StockItem } from "../../lib/stockPresentation";
import type { useStockBrowseController } from "./useStockBrowseController";
const props = withDefaults(
	defineProps<{
		controller: ReturnType<typeof useStockBrowseController>;
		active?: boolean;
		queryError?: string;
		hasArtwork?: (item: StockItem) => boolean;
	}>(),
	{ active: true },
);
const emit = defineEmits<{
	openExport: [query: import("../../lib/reportContract").ReportQuery];
}>();
const {
	appliedChips,
	reference,
	data,
	search,
	warehouses,
	category,
	view,
	sort,
	descending,
	selected,
	inStockOnly,
	analysisDimension,
	inherited,
	query: quickReportQuery,
	metrics,
	rows,
	analysis,
	status,
	load,
	clear,
	reset,
	openItem,
	expiryStatus,
	sortBy,
	toggle,
} = props.controller;
const { isMobile } = useResponsiveLayout();
const inventoryRoot = ref<HTMLElement>();
const browseHeader = ref<HTMLElement>();
const results = ref<HTMLElement>();
useFocusVisibility(
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
const { top, viewport } = useScrollSurface(inventoryRoot, () => props.active !== false);
function updateCompact() {
	const owner = scrollOwner(results.value || null);
	const edge = owner === window ? 0 : (owner as HTMLElement).getBoundingClientRect().top;
	compact.value = !!results.value && results.value.getBoundingClientRect().top < edge - 80;
}
watch([top, viewport, isMobile], updateCompact, { flush: "post" });

const filtersOpen = ref(false),
	menuOpen = ref(false),
	summaryOpen = ref(false),
	scanOpen = ref(false);
const menu = ref<HTMLElement>();
function action(name: string) {
	menuOpen.value = false;
	props.controller.action(name);
}
function closeMenuWithKeyboard() {
	menuOpen.value = false;
	menu.value?.querySelector<HTMLButtonElement>("button")?.focus();
}
function outside(event: PointerEvent) {
	if (event.target instanceof Node && !menu.value?.contains(event.target))
		menuOpen.value = false;
}
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
watch(
	() => [props.active, isMobile.value],
	() => {
		filtersOpen.value = false;
		menuOpen.value = false;
		summaryOpen.value = false;
		scanOpen.value = false;
	},
);
</script>
<template>
	<div ref="inventoryRoot" class="inventory-example" :class="{ 'is-compact': compact }">
		<p v-if="queryError" role="alert">{{ queryError }}</p>
		<header ref="browseHeader" class="inventory-browse-header">
			<div class="page-heading">
				<div>
					<span class="eyebrow">INVENTORY / 库存管理</span>
					<h1>每一份物资，都有去处。</h1>
					<p class="muted">查看库存、找到位置，让下一次取用更从容。</p>
				</div>
				<div v-if="!isMobile" class="button-row">
					<UiButton
						v-for="item in controller.actions.value"
						:key="item.kind"
						:icon="item.icon"
						:variant="item.kind === 'Item' ? 'primary' : 'secondary'"
						@click="action(item.name)"
						>{{ item.name }}</UiButton
					>
				</div>
				<div
					v-else-if="controller.actions.value.length"
					ref="menu"
					class="action-menu"
					:class="{ 'current-fab': isMobile }"
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
						>{{ isMobile ? "＋" : "＋ 新建操作" }}</UiButton
					>
					<div v-if="menuOpen" id="inventory-action-options" class="menu-popover">
						<button
							v-for="item in controller.actions.value"
							:key="item.kind"
							@click="action(item.name)"
						>
							{{ item.name }}<InventoryIcon name="open" />
						</button>
					</div>
				</div>
			</div>
			<div class="inventory-context"><slot name="context" /></div>
			<div class="inventory-toolbar">
				<QuickExport
					:query="quickReportQuery"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
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
				><FilterButton
					:expanded="filtersOpen"
					:count="appliedChips.length"
					@click="filtersOpen = !filtersOpen"
				/>
			</div>
			<div class="inventory-compact-tools">
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
				<div v-if="compact" ref="compactContext"><slot name="context-actions" /></div>
			</div>
			<div
				ref="secondaryTools"
				id="inventory-secondary-tools"
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
						<span class="muted">{{ data.total }} 种物品</span>
					</div>
					<div v-show="toolsOpen" class="button-row">
						<label class="inline-field"
							>排序<select v-model="sort" aria-label="库存排序">
								<option value="name">物品名称</option>
								<option value="available">可用数量</option>
							</select></label
						><UiButton variant="ghost" icon="sigma" @click="summaryOpen = true"
							>列汇总</UiButton
						>
					</div>
				</div>
				<div v-if="appliedChips.length || search" class="chip-row">
					<button
						v-for="chip in appliedChips"
						:key="chip.key"
						class="chip"
						:title="chip.label"
						@click="chip.remove()"
					>
						{{ chip.label }} ×</button
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

		<div v-if="!compact" ref="expandedContext" class="preview-context-actions">
			<slot name="context-actions" />
		</div>
		<section class="surface inventory-surface">
			<div class="inventory-body" :class="{ 'with-filters': filtersOpen && !isMobile }">
				<aside v-if="filtersOpen && !isMobile" class="filter-rail">
					<h3>筛选库存</h3>
					<HierarchyFilter
						v-model="warehouses"
						:options="reference.warehouses"
						title="仓库位置"
						placeholder="查找仓库"
					/><SearchSelect
						label="物品类别"
						v-model="category"
						:options="
							reference.categories.map((row) => ({
								value: row.name,
								label: row.label || row.name,
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
						<UiButton @click="load()">重试</UiButton>
					</div>
					<div v-else-if="!rows.length" class="empty-panel">
						<InventoryIcon name="search" />
						<h3>没有找到匹配的物品</h3>
						<p>试试更短的关键词，或清除筛选。</p>
						<UiButton @click="reset">显示全部物品</UiButton>
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
								:data-browse-row="item.code"
								:key="item.code"
								class="stock-card"
								:class="{ selected: selected.includes(item.code) }"
							>
								<div class="stock-card-image">
									<ItemImage
										:has-artwork="!!hasArtwork?.(item)"
										:item="item"
										interaction="detail"
										@detail="openItem(item)"
										><template #artwork
											><slot
												name="artwork"
												:item="item" /></template></ItemImage
									><label class="card-checkbox"
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

									<StockDetails :item="item" />
								</div>
							</article>
						</div>
						<div v-else class="table-scroll" data-browse-scroll="inventory-table">
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
										:data-browse-row="item.code"
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
													<ItemImage
														:has-artwork="!!hasArtwork?.(item)"
														:item="item"
														><template #artwork
															><slot
																name="artwork"
																:item="item" /></template
													></ItemImage>
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
										<td><StockDetails :item="item" /></td>
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
			<details class="form-section" data-browse-details="analysis">
				<summary>分析当前结果</summary>
				<label class="preview-field"
					>分组<select v-model="analysisDimension">
						<option value="category">类别 / 单位</option>
						<option value="location">位置 / 单位</option>
					</select></label
				>
				<p v-for="group in analysis" :key="String(group.id)">
					{{ group.category || group.warehouse }} · {{ group.stock_uom }} ·
					{{ group.item_count }} 种物品 · 可用 {{ group.available }} · 借出
					{{ group.loaned }} · 损坏 {{ group.damaged }}
				</p>
				<p class="muted">统计完整筛选结果；跨位置的物品数不可相加。</p>
			</details>
			<footer class="result-footer">
				<span
					>已加载 {{ rows.length }} · 筛选结果 {{ data.total }} · 快照（站点时间）
					{{ siteDateTime(data.snapshot) }}</span
				>
				<span v-if="data.stale" role="status">上次结果 · 尚未更新</span>
				<span v-if="data.error || data.moreError" role="alert"
					>{{ data.error || data.moreError }}
					<UiButton @click="load(!!data.moreError)">重试加载</UiButton></span
				>
				<UiButton
					v-else-if="data.next !== null"
					:loading="data.loading"
					@click="load(true)"
					>加载更多</UiButton
				>
			</footer>
		</section>
		<ReturnToTop :active="active !== false" :hidden="isMobile && filtersOpen" />
		<Overlay
			v-if="filtersOpen && isMobile"
			title="筛选库存"
			drawer
			@close="filtersOpen = false"
			><HierarchyFilter
				v-model="warehouses"
				:options="reference.warehouses"
				title="仓库位置"
				placeholder="查找仓库"
			/><SearchSelect
				label="物品类别"
				v-model="category"
				:options="
					reference.categories.map((row) => ({
						value: row.name,
						label: row.label || row.name,
						detail: row.parent,
					}))
				"
			/><template #footer
				><UiButton @click="clear">恢复默认筛选</UiButton
				><UiButton variant="primary" @click="filtersOpen = false">完成</UiButton></template
			></Overlay
		>
		<Overlay v-if="summaryOpen" title="当前筛选的数量汇总" @close="summaryOpen = false"
			><p class="muted">覆盖 {{ data.total }} 种匹配物品，按单位分别计算。</p>
			<QuantitySummary :metrics="metrics" /><template #footer
				><UiButton @click="summaryOpen = false">完成</UiButton></template
			></Overlay
		>

		<Scanner
			v-if="scanOpen"
			presentation="modal"
			@close="scanOpen = false"
			@scan="
				(value) => {
					search = value;
					scanOpen = false;
				}
			"
		/>
	</div>
</template>
