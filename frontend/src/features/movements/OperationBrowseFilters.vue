<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import BrowseFilters from "../../components/filters/BrowseFilters.vue";
import ItemStatusFilter from "../../components/filters/ItemStatusFilter.vue";
import GroupByFilter from "../../components/filters/GroupByFilter.vue";
import PeriodFilter from "../../components/ui/PeriodFilter.vue";
import UiButton from "../../components/ui/UiButton.vue";
import type { OperationBrowse } from "./useOperationBrowse";
import { sitePeriodSummary } from "../../lib/sitePeriod";
import RemoteSelect from "../../components/ui/RemoteSelect.vue";
import { useFilterChoices } from "../references/useFilterChoices";
const choices = useFilterChoices();
const props = defineProps<{
	controller: OperationBrowse;
	family: "movements" | "loans";
	records: boolean;
	hierarchyInRail?: boolean;
}>();
const personRoleLabels: Record<string, string> = {
	any: "任一角色",
	recorder: "记录人",
	handler: "经手人",
	reviewer: "鉴证人",
};
const loadPeople = (search: string, start: number, signal: AbortSignal) =>
	choices.loadPeople(search, start, signal, String(props.controller.query.value.person.role));
const loadBorrowers = choices.loadBorrowers;
function setPersonName(name: string) {
	query.value.person = {
		...query.value.person,
		name,
		...(name ? {} : { role: "any" }),
	};
}

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
					<div class="segmented" role="group" aria-label="物品历史记录范围">
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
				<ItemStatusFilter v-model="query.itemStatus" />
				<details class="browse-filter-disclosure" data-filter-field="person">
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />人员<small>{{
							query.person.name || "不限"
						}}</small>
					</summary>
					<RemoteSelect
						label="人员"
						:model-value="query.person.name"
						:context="query.person.role"
						:load="loadPeople"
						@update:model-value="setPersonName($event)"
					/>
					<label class="preview-field"
						>角色<select
							v-model="query.person.role"
							aria-label="人员角色"
							:disabled="!query.person.name"
						>
							<option
								v-for="(label, role) in personRoleLabels"
								:key="role"
								:value="role"
							>
								{{ label }}
							</option>
						</select></label
					>
				</details>
				<details
					v-if="family === 'loans'"
					class="browse-filter-disclosure"
					data-filter-field="borrower"
				>
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />借用方<small>{{
							query.borrower || "不限"
						}}</small>
					</summary>
					<RemoteSelect label="借用方" v-model="query.borrower" :load="loadBorrowers" />
				</details>
				<details
					v-if="family === 'loans'"
					class="browse-filter-disclosure"
					data-filter-field="loanOutcome"
				>
					<summary class="ti-disclosure">
						<DisclosureIcon variant="inline" />归还结果<small>{{
							query.loanOutcome === "all"
								? "全部"
								: query.loanOutcome === "returned"
									? "归还"
									: query.loanOutcome === "damaged"
										? "损坏"
										: query.loanOutcome === "lost"
											? "遗失"
											: "未归还"
						}}</small>
					</summary>
					<label class="preview-field"
						>归还结果<select v-model="query.loanOutcome" aria-label="归还结果">
							<option value="all">全部</option>
							<option value="returned">归还</option>
							<option value="damaged">损坏</option>
							<option value="lost">遗失</option>
						</select></label
					>
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
