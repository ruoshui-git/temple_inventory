<script setup lang="ts">
import UiLoadingBoundary from "../../components/UiLoadingBoundary.vue";
import ExportDialog from "../../components/ExportDialog.vue";
import { type WarehouseDetailController } from "./useWarehouseDetailController";
import UiButton from "../../components/UiButton.vue";
import { ref } from "vue";

const props = defineProps<{ controller: WarehouseDetailController }>();
const stockRegion = ref<HTMLElement>();
const movementsRegion = ref<HTMLElement>();
const {
	detail,
	boot,
	error,
	exportOpen,
	stockLoading,
	movementsLoading,
	node,
	presented,
	stock,
	movements,
	groups,
	capabilities,
	actionKinds,
	permittedActions,
	queryValue,
	link,
	operation,
	close,
	retry,
} = props.controller;
</script>
<template>
	<section class="app-shell wide-shell warehouse-detail-page">
		<header>
			<button type="button" @click="close">‹ 返回</button>
			<div>
				<h1>{{ presented?.localLabel || "仓库详情" }}</h1>
				<p v-if="presented && presented.breadcrumb !== presented.localLabel">
					{{ presented.breadcrumb }}
				</p>
			</div>
			<UiButton class="desktop-only-export" icon="download" @click="exportOpen = true"
				>导出库存</UiButton
			>
		</header>
		<p v-if="error" class="error">
			{{ error }} <button type="button" @click="retry">重试</button>
		</p>
		<UiLoadingBoundary
			v-if="!detail && stockLoading"
			class="warehouse-detail-initial-boundary"
			:busy="true"
			mode="initial"
			message="正在加载仓库详情…"
		/>
		<template v-else-if="detail"
			><p v-if="presented && !presented.canOperate" class="notice">
				当前仓库暂时不能执行库存操作，请联系管理员检查配置。
			</p>
			<section class="warehouse-detail-section" :aria-busy="stockLoading">
				<h2>库存分类</h2>
				<p v-if="!stockLoading && !groups.length" class="empty-state">暂无库存分类</p>
				<div v-if="groups.length" class="summary-grid">
					<article v-for="group in groups" :key="group.item_group || group.name">
						<strong>{{ group.item_group || group.name }}</strong
						><span
							v-for="quantity in group.quantities || [
								{ qty: group.qty, uom: group.uom || group.stock_uom },
							]"
							:key="`${quantity.uom}-${quantity.qty}`"
							>{{ quantity.qty }} {{ quantity.uom }}</span
						>
					</article>
				</div>
			</section>
			<section class="warehouse-detail-section" :aria-busy="stockLoading">
				<div class="section-heading">
					<h2>当前库存</h2>
					<RouterLink :to="link('/')">查看全部库存</RouterLink>
				</div>
				<div
					ref="stockRegion"
					class="detail-list"
					:inert="stockLoading && stock.length ? true : undefined"
				>
					<template v-if="stock.length">
						<article
							v-for="row in stock.slice(0, 20)"
							:key="row.name || `${row.item_code}-${row.warehouse}-${row.batch_no}`"
						>
							<strong>{{ row.item_name || row.item_code }}</strong
							><span
								>{{ row.qty ?? row.actual_qty }}
								{{ row.uom || row.stock_uom }}</span
							><small v-if="row.batch_no"
								>批次 {{ row.batch_no
								}}<template v-if="row.expiry_date">
									· 到期 {{ row.expiry_date }}</template
								></small
							><small v-if="row.warehouse">{{
								row.location_label || row.warehouse
							}}</small>
						</article>
					</template>
					<p v-else-if="!stockLoading" class="empty-state">当前没有库存</p>
					<p v-if="detail.stock_total != null" class="muted">
						共 {{ detail.stock_total }} 条记录
					</p>
				</div>
				<UiLoadingBoundary
					class="warehouse-detail-loading-boundary-proxy"
					:busy="stockLoading"
					:mode="stock.length ? 'refresh' : 'initial'"
					:message="stock.length ? '正在更新库存…' : '正在加载库存…'"
					:region="stockRegion"
					:dim-region="Boolean(stock.length)"
					:block-interactions="false"
				/>
			</section>
			<section class="warehouse-detail-section" :aria-busy="movementsLoading">
				<div class="section-heading">
					<h2>最近动态</h2>
					<RouterLink :to="link('/movements')">查看历史</RouterLink>
				</div>
				<div
					ref="movementsRegion"
					class="detail-list"
					:inert="movementsLoading && movements.length ? true : undefined"
				>
					<template v-if="movements.length">
						<article v-for="row in movements.slice(0, 10)" :key="row.name">
							<strong>{{ row.movement_kind || row.type || "库存变动" }}</strong
							><span
								>{{ row.item_name || row.item_code }} ·
								{{ row.qty ?? row.quantity }} {{ row.uom || "" }}</span
							><small
								>{{ row.posting_date || row.date
								}}<template v-if="row.operator">
									· {{ row.operator }}</template
								></small
							>
						</article>
					</template>
					<p v-else-if="!movementsLoading" class="empty-state">暂无最近动态</p>
				</div>
				<UiLoadingBoundary
					class="warehouse-detail-loading-boundary-proxy"
					:busy="movementsLoading"
					:mode="movements.length ? 'refresh' : 'initial'"
					:message="movements.length ? '正在更新动态…' : '正在加载动态…'"
					:region="movementsRegion"
					:dim-region="Boolean(movements.length)"
					:block-interactions="false"
				/>
			</section>
			<section v-if="presented?.canOperate" class="detail-actions warehouse-actions">
				<button
					v-for="kind in permittedActions"
					:key="kind"
					type="button"
					@click="operation(kind)"
				>
					{{
						(
							{
								Receive: "入库",
								Issue: "出库",
								Transfer: "转移",
								Reconcile: "盘点",
							} as any
						)[kind]
					}}
				</button>
			</section>
		</template>
		<ExportDialog
			v-model:open="exportOpen"
			report-type="warehouse_stock"
			:filters="{ warehouses: [queryValue] }"
			title="导出仓库库存"
			:summary="`导出 ${presented?.breadcrumb || presented?.localLabel || '当前仓库'} 及其下属位置的库存。`"
		/>
	</section>
