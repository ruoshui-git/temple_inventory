<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import InventoryIcon from "./InventoryIcon.vue";
export type MovementPeriodKey =
	| "all"
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
		compact?: boolean;
		ariaLabel?: string;
	}>(),
	{
		dateFrom: "",
		dateTo: "",
		resolvedFrom: "",
		resolvedTo: "",
		showResolved: true,
		variant: "legacy",
		compact: false,
		ariaLabel: "货物流动时间范围",
	},
);
const emit = defineEmits<{
	"update:periodKey": [value: MovementPeriodKey];
	"update:dateFrom": [value: string];
	"update:dateTo": [value: string];
}>();
const controlRoot = ref<HTMLElement>();
const moreTrigger = ref<HTMLElement>();
const portalMenu = ref<HTMLElement>();
const customTrigger = ref<HTMLElement>();
const customMenu = ref<HTMLElement>();
const moreOpen = ref(false);
const customOpen = ref(false);
const menuStyle = ref<Record<string, string>>({});
const customMenuStyle = ref<Record<string, string>>({});
const controlId = `movement-period-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
const moreMenuId = `${controlId}-more-menu`;
const customMenuId = `${controlId}-custom-menu`;
const rolling = [
	{ key: "last_7_days", label: "近7天" },
	{ key: "last_30_days", label: "近30天" },
	{ key: "last_90_days", label: "近90天" },
	{ key: "last_365_days", label: "近365天" },
] as const;
const allChoice = { key: "all", label: "全部时间" } as const;
const natural = [
	{ key: "this_week", label: "本周" },
	{ key: "this_month", label: "本月" },
	{ key: "this_year", label: "本年" },
] as const;
const mode = computed(() =>
	props.periodKey === "all"
		? "rolling"
		: props.periodKey === "custom"
			? "custom"
			: props.periodKey.startsWith("this_")
				? "natural"
				: "rolling",
);
const legacyChoices = computed(() =>
	mode.value === "natural"
		? [...natural, allChoice]
		: [{ key: "today", label: "今日" }, ...rolling, allChoice],
);
const resolvedText = computed(() =>
	props.periodKey === "all"
		? "全部时间"
		: props.resolvedFrom && props.resolvedTo
			? `${props.resolvedFrom} 至 ${props.resolvedTo}`
			: "正在解析日期范围…",
);
const selectedLabel = computed(
	() =>
		[allChoice, ...natural, ...rolling].find((choice) => choice.key === props.periodKey)
			?.label || (props.periodKey === "custom" ? "自定义" : "时间范围"),
);
function setCustom() {
	if (!props.dateFrom && props.resolvedFrom) emit("update:dateFrom", props.resolvedFrom);
	if (!props.dateTo && props.resolvedTo) emit("update:dateTo", props.resolvedTo);
	emit("update:periodKey", "custom");
}
function positionCustomMenu() {
	if (!customOpen.value || !customTrigger.value) return;
	const rect = customTrigger.value.getBoundingClientRect();
	const width = Math.min(320, Math.max(280, window.innerWidth - 16));
	const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
	customMenuStyle.value = {
		top: `${Math.round(rect.bottom + 6)}px`,
		left: `${Math.round(left)}px`,
		minWidth: `${width}px`,
	};
}
function closeCustom(restoreFocus = false) {
	customOpen.value = false;
	if (restoreFocus) {
		customTrigger.value?.focus();
		void nextTick(() => customTrigger.value?.focus());
	}
}
function openCustom() {
	setCustom();
	customOpen.value = true;
	void nextTick(() => {
		positionCustomMenu();
		customMenu.value?.querySelector<HTMLInputElement>("input")?.focus();
	});
}
function toggleCustom() {
	if (customOpen.value) closeCustom(true);
	else openCustom();
}
function setLegacyMode(value: "rolling" | "natural" | "custom") {
	if (value === "custom") return openCustom();
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
	if (!(event.target instanceof Node)) return;
	if (moreOpen.value) {
		if (controlRoot.value?.contains(event.target) || portalMenu.value?.contains(event.target))
			return;
		closeMore();
	}
	if (customOpen.value) {
		if (controlRoot.value?.contains(event.target) || customMenu.value?.contains(event.target))
			return;
		closeCustom();
	}
}
function onFocusout(event: FocusEvent) {
	if (!(event.relatedTarget instanceof Node)) {
		closeMore();
		closeCustom();
		return;
	}
	if (
		moreOpen.value &&
		!moreTrigger.value?.contains(event.relatedTarget) &&
		!portalMenu.value?.contains(event.relatedTarget)
	)
		closeMore();
	if (
		customOpen.value &&
		!customTrigger.value?.contains(event.relatedTarget) &&
		!customMenu.value?.contains(event.relatedTarget)
	)
		closeCustom();
}
function onKeydown(event: KeyboardEvent) {
	if (moreOpen.value && event.key === "Escape") {
		event.preventDefault();
		closeMore(true);
	}
	if (customOpen.value && event.key === "Escape") {
		event.preventDefault();
		closeCustom(true);
	}
}
onMounted(() => {
	document.addEventListener("pointerdown", onDocumentPointer);
	document.addEventListener("click", onDocumentPointer as unknown as EventListener);
	document.addEventListener("keydown", onKeydown);
	window.addEventListener("scroll", positionMenu, true);
	window.addEventListener("resize", positionMenu);
	window.addEventListener("scroll", positionCustomMenu, true);
	window.addEventListener("resize", positionCustomMenu);
});
onBeforeUnmount(() => {
	document.removeEventListener("pointerdown", onDocumentPointer);
	document.removeEventListener("click", onDocumentPointer as unknown as EventListener);
	document.removeEventListener("keydown", onKeydown);
	window.removeEventListener("scroll", positionMenu, true);
	window.removeEventListener("resize", positionMenu);
	window.removeEventListener("scroll", positionCustomMenu, true);
	window.removeEventListener("resize", positionCustomMenu);
});
</script>
<template>
	<section
		ref="controlRoot"
		class="movement-period"
		:class="{ 'movement-period-ledger': variant === 'ledger' }"
		:aria-label="ariaLabel"
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
			v-else-if="variant === 'ledger' && !compact"
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
				{{ choice.label }}
			</button>
			<button
				type="button"
				:aria-pressed="periodKey === 'all'"
				@click="emit('update:periodKey', 'all')"
			>
				全部时间
			</button>
			<button type="button" :aria-pressed="periodKey === 'custom'" @click="openCustom">
				自定义
			</button>
			<button
				ref="moreTrigger"
				type="button"
				class="period-more-trigger"
				:class="{ active: rolling.some((choice) => choice.key === periodKey) }"
				aria-haspopup="menu"
				:aria-pressed="rolling.some((choice) => choice.key === periodKey)"
				:aria-expanded="moreOpen"
				:aria-controls="moreMenuId"
				@click="toggleMore"
			>
				{{ rolling.find((choice) => choice.key === periodKey)?.label || "更多" }}
				<InventoryIcon name="chevron-down" :class="{ expanded: moreOpen }" />
			</button>
			<Teleport to="body">
				<div
					v-if="moreOpen"
					ref="portalMenu"
					:id="moreMenuId"
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
		<div v-else-if="variant === 'ledger' && compact" class="period-compact">
			<button
				ref="moreTrigger"
				type="button"
				class="period-more-trigger"
				:class="{ active: rolling.some((choice) => choice.key === periodKey) }"
				aria-haspopup="menu"
				:aria-pressed="rolling.some((choice) => choice.key === periodKey)"
				:aria-expanded="moreOpen"
				:aria-controls="moreMenuId"
				@click="toggleMore"
			>
				{{ selectedLabel }}
				<InventoryIcon name="chevron-down" :class="{ expanded: moreOpen }" />
			</button>
			<button
				v-if="mode === 'custom'"
				ref="customTrigger"
				type="button"
				class="period-compact-resolved custom-period-trigger"
				:aria-controls="customMenuId"
				:aria-expanded="customOpen"
				:aria-label="`自定义日期：${resolvedText}`"
				@click="toggleCustom"
			>
				{{ resolvedText }}
			</button>
			<span v-else class="period-compact-resolved">{{ resolvedText }}</span>
			<Teleport to="body">
				<div
					v-if="moreOpen"
					ref="portalMenu"
					:id="moreMenuId"
					class="period-more-menu-portal period-compact-menu"
					role="menu"
					aria-label="时间范围"
					:style="menuStyle"
				>
					<button
						type="button"
						role="menuitemradio"
						:aria-checked="periodKey === 'all'"
						@click="selectRolling('all')"
					>
						全部时间
					</button>
					<strong>自然时间</strong>
					<button
						v-for="choice in natural"
						:key="choice.key"
						type="button"
						role="menuitemradio"
						:aria-checked="periodKey === choice.key"
						@click="selectRolling(choice.key)"
					>
						{{ choice.label }}
					</button>
					<strong>滚动时间</strong>
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
					<button
						type="button"
						role="menuitem"
						@click="
							openCustom();
							closeMore();
						"
					>
						自定义
					</button>
				</div>
			</Teleport>
		</div>
		<button
			v-if="showResolved && !(variant === 'ledger' && compact) && mode === 'custom'"
			ref="customTrigger"
			type="button"
			class="resolved-period custom-period-trigger"
			:aria-controls="customMenuId"
			:aria-expanded="customOpen"
			:aria-label="`自定义日期：${resolvedText}`"
			@click="toggleCustom"
		>
			{{ resolvedText }}
		</button>
		<small
			v-else-if="showResolved && !(variant === 'ledger' && compact)"
			class="resolved-period"
			aria-live="polite"
			>{{ resolvedText }}</small
		>
		<Teleport to="body">
			<div
				v-if="customOpen"
				:id="customMenuId"
				ref="customMenu"
				class="custom-period-menu-portal"
				role="dialog"
				aria-label="自定义日期"
				:style="customMenuStyle"
				@keydown.esc="closeCustom(true)"
			>
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
						@input="
							emit('update:dateTo', ($event.target as HTMLInputElement).value)
						" /></label
				><button type="button" class="custom-period-done" @click="closeCustom(true)">
					完成
				</button>
			</div>
		</Teleport>
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
	padding: 8px;
	border: 1px solid #e5dfd5;
	border-radius: 9px;
	background: #fffdf9;
}
.movement-period-ledger .period-choices {
	flex: 1 1 100%;
	min-width: 0;
	max-width: 100%;
	flex-wrap: wrap;
	overflow: visible;
}
.movement-period-ledger .resolved-period {
	flex: 1 1 auto;
	min-width: 0;
	max-width: 100%;
	overflow-wrap: anywhere;
	white-space: normal;
}
.period-compact {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 6px;
}
.period-compact .period-more-trigger {
	min-height: 40px;
	padding: 7px 8px;
	border: 1px solid #dfd4c4;
	border-radius: 6px;
	background: #fff;
	color: #5e4b36;
	font-weight: 650;
	white-space: nowrap;
}
.period-compact-resolved {
	overflow: hidden;
	color: #6b6257;
	font-size: 11px;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.period-compact-menu {
	grid-template-columns: 1fr;
	min-width: 180px;
	max-height: min(70dvh, 420px);
	overflow: auto;
}
.period-compact-menu strong {
	padding: 4px 10px;
	color: #7a6a58;
	font-size: 11px;
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
	min-height: 40px;
	padding: 7px 11px;
}
button[aria-pressed="true"] {
	border-color: #9b571d;
	background: #9b571d;
	color: #fff;
}
.resolved-period {
	color: #6b6257;
}
.custom-period-trigger {
	max-width: min(100%, 260px);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.period-more-trigger {
	flex: none;
	max-width: 100%;
	display: inline-flex;
	min-height: 40px;
	align-items: center;
	gap: 5px;
	padding: 7px 10px;
	border: 1px solid #dfd4c4;
	border-radius: 6px;
	background: #fff;
	color: #5e4b36;
	font-weight: 650;
	white-space: nowrap;
}
.period-more-trigger :deep(svg) {
	width: 15px;
	height: 15px;
	transition: transform 140ms ease;
}
.period-more-trigger :deep(svg.expanded) {
	transform: rotate(180deg);
}
.period-more-trigger.active {
	border-color: #c3986c;
	background: #fff4e7;
	color: #81532a;
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
	min-height: 40px;
	padding: 7px 10px;
	border: 0;
	background: transparent;
	text-align: left;
}
.period-more-menu-portal button:hover,
.period-more-menu-portal button[aria-checked="true"] {
	background: #fff0d9;
}
.custom-period-menu-portal {
	position: fixed;
	z-index: 120;
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
	padding: 10px;
	background: #fffaf2;
	border: 1px solid #eadfce;
	box-shadow: 0 8px 24px rgba(65, 44, 22, 0.18);
}
@media (max-width: 1023px) {
	.movement-period-ledger .period-choices button,
	.movement-period-ledger .period-more-trigger,
	.movement-period-ledger .period-compact-resolved {
		font-size: 14px;
	}
	.movement-period-ledger .period-choices button {
		white-space: normal;
	}
}
@media (prefers-reduced-motion: reduce) {
	.period-more-trigger :deep(svg) {
		transition: none;
	}
}
.custom-period-menu-portal label {
	display: grid;
	gap: 4px;
	color: #6b6257;
	font-size: 12px;
}
.custom-period-menu-portal input {
	min-width: 0;
	margin: 0;
}
.custom-period-done {
	grid-column: 1 / -1;
	min-height: 34px;
	padding: 7px 10px;
}
.period-active-rolling {
	border-color: #9b571d;
	background: #9b571d;
	color: #fff;
}
@media (max-width: 600px) {
	.custom-period-menu-portal {
		grid-template-columns: 1fr;
	}
	.custom-period-done {
		grid-column: auto;
	}
}
</style>
