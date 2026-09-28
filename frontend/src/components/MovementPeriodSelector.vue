<script setup lang="ts">
import { computed } from "vue";

export type MovementPeriodKey =
	| "today"
	| "last_7_days"
	| "last_30_days"
	| "last_365_days"
	| "this_week"
	| "this_month"
	| "this_year"
	| "custom";

const props = withDefaults(
	defineProps<{
		periodKey: MovementPeriodKey;
		dateFrom?: string;
		dateTo?: string;
		resolvedFrom?: string;
		resolvedTo?: string;
		showResolved?: boolean;
	}>(),
	{ dateFrom: "", dateTo: "", resolvedFrom: "", resolvedTo: "", showResolved: true },
);
const emit = defineEmits<{
	"update:periodKey": [value: MovementPeriodKey];
	"update:dateFrom": [value: string];
	"update:dateTo": [value: string];
}>();

type Mode = "rolling" | "natural" | "custom";
const rolling = [
	{ key: "today", label: "今日" },
	{ key: "last_7_days", label: "近7天" },
	{ key: "last_30_days", label: "近30天" },
	{ key: "last_365_days", label: "近365天" },
] as const;
const natural = [
	{ key: "today", label: "今日" },
	{ key: "this_week", label: "本周" },
	{ key: "this_month", label: "本月" },
	{ key: "this_year", label: "本年" },
] as const;
const mode = computed<Mode>(() =>
	props.periodKey === "custom"
		? "custom"
		: props.periodKey.startsWith("this_")
			? "natural"
			: "rolling",
);
const choices = computed(() => (mode.value === "natural" ? natural : rolling));
const resolvedText = computed(() =>
	props.resolvedFrom && props.resolvedTo
		? `${props.resolvedFrom} 至 ${props.resolvedTo}`
		: "正在解析日期范围…",
);

function setMode(value: Mode) {
	if (value === "custom") {
		if (!props.dateFrom && props.resolvedFrom) emit("update:dateFrom", props.resolvedFrom);
		if (!props.dateTo && props.resolvedTo) emit("update:dateTo", props.resolvedTo);
		emit("update:periodKey", "custom");
	} else if (value === "natural") emit("update:periodKey", "this_month");
	else emit("update:periodKey", "last_30_days");
}
</script>

<template>
	<section class="movement-period" aria-label="货物流动时间范围">
		<div class="period-mode" role="group" aria-label="时间范围方式">
			<button
				v-for="choice in [
					{ key: 'rolling', label: '滚动' },
					{ key: 'natural', label: '本期' },
					{ key: 'custom', label: '自定义' },
				]"
				:key="choice.key"
				type="button"
				:aria-pressed="mode === choice.key"
				@click="setMode(choice.key as Mode)"
			>
				{{ choice.label }}
			</button>
		</div>
		<div v-if="mode !== 'custom'" class="period-choices" role="group" aria-label="时间范围">
			<button
				v-for="choice in choices"
				:key="choice.key"
				type="button"
				:aria-pressed="periodKey === choice.key"
				@click="emit('update:periodKey', choice.key)"
			>
				{{ choice.label }}
			</button>
		</div>
		<div v-else class="custom-period">
			<label
				>开始日期<input
					type="date"
					:value="dateFrom"
					@input="emit('update:dateFrom', ($event.target as HTMLInputElement).value)"
			/></label>
			<label
				>结束日期<input
					type="date"
					:value="dateTo"
					@input="emit('update:dateTo', ($event.target as HTMLInputElement).value)"
			/></label>
		</div>
		<small v-if="showResolved" class="resolved-period" aria-live="polite">{{
			resolvedText
		}}</small>
	</section>
</template>

<style scoped>
.movement-period {
	display: grid;
	gap: 8px;
	padding: 10px 0;
}
.period-mode,
.period-choices {
	display: flex;
	gap: 6px;
	overflow-x: auto;
	padding-bottom: 2px;
}
.period-mode button,
.period-choices button {
	flex: none;
	min-height: 38px;
	padding: 7px 11px;
}
button[aria-pressed="true"] {
	border-color: #9b571d;
	background: #9b571d;
	color: #fff;
}
.custom-period {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 220px));
	gap: 8px;
}
.custom-period input {
	margin: 4px 0 0;
}
.resolved-period {
	color: #6b6257;
}
@media (max-width: 600px) {
	.custom-period {
		grid-template-columns: 1fr 1fr;
	}
}
</style>
