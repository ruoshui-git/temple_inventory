<script setup lang="ts">
import { siteDateTime } from "../../lib/nativeTime";
import { computed, ref, watch } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { useFocusVisibility } from "../../composables/useFocusVisibility";
import UiButton from "../../components/ui/UiButton.vue";
import BrowseToolbar from "../../components/ui/BrowseToolbar.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import FilterButton from "../../components/ui/FilterButton.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import Overlay from "../../components/ui/Overlay.vue";
import ReturnToTop from "../../components/ui/ReturnToTop.vue";
import ItemImage from "../../components/ItemImage.vue";
import StockDetails from "../../components/StockDetails.vue";
import QuickExport from "../../components/QuickExport.vue";
import Scanner from "../../components/Scanner.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import SortControl from "../../components/ui/SortControl.vue";

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
	scope,
	view,
	sort,
	descending,
	selected,
	inStockOnly,
	analysisDimension,
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
const toolbar = ref<InstanceType<typeof BrowseToolbar>>();
const browseHeader = computed(() => toolbar.value?.$el as HTMLElement | undefined);
const sortDirection = computed({
	get: () => (descending.value ? "desc" : "asc"),
	set: (value: "asc" | "desc") => (descending.value = value === "desc"),
});
const sortFields = [
	{ value: "name", label: "物品名称" },
	{ value: "available", label: "可用数量" },
];

const results = ref<HTMLElement>();
useFocusVisibility(
	inventoryRoot,
	ref<HTMLElement>(),
	() => true,
	() => props.active !== false,
	browseHeader,
);
const analysisOpen = ref(false);
const filtersOpen = ref(false),
	scanOpen = ref(false);
