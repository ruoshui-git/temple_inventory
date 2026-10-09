<script setup lang="ts">
import CategorySelector from "../../components/CategorySelector.vue";
import MovementPeriodSelector, {
	type MovementPeriodKey,
} from "../../components/MovementPeriodSelector.vue";
import WarehouseSelector from "../../components/WarehouseSelector.vue";
import CompactFilterSection from "../../components/CompactFilterSection.vue";
import { type ReportsController } from "./useReportsController";
import UiButton from "../../components/UiButton.vue";

const props = defineProps<{ controller: ReportsController }>();
const {
	boot,
	reportType,
	busy,
	error,
	movementKinds,
	reportCards,
	labels,
	movement,
	stock,
	warehouse,
	expiry,
	expiryMode,
	currentCard,
	warehouseRows,
	warehouseOptions,
	choose,
	toggleMovement,
	setWarehouse,
	normalizedExpiryDays,
	reportFilters,
	download,
} = props.controller;
</script>
<template>
	<main class="app-shell wide-shell reports-page">
		<h1 class="sr-only">报表与导出</h1>
		<section class="report-card-grid" aria-label="选择报表">
			<button
				v-for="card in reportCards"
				:key="card.type"
				type="button"
				class="report-card"
				:aria-pressed="reportType === card.type"
				@click="choose(card.type)"
			>
				<strong>{{ card.title }}</strong>
				<span>{{ card.description }}</span>
			</button>
		</section>

		<section class="report-builder" :aria-labelledby="`${reportType}-heading`">
			<header>
				<div>
					<h2 :id="`${reportType}-heading`">{{ currentCard.title }}</h2>
					<p>{{ currentCard.description }}</p>
				</div>
			</header>

			<div
				v-if="reportType === 'movement' || reportType === 'movement_records'"
				class="compact-filter-form"
			>
				<CompactFilterSection title="时间范围" icon="calendar" :collapsible="false">
					<MovementPeriodSelector
						v-model:period-key="movement.period_key"
						v-model:date-from="movement.date_from"
						v-model:date-to="movement.date_to"
						:show-resolved="false"
					/>
				</CompactFilterSection>
				<CompactFilterSection title="条件" icon="filter">
					<label class="compact-filter-field"
						>搜索物品<input v-model="movement.search" type="search"
					/></label>
					<fieldset class="choice-list">
						<legend>动作</legend>
						<label v-for="kind in movementKinds" :key="kind" class="choice-row">
							<input
								type="checkbox"
								:checked="movement.movement_kinds.includes(kind)"
								@change="toggleMovement(kind)"
							/>{{ labels[kind] }}
						</label>
					</fieldset>
					<CategorySelector
						v-model="movement.item_groups"
						:rows="boot?.item_groups || []"
						embedded
					/>
					<WarehouseSelector
						v-model="movement.warehouses"
						:rows="warehouseRows"
						title="位置"
						embedded
					/>
				</CompactFilterSection>
			</div>

			<div v-else-if="reportType === 'current_stock'" class="compact-filter-form">
				<CompactFilterSection title="库存筛选" icon="filter">
					<label class="compact-filter-field"
						>搜索物品<input v-model="stock.search" type="search"
					/></label>
					<CategorySelector
						v-model="stock.item_groups"
						:rows="boot?.item_groups || []"
						embedded
					/>
					<WarehouseSelector v-model="stock.warehouses" :rows="warehouseRows" embedded />
				</CompactFilterSection>
			</div>

			<div v-else-if="reportType === 'warehouse_stock'" class="compact-filter-form">
				<CompactFilterSection title="仓库报表筛选" icon="warehouse">
					<label
						>仓库 / 位置
						<select
							:value="warehouse.warehouses[0] || ''"
							required
							@change="setWarehouse(($event.target as HTMLSelectElement).value)"
						>
							<option value="">请选择一个仓库或位置</option>
							<option
								v-for="option in warehouseOptions"
								:key="option.value"
								:value="option.value"
							>
								{{ option.label }}
							</option>
						</select></label
					>
					<label class="compact-filter-field"
						>搜索物品<input v-model="warehouse.search" type="search"
					/></label>
					<CategorySelector
						v-model="warehouse.item_groups"
						:rows="boot?.item_groups || []"
						embedded
					/>
				</CompactFilterSection>
			</div>

			<div v-else class="compact-filter-form">
				<CompactFilterSection title="效期筛选" icon="calendar">
					<label class="compact-filter-field"
						>搜索物品或批次<input v-model="expiry.search" type="search"
					/></label>
					<CategorySelector
						v-model="expiry.item_groups"
						:rows="boot?.item_groups || []"
						embedded
					/>
					<WarehouseSelector
						v-model="expiry.warehouses"
						:rows="warehouseRows"
						embedded
					/>
					<fieldset class="choice-list expiry-report-range">
						<legend>效期范围</legend>
						<label class="choice-row"
							><input v-model="expiryMode" type="radio" value="all" />全部效期</label
						>
						<label
							v-for="option in [
								{ value: 'overdue_within', label: '已过期指定天数以内' },
								{ value: 'overdue_beyond', label: '已过期指定天数以上' },
								{ value: 'remaining_within', label: '未来指定天数内到期' },
								{ value: 'remaining_beyond', label: '超过指定天数后到期' },
							]"
							:key="option.value"
							class="choice-row"
						>
							<input v-model="expiryMode" type="radio" :value="option.value" />{{
								option.label
							}}
						</label>
						<label class="choice-row"
							><input
								v-model="expiryMode"
								type="radio"
								value="exact"
							/>准确日期范围</label
						>
						<label v-if="expiryMode !== 'all' && expiryMode !== 'exact'"
							>天数<input
								v-model="expiry.expiry_days"
								type="number"
								min="1"
								@blur="normalizedExpiryDays"
						/></label>
						<div v-if="expiryMode === 'exact'" class="exact-date-grid">
							<label
								>开始日期<input v-model="expiry.expiry_from" type="date"
							/></label>
							<label>结束日期<input v-model="expiry.expiry_to" type="date" /></label>
						</div>
					</fieldset>
				</CompactFilterSection>
			</div>

			<section class="fixed-columns">
				<h3>固定导出内容</h3>
				<p>{{ currentCard.columns }}</p>
				<small>Excel 包含适用的汇总和明细工作表；CSV 为扁平明细。</small>
			</section>
			<p v-if="error" class="error" role="alert">{{ error }}</p>
			<div class="report-actions">
				<UiButton
					variant="primary"
					icon="download"
					:loading="busy === 'xlsx'"
					:disabled="Boolean(busy)"
					@click="download('xlsx')"
					>导出 Excel</UiButton
				>
				<UiButton
					icon="download"
					:loading="busy === 'csv'"
					:disabled="Boolean(busy)"
					@click="download('csv')"
					>导出 CSV</UiButton
				>
			</div>
		</section>
	</main>
