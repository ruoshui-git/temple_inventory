<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { periodLabels, resolveSitePeriod, type DatePeriod } from "../../lib/sitePeriod";
import UiButton from "./UiButton.vue";

const props = defineProps<{ modelValue: DatePeriod; label: string; today: string }>();
const emit = defineEmits<{ "update:modelValue": [value: DatePeriod] }>();
const shortcutYear = ref(Number(props.today.slice(0, 4)) || new Date().getFullYear());
const shortcutPeriod = ref("year");
function dateInYear(year: number, month: number, day: number) {
	const value = new Date(0);
	value.setUTCHours(0, 0, 0, 0);
	value.setUTCFullYear(year, month, day);
	return value.toISOString().slice(0, 10);
}
const calendarPreset = computed(() => {
	const value = props.modelValue;
	if (value.key !== "custom" || !value.from || !value.to) return "";
	const year = value.from.slice(0, 4);
	if (value.from === `${year}-01-01` && value.to === `${year}-12-31`) return `${year}-year`;
	for (let quarter = 1; quarter <= 4; quarter++) {
		const fromMonth = String((quarter - 1) * 3 + 1).padStart(2, "0");
		const toMonth = String(quarter * 3).padStart(2, "0");
		const lastDay = Number(dateInYear(Number(year), quarter * 3, 0).slice(-2));
		if (
			value.from === `${year}-${fromMonth}-01` &&
			value.to === `${year}-${toMonth}-${String(lastDay).padStart(2, "0")}`
		)
			return `${year}-Q${quarter}`;
	}
	return "";
});
watch(
	() => [props.modelValue.key, props.modelValue.from, props.modelValue.to] as const,
	([key, from]) => {
		if (key === "custom" && from) {
			const year = Number(from.slice(0, 4));
			if (year >= 1 && year <= 9999) shortcutYear.value = year;
		}
		const selected = calendarPreset.value.match(/-Q([1-4])$/);
		shortcutPeriod.value = selected?.[1] || "year";
	},
	{ immediate: true },
);
function update(value: DatePeriod) {
	emit("update:modelValue", value);
}
function applyCalendarPreset() {
	const year = Number(shortcutYear.value);
	if (!Number.isInteger(year) || year < 1 || year > 9999) return;
	const quarter = shortcutPeriod.value === "year" ? 0 : Number(shortcutPeriod.value);
	if (quarter < 0 || quarter > 4) return;
	const firstMonth = quarter ? (quarter - 1) * 3 : 0;
	const afterMonth = quarter ? firstMonth + 3 : 12;
	update({
		key: "custom",
		from: dateInYear(year, firstMonth, 1),
		to: dateInYear(year, afterMonth, 0),
	});
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
				<option v-for="(optionLabel, key) in periodLabels" :key="key" :value="key">
					{{ optionLabel }}
				</option>
			</select></label
		>
		<div class="period-calendar-shortcut">
			<label class="preview-field"
				>快捷年份<input
					v-model.number="shortcutYear"
					:aria-label="`${label}快捷年份`"
					type="number"
					min="1"
					max="9999"
					step="1"
				/>
			</label>
			<label class="preview-field"
				>快捷范围<select v-model="shortcutPeriod" :aria-label="`${label}快捷年份范围`">
					<option value="year">全年</option>
					<option
						v-for="quarter in [1, 2, 3, 4]"
						:key="quarter"
						:value="String(quarter)"
					>
						第 {{ quarter }} 季度
					</option>
				</select></label
			>
			<UiButton type="button" @click="applyCalendarPreset">使用范围</UiButton>
			<small v-if="calendarPreset">已选快捷范围：{{ calendarPreset }}</small>
		</div>
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
