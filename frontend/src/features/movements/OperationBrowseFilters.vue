<script setup lang="ts">
import FilterDisclosure from "../../components/ui/FilterDisclosure.vue";
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

const { query, scope, status, statusChoices, extraChips } = props.controller;
</script>
<template>
	<div class="operation-browse-filters browse-filter-dense">
		<div class="browse-filter-mega">
			<section class="browse-filter-mega-section">
				<FilterDisclosure
					v-if="family === 'loans' && !records"
					label="范围"
					field="loanScope"
					:summary="query.loanScope === 'all' ? '借出与归还全部记录' : '仅未归还借出'"
				>
					<div class="segmented" role="group" aria-label="记录范围">
						<UiButton
							v-for="[value, label] in [
								['outstanding', '仅未归还借出'],
								['all', '借出与归还全部记录'],
							]"
							:key="value"
							:aria-pressed="query.loanScope === value"
							:variant="query.loanScope === value ? 'primary' : 'ghost'"
							@click="controller.setHistoryScope(value as 'outstanding' | 'all')"
							>{{ label }}</UiButton
						>
					</div>
					<p class="form-field-hint">
						仅未归还借出：只列仍有未还数量的借出行。借出与归还全部记录：列出全部借出行，以及它们的归还、损坏、遗失行。
					</p>
					<label class="form-choice-label form-check"
						><input v-model="query.includeZero" type="checkbox" />包括已结清物品</label
					>
					<p class="form-field-hint">
						也列出已全部归还的借出行和物品（未归还余额为零）。
					</p>
				</FilterDisclosure>
				<BrowseFilters
					v-model="scope"
					disclosure-mode
					:movement="family === 'movements'"
					:records="records"
					:hierarchy-in-rail="hierarchyInRail"
				/>
				<FilterDisclosure
					:label="family === 'movements' ? '流动日期' : '借出日期'"
					field="period"
					:summary="sitePeriodSummary(scope.period, controller.reference.siteDate)"
				>
					<PeriodFilter
						:today="controller.reference.siteDate"
						v-model="scope.period"
						:label="family === 'movements' ? '流动日期' : '借出日期'"
						embedded
					/>
				</FilterDisclosure>
				<ItemStatusFilter v-model="query.itemStatus" />
				<FilterDisclosure
					label="人员"
					field="person"
					:summary="query.person.name || '不限'"
				>
					<RemoteSelect
						label="人员"
						:model-value="query.person.name"
						:context="query.person.role"
						:load="loadPeople"
						@update:model-value="setPersonName($event)"
					/>
					<label class="form-field"
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
				</FilterDisclosure>
				<FilterDisclosure
					v-if="family === 'loans'"
					label="借用方"
					field="borrower"
					:summary="query.borrower || '不限'"
				>
					<RemoteSelect label="借用方" v-model="query.borrower" :load="loadBorrowers" />
				</FilterDisclosure>
				<FilterDisclosure
					v-if="family === 'loans'"
					label="归还结果"
					field="loanOutcome"
					:summary="
						query.loanOutcome === 'all'
							? '全部'
							: query.loanOutcome === 'returned'
								? '归还'
								: query.loanOutcome === 'damaged'
									? '损坏'
									: query.loanOutcome === 'lost'
										? '遗失'
										: '未归还'
					"
				>
					<label class="form-field"
						><select v-model="query.loanOutcome" aria-label="归还结果">
							<option value="all">全部</option>
							<option value="returned">归还</option>
							<option value="damaged">损坏</option>
							<option value="lost">遗失</option>
						</select></label
					>
				</FilterDisclosure>
				<FilterDisclosure
					v-if="records"
					label="状态"
					field="status"
					:summary="statusChoices.find(([value]) => value === status)?.[1] || '不限'"
				>
					<label class="form-field">
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
				</FilterDisclosure>
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