</template>

<style scoped>
.warehouse-detail-page header {
	align-items: flex-start;
	gap: 14px;
}
.warehouse-detail-page header > div {
	flex: 1;
}
.warehouse-detail-page header p {
	margin: 0;
	color: #6b6257;
}
.secondary-action {
	margin-left: auto;
}
.warehouse-detail-section {
	position: relative;
	margin: 18px 0;
	padding: 18px;
	background: #fff;
	border-radius: 14px;
	box-shadow: 0 2px 10px #1720330c;
}
.warehouse-detail-loading-boundary-proxy {
	display: contents;
}
.warehouse-detail-initial-boundary {
	min-height: 180px;
}
.section-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
}
.section-heading h2 {
	margin-top: 0;
}
.summary-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: 10px;
}
.summary-grid article,
.detail-list article {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 12px;
	border: 1px solid #eee8db;
	border-radius: 10px;
}
.summary-grid span {
	font-variant-numeric: tabular-nums;
}
.detail-list {
	display: grid;
	gap: 8px;
	min-height: 64px;
}
.detail-list article {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
}
.detail-list small {
	grid-column: 1/-1;
	color: #6b6257;
}
.muted {
	color: #6b6257;
}
.warehouse-actions {
	justify-content: flex-end;
}
@media (max-width: 620px) {
	.warehouse-detail-section {
		padding: 14px;
	}
	.detail-list article {
		grid-template-columns: 1fr;
	}
	.warehouse-actions {
		flex-wrap: wrap;
	}
}
</style>