watch([() => props.active, isMobile], () => {
	if (props.active === false) filtersOpen.value = false;
	scanOpen.value = false;
	analysisOpen.value = false;
});
</script>
<template>
	<div ref="inventoryRoot" class="inventory-example">
		<p v-if="queryError" role="alert">{{ queryError }}</p>
		<BrowseToolbar
			ref="toolbar"
			class="inventory-browse-header"
			title="库存"
			:summary="`库存 · ${data.snapshot ? data.total + ' 种' : '读取中'}${selected.length ? ' · 已选 ' + selected.length : ''}`"
			v-model:search="search"
			search-label="搜索库存"
			:active="active"
			:filter-count="appliedChips.length"
			:filters-open="filtersOpen"
			scannable
			@scan="scanOpen = true"
			@filters="filtersOpen = !filtersOpen"
		>
			<template #subtitle
				><p class="muted">查看库存、找到位置，让下一次取用更从容。</p></template
			>
			<template #actions>
				<QuickExport
					:query="quickReportQuery"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
				<UiButton
					v-for="item in controller.actions.value"
					:key="item.kind"
					:icon="item.icon"
					variant="primary"
					@click="controller.action(item.name)"
					>{{ item.name }}</UiButton
				>
			</template>
			<div class="inventory-context"><slot name="context" /></div>
			<div class="inventory-toolbar">
				<label class="search-box"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						aria-label="搜索物品或条码"
						placeholder="搜索物品名称、编号…"
				/></label>
				<UiButton icon="scan" @click="scanOpen = true">扫码</UiButton>
				<FilterButton
					:expanded="filtersOpen"
					:count="appliedChips.length"
					@click="filtersOpen = !filtersOpen"
				/>
			</div>
			<div class="result-tools">
				<div class="segmented" aria-label="库存显示方式">
					<button :aria-pressed="view === 'card'" @click="view = 'card'">
						<InventoryIcon name="card" />卡片
					</button>
					<button :aria-pressed="view === 'table'" @click="view = 'table'">
						<InventoryIcon name="table" />列表
					</button>
				</div>
				<SortControl
					v-model:field="sort"
					v-model:direction="sortDirection"
					:fields="sortFields"
					label="库存排序"
				/>
			</div>
			<div v-if="appliedChips.length || search" class="chip-row">
				<button
					v-for="chip in appliedChips"
					:key="chip.key"
					class="chip"
					:title="chip.label"
					@click="chip.remove()"
				>
					{{ chip.label }} ×
				</button>
				<button v-if="search" class="chip" @click="search = ''">{{ search }} ×</button>
				<UiButton variant="ghost" @click="clear">清空筛选</UiButton>
			</div>
			<slot name="context-actions" />
			<template #result-tools>
				<UiButton :disabled="!data.snapshot" @click="analysisOpen = true"
					>分析结果</UiButton
				>
			</template>
			<template #selection>
				<div
					v-if="selected.length"
					class="selection-bar stock-selection-actions"
					role="region"
					aria-label="已选物品操作"
				>
					<span role="status">已选择 {{ selected.length }} 项物品</span>
					<UiButton
						v-for="item in controller.selectedActions.value"
						:key="item.kind"
						:icon="item.icon"
						@click="controller.selectedAction(item.kind)"
						>{{ item.name }}</UiButton
					>
					<UiButton variant="ghost" @click="selected = []">取消选择</UiButton>
				</div>
			</template>
		</BrowseToolbar>
		<section class="surface inventory-surface">
			<p v-if="data.snapshot" class="browse-result-count">
				筛选结果：{{ data.total }} 种物品
			</p>
			<QuantitySummary
				v-if="data.snapshot"
				:metrics="metrics"
				:loading="status === 'refresh'"
			/>
			<div class="inventory-body" :class="{ 'with-filters': filtersOpen && !isMobile }">
				<aside v-if="filtersOpen && !isMobile" class="filter-rail browse-filter-rail">
					<h3>筛选库存</h3>
					<div class="browse-filter-dense">
						<BrowseFilters
							v-model="scope"
							:fields="['categories', 'warehouses']"
							hide-activity
						/>
						<label class="preview-choice-label preview-check">
							<input type="checkbox" v-model="inStockOnly" />仅有库存
						</label>
						<UiButton variant="ghost" @click="clear">恢复默认筛选</UiButton>
					</div>
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
										>{{ item.category ? `${item.category} · ` : ""
										}}{{ item.code }}</span
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
											<button @click="sortBy('name')">
												物品名称
												{{
													sort === "name"
														? descending
															? "↓"
															: "↑"
														: "↕"
												}}
											</button>
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
												可用数量
												{{
													sort === "available"
														? descending
															? "↓"
															: "↑"
														: "↕"
												}}
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
			<Overlay
				v-if="analysisOpen"
				title="分析当前结果"
				adaptive-creation
				@close="analysisOpen = false"
			>
				<label class="preview-field"
					>分组<select v-model="analysisDimension">
						<option value="category">类别 / 单位</option>
						<option value="location">位置 / 单位</option>
					</select></label
				>
				<ReportTable
					:table="{
						id: 'stock-analysis',
						label: '完整筛选分组',
						columns: [
							analysisDimension === 'category' ? 'category' : 'warehouse',
							'stock_uom',
							'item_count',
							'available',
							'loaned',
							'damaged',
						],
						rows: analysis,
					}"
					:loading="data.loading"
					:initialized="!!data.snapshot"
					:error="data.error"
					@retry="load()"
				/>
				<p class="muted">统计完整筛选结果；跨位置的物品数不可相加。</p>
			</Overlay>
			<footer class="result-footer">
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
			><div class="browse-filter-dense">
				<BrowseFilters
					v-model="scope"
					:fields="['categories', 'warehouses']"
					hide-activity
				/>
				<label class="preview-choice-label preview-check">
					<input type="checkbox" v-model="inStockOnly" />仅有库存
				</label>
			</div>
			<template #footer
				><UiButton @click="clear">恢复默认筛选</UiButton
				><UiButton variant="primary" @click="filtersOpen = false">完成</UiButton></template
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
