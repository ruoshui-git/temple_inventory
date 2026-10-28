<script setup lang="ts">
import { periodLabels, resolveSitePeriod, type DatePeriod } from "../../lib/sitePeriod";

const props = defineProps<{ modelValue: DatePeriod; label: string; today: string }>();
const emit = defineEmits<{ "update:modelValue": [value: DatePeriod] }>();
function update(value: DatePeriod) {
	emit("update:modelValue", value);
}
</script>

<template>
	<div class="period-editor">
		<label class="preview-field"
			>时间范围<select
				:value="modelValue.key"
				:aria-label="`${label}时间范围预设`"
				@change="
					update({
						...modelValue,
						key: ($event.target as HTMLSelectElement).value as DatePeriod['key'],
					})
				"
			>
				<optgroup label="相对">
					<option
						v-for="key in [
							'all',
							'today',
							'this_week',
							'this_month',
							'this_quarter',
							'last_quarter',
							'this_year',
							'last_7_days',
							'last_30_days',
							'last_90_days',
							'last_365_days',
						]"
						:key="key"
						:value="key"
					>
						{{ periodLabels[key as keyof typeof periodLabels] }}
					</option>
				</optgroup>
				<optgroup label="日历">
					<option
						v-for="key in ['q1', 'q2', 'q3', 'q4', 'last_year']"
						:key="key"
						:value="key"
					>
						{{ periodLabels[key as keyof typeof periodLabels] }}
					</option>
				</optgroup>
				<optgroup label="自定义"><option value="custom">自定义</option></optgroup>
			</select></label
		>
		<template v-if="modelValue.key === 'custom'">
			<label class="preview-field"
				>开始日期<input
					:value="modelValue.from"
					type="date"
					:aria-label="`${label}开始日期`"
					@input="
						update({ ...modelValue, from: ($event.target as HTMLInputElement).value })
					"
				/>
			</label>
			<label class="preview-field"
				>结束日期<input
					:value="modelValue.to"
					type="date"
					:aria-label="`${label}结束日期`"
					@input="
						update({ ...modelValue, to: ($event.target as HTMLInputElement).value })
					"
				/>
			</label>
			<small>包含开始和结束日期当天。</small>
		</template>
		<p v-else class="muted">
			{{
				modelValue.key === "all"
					? "不限日期"
					: `${resolveSitePeriod(modelValue, today).from} 至 ${resolveSitePeriod(modelValue, today).to}`
			}}
		</p>
	</div>
</template>
