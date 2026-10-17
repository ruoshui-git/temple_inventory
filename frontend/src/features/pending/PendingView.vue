<script setup lang="ts">
import { ref, watch } from "vue";
import type { PendingController } from "./usePendingController";
import type { InitialAllocation } from "../../lib/routeSelection";
import type { ReportQuery } from "../../lib/reportContract";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import FilterButton from "../../components/ui/FilterButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import QuickExport from "../../components/QuickExport.vue";
const props = withDefaults(defineProps<{ controller: PendingController; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{
	item: [code: string];
	operation: [kind: "Repair" | "Disposal", allocation: InitialAllocation];
	openExport: [query: ReportQuery];
}>();
const c = props.controller,
	{ query, scope, scopeChips, chips, routeError, metrics, analysisOpen, dimension } = c;
const table = c.report.mainTable,
	analysisTable = c.analysis.mainTable;
const filterOpen = ref(false),
	{ isMobile } = useResponsiveLayout();
watch(
	() => props.active,
	(value) => {
		if (!value) filterOpen.value = false;
	},
);
</script>
<template>
	<section class="browse-page">
		<header class="browse-heading">
			<h1>损坏待处理</h1>
			<QuickExport
				v-if="!routeError"
				:query="query"
				:active="active"
				@open-full="emit('openExport', $event)"
			/>
		</header>
		<div class="browse-callout">
			<span class="browse-callout-icon"><InventoryIcon name="warning" /></span>
			<div>
				<strong>损坏物资待处理</strong>
				<p>选择修复归库，或将无法使用的物资正式报废。</p>
			</div>
			<b v-if="table?.initialized">{{ c.report.result.total }} 条分配</b>
		</div>
		<p v-if="routeError" role="alert">{{ routeError }}</p>
		<div class="browse-toolbar">
			<label class="browse-search"
				><InventoryIcon name="search" /><input
					v-model="query.search"
					type="search"
					placeholder="搜索物品、批次或存放位置"
			/></label>
			<FilterButton
				:expanded="filterOpen"
				:count="scopeChips.length + chips.filter((chip) => !chip.fixed).length"
				@click="filterOpen = !filterOpen"
			/>
			<label class="preview-field"
				>排序<select v-model="query.sortBy">
					<option value="name">物品名称</option>
					<option value="quantity">损坏数量</option>
					<option value="identity">物品 / 库位编号</option>
					<option value="date">到期日</option>
				</select></label
			><UiButton @click="query.sort = query.sort === 'asc' ? 'desc' : 'asc'">{{
				query.sort === "asc" ? "升序" : "降序"
			}}</UiButton>
		</div>
		<div class="preview-active-filters">
			<UiButton
				v-for="chip in scopeChips"
				:key="chip.key"
				variant="ghost"
				@click="c.removeScope(chip.field, chip.value)"
				>{{ chip.label }} ×</UiButton
			><UiButton
				v-for="chip in chips"
				:key="chip.key"
				variant="ghost"
				:disabled="chip.fixed"
				@click="Object.assign(query, chip.reset)"
				>{{ chip.summary || chip.label }} {{ chip.fixed ? "" : "×" }}</UiButton
			>
		</div>
		<p v-if="c.report.result.loading" role="status">
			{{ table?.rows.length ? "正在更新损坏库存…" : "正在读取损坏库存…" }}
		</p>
		<p v-if="c.report.result.error" role="alert">
			{{ c.report.result.error }} <UiButton @click="c.report.refresh">重试</UiButton>
		</p>
		<p v-if="c.report.result.stale" role="status">结果正在更新，完成后可继续处理。</p>
		<QuantitySummary :metrics="metrics" :loading="c.report.result.loading" />
		<div class="preview-browse-body">
			<aside v-if="filterOpen && !isMobile" class="preview-filter-rail">
				<BrowseFilters
					v-model="scope"
					:fields="['item', 'categories', 'warehouses']"
					hide-activity
				/><UiButton @click="c.clear">清空筛选</UiButton>
			</aside>
			<Overlay
				v-if="filterOpen && isMobile"
				title="筛选损坏库存"
				drawer
				@close="filterOpen = false"
				><BrowseFilters
					v-model="scope"
					:fields="['item', 'categories', 'warehouses']"
					hide-activity
				/><UiButton @click="c.clear">清空筛选</UiButton></Overlay
			>
			<div class="preview-browse-results">
				<div v-if="table?.rows.length" class="browse-grid browse-grid--two">
					<article
						v-for="row in table.rows"
						:key="String(row.id)"
						:data-browse-row="String(row.id)"
						class="browse-card browse-pending-card"
					>
						<div class="browse-card-heading">
							<div>
								<span class="eyebrow"
									>{{ row.item_code }} ·
									{{ row.warehouse_label || row.warehouse }}</span
								>
								<h2>{{ row.item_name }}</h2>
							</div>
							<span class="browse-badge is-danger"
								>损坏 {{ row.damaged }} {{ row.stock_uom }}</span
							>
						</div>
						<p class="muted">
							{{ row.batch_no ? "批次 " + row.batch_no : "不分批次" }} ·
							{{ row.expiry_date ? "到期 " + row.expiry_date : "无效期" }}
						</p>
						<div class="browse-actions">
							<UiButton
								v-if="c.canAct('Repair', row)"
								variant="primary"
								icon="loan"
								@click="emit('operation', 'Repair', c.allocation(row))"
								>修复归库</UiButton
							><UiButton
								v-if="c.canAct('Disposal', row)"
								variant="danger"
								icon="trash"
								@click="emit('operation', 'Disposal', c.allocation(row))"
								>报废</UiButton
							>
							<UiButton
								:disabled="c.report.result.stale"
								@click="emit('item', String(row.item_code))"
								>物品详情</UiButton
							><QuickExport
								v-if="!c.report.result.stale"
								:query="c.rowQuery(row)"
								:active="active"
								@open-full="emit('openExport', $event)"
							/>
						</div>
					</article>
				</div>
				<p
					v-else-if="
						!c.report.result.loading && !c.report.result.error && table?.initialized
					"
				>
					当前没有符合条件的损坏物资。
				</p>
				<p v-if="table?.error" role="alert">
					{{ table.error }}
					<UiButton @click="c.report.loadTable(table, true)">重试加载</UiButton>
				</p>
				<UiButton
					v-if="table?.next !== null && table?.next !== undefined"
					:loading="table.loading"
					@click="c.report.loadTable(table, true)"
					>加载更多</UiButton
				>
				<details
					data-browse-details="analysis"
					:open="analysisOpen"
					@toggle="analysisOpen = ($event.target as HTMLDetailsElement).open"
				>
					<summary>分析当前结果</summary>
					<label class="preview-field"
						>分析维度<select v-model="dimension">
							<option value="category">类别</option>
							<option value="location">位置</option>
						</select></label
					>
					<p v-if="c.analysis.result.loading" role="status">正在读取分析…</p>
					<p v-if="c.analysis.result.error" role="alert">
						{{ c.analysis.result.error }}
						<UiButton @click="c.analysis.refresh">重试分析</UiButton>
					</p>
					<ReportTable
						v-if="analysisTable && !c.analysis.result.stale"
						:table="{
							...analysisTable,
							columns: [
								dimension === 'location' ? 'warehouse' : 'category',
								'stock_uom',
								'item_count',
								'allocation_count',
								'damaged',
							],
						}"
						:total="analysisTable.total"
						:loading="analysisTable.loading"
						:error="analysisTable.error"
						@load-more="c.analysis.loadTable(analysisTable, true)"
						@retry="c.analysis.loadTable(analysisTable, true)"
					/>
				</details>
			</div>
		</div>
	</section>
</template>