</template>
<style scoped>
.reports-page {
	display: grid;
	gap: 18px;
}
.report-card-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 12px;
}
.report-card {
	display: grid;
	gap: 8px;
	text-align: left;
	align-content: start;
	min-height: 120px;
	padding: 16px;
}
.report-card[aria-pressed="true"] {
	border-color: #9b571d;
	background: #f2e7d5;
}
.report-card span,
.report-builder p,
.fixed-columns small {
	color: #6b6257;
}
.report-builder {
	max-width: 840px;
	background: #fff;
	border-radius: 16px;
	padding: 20px;
}
.report-builder h2 {
	margin-top: 0;
}
.compact-filter-form {
	display: grid;
	gap: 16px;
}
.compact-filter-form > label,
.exact-date-grid label {
	display: grid;
	gap: 6px;
}
.choice-list {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 4px 12px;
}
.choice-list legend {
	grid-column: 1 / -1;
	font-weight: 700;
	margin-bottom: 6px;
}
.choice-row {
	display: flex;
	align-items: center;
}
.expiry-report-range > label:last-of-type {
	display: grid;
	grid-column: 1 / -1;
	gap: 6px;
}
.exact-date-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 10px;
	grid-column: 1 / -1;
}
.fixed-columns {
	margin-top: 20px;
	padding: 14px;
	background: #f7f5ef;
	border-radius: 12px;
}
.fixed-columns h3 {
	margin-top: 0;
}
.report-actions {
	display: flex;
	gap: 10px;
	margin-top: 18px;
}
@media (max-width: 800px) {
	.report-card-grid {
		grid-template-columns: 1fr 1fr;
	}
}
@media (max-width: 520px) {
	.report-card-grid,
	.choice-list,
	.exact-date-grid {
		grid-template-columns: 1fr;
	}
	.report-actions {
		display: grid;
		grid-template-columns: 1fr;
	}
}
</style>
