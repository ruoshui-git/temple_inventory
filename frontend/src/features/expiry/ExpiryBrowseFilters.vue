<script setup lang="ts">
import type { ExpiryBrowse } from "./useExpiryBrowse";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import UiButton from "../../components/ui/UiButton.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import FilterDisclosure from "../../components/ui/FilterDisclosure.vue";
import { sitePeriodSummary } from "../../lib/sitePeriod";
const props = defineProps<{
	controller: ExpiryBrowse;
	hierarchyInRail?: boolean;
	disclosureMode?: boolean;
}>();
const { scope, query } = props.controller;
const periodSummary = () =>
	sitePeriodSummary(scope.value.period, props.controller.reference.siteDate);
</script>
<template>
	<div class="browse-filter-dense">
		<BrowseFilters
			v-model="scope"
			:disclosure-mode="disclosureMode"
			:fields="['item', 'categories', 'warehouses']"
			:hierarchy-in-rail="hierarchyInRail"
			hide-activity
		/>
		<FilterDisclosure
			label="到期日期"
			field="period"
			:disclosure="Boolean(disclosureMode)"
			:summary="periodSummary()"
		>
			<PeriodFilter
				v-model="scope.period"
				label="到期日期"
				:today="props.controller.reference.siteDate"
				embedded
			/>
		</FilterDisclosure>
		<FilterDisclosure
			label="零库存批次"
			field="includeZero"
			:disclosure="Boolean(disclosureMode)"
			:summary="query.includeZero ? '包含' : '不包含'"
		>
			<label class="preview-choice-label"
				><input v-model="query.includeZero" type="checkbox" />包含零库存批次</label
			>
		</FilterDisclosure>
		<FilterDisclosure
			label="无效期批次"
			field="includeUndated"
			:disclosure="Boolean(disclosureMode)"
			:summary="query.includeUndated ? '包含' : '不包含'"
		>
			<label class="preview-choice-label"
				><input
					v-model="query.includeUndated"
					type="checkbox"
				/>全部日期中包含无效期</label
			>
		</FilterDisclosure>
		<UiButton @click="controller.clearSecondary">清空筛选</UiButton>
	</div>
</template>
