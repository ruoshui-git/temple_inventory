<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import UiButton from "../../components/ui/UiButton.vue";
import type { OperationBrowse } from "./useOperationBrowse";
import { sitePeriodSummary } from "../../lib/sitePeriod";

const props = defineProps<{
	controller: OperationBrowse;
	family: "movements" | "loans";
	records: boolean;
	hierarchyInRail?: boolean;
}>();
const { query, scope, status, statusChoices, extraChips, historyScope } = props.controller;
</script>
<template>
	<div class="operation-browse-filters browse-filter-dense">
		<div class="browse-filter-mega">
			<section class="browse-filter-mega-section">
				<details
					v-if="family === 'loans' && !records"
					class="browse-filter-disclosure"
					data-filter-field="historyScope"
				>
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />
						物品历史记录范围
						<small>{{ historyScope === "all" ? "全部相关记录" : "未结清借用" }}</small>
					</summary>
					<div class="browse-tabs" role="group" aria-label="物品历史记录范围">
						<UiButton
							v-for="[value, label] in [
								['outstanding', '未结清借用'],
								['all', '全部相关记录'],
							]"
							:key="value"
							:aria-pressed="historyScope === value"
							:variant="historyScope === value ? 'primary' : 'ghost'"
							@click="controller.setHistoryScope(value as 'outstanding' | 'all')"
							>{{ label }}</UiButton
						>
					</div>
				</details>
				<BrowseFilters
					v-model="scope"
					disclosure-mode
					:movement="family === 'movements'"
					:records="records"
					:hierarchy-in-rail="hierarchyInRail"
				/>
				<details class="browse-filter-disclosure" data-filter-field="period">
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />
						{{ family === "movements" ? "流动日期" : "借出日期" }}
						<small>{{
							sitePeriodSummary(scope.period, controller.reference.siteDate)
						}}</small>
					</summary>
					<PeriodFilter
						:today="controller.reference.siteDate"
						v-model="scope.period"
						:label="family === 'movements' ? '流动日期' : '借出日期'"
						embedded
					/>
				</details>
				<details
					v-if="records"
					class="browse-filter-disclosure"
					data-filter-field="status"
				>
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />
						状态
						<small>{{
							statusChoices.find(([value]) => value === status)?.[1] || "不限"
						}}</small>
					</summary>
					<label class="preview-field">
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
				</details>
				<details
					v-if="family === 'movements'"
					class="browse-filter-disclosure"
					data-filter-field="includeAdjustments"
				>
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" /> 盘点调整
						<small>{{ query.includeAdjustments ? "包括" : "不包括" }}</small>
					</summary>
					<label class="preview-choice-label preview-check"
						><input
							v-model="query.includeAdjustments"
							type="checkbox"
						/>包括盘点调整</label
					>
				</details>
				<details
					v-if="family === 'loans' && !records"
					class="browse-filter-disclosure"
					data-filter-field="includeZero"
				>
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" /> 已结清物品
						<small>{{ query.includeZero ? "显示" : "隐藏" }}</small>
					</summary>
					<label class="preview-choice-label preview-check"
						><input v-model="query.includeZero" type="checkbox" />显示已结清物品</label
					>
				</details>
				<UiButton class="browse-filter-clear" @click="controller.clearFilters"
					>清空筛选</UiButton
				>
			</section>
			<section class="browse-filter-mega-section browse-filter-grouping">
				<h3>分组</h3>
				<div data-filter-field="groupBy" tabindex="-1">
					<GroupByFilter
						v-model="query.groupBy"
						:dataset="query.dataset"
						:view="query.view"
					/>
				</div>
			</section>
		</div>
	</div>
</template>
