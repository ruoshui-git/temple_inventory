<script setup lang="ts">
import type { ExpiryBrowse } from "./useExpiryBrowse";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import UiButton from "../../components/ui/UiButton.vue";
const props = defineProps<{ controller: ExpiryBrowse }>();
const { scope, query } = props.controller;
</script>
<template>
	<BrowseFilters
		v-model="scope"
		:fields="['item', 'categories', 'warehouses']"
		hide-activity
	/><label class="preview-choice-label"
		><input v-model="query.includeZero" type="checkbox" />包含零库存批次</label
	><label class="preview-choice-label"
		><input v-model="query.includeUndated" type="checkbox" />全部日期中包含无效期</label
	><UiButton @click="controller.clearSecondary">清空筛选</UiButton>
</template>
