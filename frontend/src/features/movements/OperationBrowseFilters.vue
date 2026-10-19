<script setup lang="ts">
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import UiButton from "../../components/ui/UiButton.vue";
import type { OperationBrowse } from "./useOperationBrowse";

const props = defineProps<{
	controller: OperationBrowse;
	family: "movements" | "loans";
	records: boolean;
}>();
const { query, scope, status, statusChoices, extraChips } = props.controller;
</script>
<template>
	<div class="operation-browse-filters browse-filter-dense">
		<BrowseFilters v-model="scope" :movement="family === 'movements'" :records="records" />
		<PeriodFilter
			:today="controller.reference.siteDate"
			v-model="scope.period"
			:label="family === 'movements' ? '流动日期' : '借出日期'"
		/>
		<label v-if="records" class="preview-field">
			状态
			<select
				v-model="status"
				:aria-label="family === 'movements' ? '流动记录状态' : '借用状态'"
			>
				<option v-for="[value, label] in statusChoices" :key="value" :value="value">
					{{ label }}
				</option>
			</select>
		</label>
		<label v-if="family === 'movements'" class="preview-choice-label preview-check">
			<input v-model="query.includeAdjustments" type="checkbox" />包括盘点调整
		</label>
		<label v-if="family === 'loans' && !records" class="preview-field">
			借用结果
			<select v-model="query.loanOutcome">
				<option value="all">全部</option>
				<option value="outstanding">未归还</option>
				<option value="returned">完好归还</option>
				<option value="damaged">损坏归还</option>
				<option value="lost">遗失</option>
			</select>
		</label>
		<div v-if="extraChips.length" class="preview-active-filters" aria-label="更多筛选条件">
			<UiButton
				v-for="chip in extraChips"
				:key="chip.key"
				variant="ghost"
				:aria-label="`移除${chip.label}`"
				@click="Object.assign(query, chip.reset)"
			>
				{{ chip.summary || chip.label }} ×
			</UiButton>
		</div>
		<UiButton @click="controller.clearFilters">清空筛选</UiButton>
	</div>
</template>
