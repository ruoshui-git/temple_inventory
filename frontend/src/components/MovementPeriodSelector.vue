<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
export type MovementPeriodKey =
	| "today"
	| "last_7_days"
	| "last_30_days"
	| "last_90_days"
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
		variant?: "legacy" | "ledger";
	}>(),
	{
		dateFrom: "",
		dateTo: "",
		resolvedFrom: "",
		resolvedTo: "",
		showResolved: true,
		variant: "legacy",
	},
);
const emit = defineEmits<{
	"update:periodKey": [value: MovementPeriodKey];
	"update:dateFrom": [value: string];
	"update:dateTo": [value: string];
}>();
const more = ref<HTMLElement>();
const moreTrigger = ref<HTMLElement>();
const portalMenu = ref<HTMLElement>();
const moreOpen = ref(false);
const menuStyle = ref<Record<string, string>>({});
const rolling = [
	{ key: "last_7_days", label: "近7天" },
	{ key: "last_30_days", label: "近30天" },
	{ key: "last_90_days", label: "近90天" },
	{ key: "last_365_days", label: "近365天" },
] as const;
const natural = [
	{ key: "this_week", label: "本周" },
	{ key: "this_month", label: "本月" },
	{ key: "this_year", label: "本年" },
] as const;
const mode = computed(() =>
	props.periodKey === "custom"
		? "custom"
		: props.periodKey.startsWith("this_")
			? "natural"
			: "rolling",
);
const legacyChoices = computed(() =>
	mode.value === "natural" ? natural : [{ key: "today", label: "今日" }, ...rolling],
);
const resolvedText = computed(() =>
	props.resolvedFrom && props.resolvedTo
		? `${props.resolvedFrom} 至 ${props.resolvedTo}`
		: "正在解析日期范围…",
);
function setCustom() {
	if (!props.dateFrom && props.resolvedFrom) emit("update:dateFrom", props.resolvedFrom);
	if (!props.dateTo && props.resolvedTo) emit("update:dateTo", props.resolvedTo);
	emit("update:periodKey", "custom");
}
function setLegacyMode(value: "rolling" | "natural" | "custom") {
	if (value === "custom") return setCustom();
	emit("update:periodKey", value === "natural" ? "this_month" : "last_30_days");
}
function selectRolling(key: MovementPeriodKey) {
	emit("update:periodKey", key);
	closeMore(true);
}
function positionMenu() {
	if (!moreOpen.value || !moreTrigger.value) return;
	const rect = moreTrigger.value.getBoundingClientRect();
	const width = 150;
	const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
	menuStyle.value = {
		top: `${Math.round(rect.bottom + 6)}px`,
		left: `${Math.round(left)}px`,
		minWidth: `${width}px`,
	};
}
function closeMore(restoreFocus = false) {
	moreOpen.value = false;
	if (restoreFocus) {
		moreTrigger.value?.focus();
		void nextTick(() => moreTrigger.value?.focus());
	}
}
function toggleMore() {
	moreOpen.value = !moreOpen.value;
	if (moreOpen.value)
		void nextTick(() => {
			positionMenu();
			portalMenu.value?.querySelector<HTMLButtonElement>("button")?.focus();
		});
}
function onDocumentPointer(event: PointerEvent) {
	if (!moreOpen.value || !(event.target instanceof Node)) return;
	if (event.target instanceof Element && event.target.closest("#movement-period-more-menu"))
		return;
	if (more.value?.contains(event.target) || portalMenu.value?.contains(event.target)) return;
	closeMore();
}
function onFocusout(event: FocusEvent) {
	if (!moreOpen.value) return;
	if (!(event.relatedTarget instanceof Node)) {
		closeMore();
		return;
	}
	if (
		more.value?.contains(event.relatedTarget) ||
		portalMenu.value?.contains(event.relatedTarget)
	)
		return;
	closeMore();
}
function onKeydown(event: KeyboardEvent) {
	if (moreOpen.value && event.key === "Escape") {
		event.preventDefault();
		closeMore(true);
	}
}
onMounted(() => {
	document.addEventListener("pointerdown", onDocumentPointer);
	document.addEventListener("click", onDocumentPointer as unknown as EventListener);
	document.addEventListener("keydown", onKeydown);
	window.addEventListener("scroll", positionMenu, true);
	window.addEventListener("resize", positionMenu);
});
onBeforeUnmount(() => {
	document.removeEventListener("pointerdown", onDocumentPointer);
	document.removeEventListener("click", onDocumentPointer as unknown as EventListener);
	document.removeEventListener("keydown", onKeydown);
	window.removeEventListener("scroll", positionMenu, true);
	window.removeEventListener("resize", positionMenu);
});
</script>
<template>
	<section
		class="movement-period"
		:class="{ 'movement-period-ledger': variant === 'ledger' }"
		aria-label="货物流动时间范围"
		@focusout="onFocusout"
	>
		<div
			v-if="variant === 'legacy'"
			class="period-mode"
			role="group"
			aria-label="时间范围方式"
		>
			<button
				type="button"
				:aria-pressed="mode === 'rolling'"
				@click="setLegacyMode('rolling')"
			>
				滚动</button
			><button
				type="button"
				:aria-pressed="mode === 'natural'"
				@click="setLegacyMode('natural')"
			>
				本期</button
			><button
				type="button"
				:aria-pressed="mode === 'custom'"
				@click="setLegacyMode('custom')"
			>
				自定义
			</button>
		</div>
		<div
			v-if="variant === 'legacy' && mode !== 'custom'"
			class="period-choices"
			role="group"
			aria-label="时间范围"
		>
			<button
				v-for="choice in legacyChoices"
				:key="choice.key"
				type="button"
				:aria-pressed="periodKey === choice.key"
				@click="emit('update:periodKey', choice.key as MovementPeriodKey)"
			>
				{{ choice.label }}
			</button>
		</div>
		<div
			v-else-if="variant === 'ledger'"
			class="period-choices"
			role="group"
			aria-label="时间范围"
		>
			<button
				v-for="choice in natural"
				:key="choice.key"
				type="button"
				:aria-pressed="periodKey === choice.key"
				@click="emit('update:periodKey', choice.key)"
			>
				{{ choice.label }}</button
			><button type="button" :aria-pressed="periodKey === 'custom'" @click="setCustom">
				自定义
			</button>
			<details
				ref="more"
				class="period-more"
				:open="moreOpen"
				aria-haspopup="menu"
				:aria-expanded="moreOpen"
			>
				<summary
					ref="moreTrigger"
					tabindex="0"
					aria-controls="movement-period-more-menu"
					@click.prevent="toggleMore"
				>
					{{ rolling.find((choice) => choice.key === periodKey)?.label || "更多" }} ▾
				</summary>
			</details>
			<Teleport to="body">
				<div
					v-if="moreOpen"
					ref="portalMenu"
					id="movement-period-more-menu"
					class="period-more-menu-portal"
					role="menu"
					aria-label="滚动时间范围"
					:style="menuStyle"
				>
					<button
						v-for="choice in rolling"
						:key="choice.key"
						type="button"
						role="menuitemradio"
						:aria-checked="periodKey === choice.key"
						@click="selectRolling(choice.key)"
					>
						{{ choice.label }}
					</button>
				</div>
			</Teleport>
		</div>
		<div v-if="mode === 'custom'" class="custom-period">
			<label
				>开始日期<input
					type="date"
					:value="dateFrom"
					@input="
						emit('update:dateFrom', ($event.target as HTMLInputElement).value)
					" /></label
			><label
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
.movement-period-ledger {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	padding: 0;
}
.movement-period-ledger .period-choices {
	flex: none;
}
.movement-period-ledger .resolved-period {
	flex: none;
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
.movement-period-ledger .custom-period {
	flex-basis: 100%;
}
.custom-period input {
	margin: 4px 0 0;
}
.resolved-period {
	color: #6b6257;
}
.period-more {
	flex: none;
	position: relative;
}
.period-more summary {
	padding: 8px 11px;
	cursor: pointer;
}
.period-more-menu-portal {
	position: fixed;
	z-index: 120;
	display: grid;
	gap: 4px;
	padding: 5px;
	background: #fffaf2;
	border: 1px solid #eadfce;
	box-shadow: 0 8px 24px rgba(65, 44, 22, 0.18);
}
.period-more-menu-portal button {
	min-height: 34px;
	padding: 7px 10px;
	border: 0;
	background: transparent;
	text-align: left;
}
.period-more-menu-portal button:hover,
.period-more-menu-portal button[aria-checked="true"] {
	background: #fff0d9;
}
.period-active-rolling {
	border-color: #9b571d;
	background: #9b571d;
	color: #fff;
}
@media (max-width: 600px) {
	.custom-period {
		grid-template-columns: 1fr 1fr;
	}
}
</style>
