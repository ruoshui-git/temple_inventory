<script setup lang="ts">
import type { ExpiryBrowse } from "./useExpiryBrowse";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import UiButton from "../../components/ui/UiButton.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
const props = defineProps<{ controller: ExpiryBrowse; hierarchyInRail?: boolean }>();
const { scope, query } = props.controller;
</script>
<template>
	<div class="browse-filter-dense">
		<BrowseFilters
			v-model="scope"
			:fields="['item', 'categories', 'warehouses']"
			:hierarchy-in-rail="hierarchyInRail"
			hide-activity
		/>
		<PeriodFilter
			v-model="scope.period"
			label="到期日期"
			:today="props.controller.reference.siteDate"
			embedded
		/>
		<label class="preview-choice-label"
			><input v-model="query.includeZero" type="checkbox" />包含零库存批次</label
		>
		<label class="preview-choice-label"
			><input v-model="query.includeUndated" type="checkbox" />全部日期中包含无效期</label
		>
		<UiButton @click="controller.clearSecondary">清空筛选</UiButton>
	</div>
</template>
