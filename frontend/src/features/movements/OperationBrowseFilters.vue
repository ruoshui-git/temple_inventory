<script setup lang="ts">
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import UiButton from "../../components/ui/UiButton.vue";
import type { OperationBrowse } from "./useOperationBrowse";

const props = defineProps<{
	controller: OperationBrowse;
	family: "movements" | "loans";
	records: boolean;
	hierarchyInRail?: boolean;
}>();
const { query, scope, status, statusChoices, extraChips } = props.controller;
</script>
<template>
	<div class="operation-browse-filters browse-filter-dense">
		<div class="browse-filter-mega">
			<section class="browse-filter-mega-section">
				<h3>筛选</h3>
				<BrowseFilters
					v-model="scope"
					:movement="family === 'movements'"
					:records="records"
					:hierarchy-in-rail="hierarchyInRail"
				/>
				<PeriodFilter
					:today="controller.reference.siteDate"
					v-model="scope.period"
					:label="family === 'movements' ? '流动日期' : '借出日期'"
					embedded
				/>
				<label v-if="records" class="preview-field">
					状态
					<select
						v-model="status"
						:aria-label="family === 'movements' ? '流动记录状态' : '借用状态'"
					>
						<option
							v-for="[value, label] in statusChoices"
							:key="value"
							:value="value"
						>
							{{ label }}
						</option>
					</select>
				</label>
				<label v-if="family === 'movements'" class="preview-choice-label preview-check">
					<input v-model="query.includeAdjustments" type="checkbox" />包括盘点调整
				</label>
				<label
					v-if="family === 'loans' && !records"
					class="preview-choice-label preview-check"
				>
					<input v-model="query.includeZero" type="checkbox" />显示已结清物品
				</label>
				<UiButton @click="controller.clearFilters">清空筛选</UiButton>
			</section>
			<section class="browse-filter-mega-section browse-filter-grouping">
				<h3>分组</h3>
				<GroupByFilter
					v-model="query.groupBy"
					:dataset="query.dataset"
					:view="query.view"
				/>
			</section>
		</div>
	</div>
</template>
