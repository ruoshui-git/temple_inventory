<script setup lang="ts">
import {
	computed,
	inject,
	onBeforeUnmount,
	onDeactivated,
	onMounted,
	ref,
	useId,
	watch,
} from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { sitePeriodSummary, type DatePeriod } from "../../lib/sitePeriod";
import { filterPanelSessionKey } from "../../lib/filterPanelSession";
import Overlay from "./Overlay.vue";
import PeriodEditor from "./PeriodEditor.vue";
import UiButton from "./UiButton.vue";

const props = withDefaults(
	defineProps<{
		modelValue: DatePeriod;
		label: string;
		context?: string;
		fieldKey?: string;
		active?: boolean;
		embedded?: boolean;
		today: string;
	}>(),
	{ active: true, embedded: false },
);
const emit = defineEmits<{ "update:modelValue": [value: DatePeriod] }>();
const { isMobile } = useResponsiveLayout();
const trigger = ref<HTMLElement>();
const open = ref(false);
const draft = ref<DatePeriod>({ ...props.modelValue });
const error = ref("");
const owner = useId();
const formId = `period-${useId()}`;
const session = inject(filterPanelSessionKey, "");
function otherPanel(event: Event) {
	if ((event as CustomEvent).detail !== owner) open.value = false;
}
function filterPanelClosed(event: Event) {
	if (!props.embedded || !session || (event as CustomEvent).detail !== session) return;
	draft.value = { ...props.modelValue };
	error.value = "";
}
onMounted(() => {
	document.addEventListener("preview-filter-panel-open", otherPanel);
	document.addEventListener("preview-filter-panel-close", filterPanelClosed);
});
onBeforeUnmount(() => {
	document.removeEventListener("preview-filter-panel-open", otherPanel);
	document.removeEventListener("preview-filter-panel-close", filterPanelClosed);
});
watch(
	() => [props.modelValue, isMobile.value, props.context, props.active],
	() => {
		if (!open.value) draft.value = { ...props.modelValue };
		open.value = false;
	},
	{ flush: "sync" },
);
watch(
	() => props.modelValue,
	(value) => {
		if (props.embedded && !open.value) draft.value = { ...value };
	},
	{ immediate: true },
);
onDeactivated(() => {
	open.value = false;
});
const position = ref<Record<string, string>>({});
const summary = computed(() => sitePeriodSummary(props.modelValue, props.today));
function show() {
	document.dispatchEvent(new CustomEvent("preview-filter-panel-open", { detail: owner }));
	draft.value = { ...props.modelValue };
	error.value = "";
	const rect = trigger.value?.getBoundingClientRect();
	position.value = rect
		? {
				position: "fixed",
				top: `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 440))}px`,
				left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 408))}px`,
				width: "400px",
				maxHeight: "calc(100dvh - 16px)",
				margin: "0",
			}
		: {};
	open.value = true;
}
function apply() {
	if (draft.value.key === "custom" && (!draft.value.from || !draft.value.to)) {
		error.value = "请填写开始日期和结束日期。";
		return;
	}
	if (draft.value.key === "custom" && draft.value.from > draft.value.to) {
		error.value = "结束日期不能早于开始日期。";
		return;
	}
	emit("update:modelValue", { ...draft.value });
	if (!props.embedded) open.value = false;
}
function cancel() {
	draft.value = { ...props.modelValue };
	error.value = "";
	open.value = false;
}
</script>

<template>
	<div
		v-if="embedded"
		class="period-filter-embedded"
		:data-filter-field="fieldKey || 'period'"
		tabindex="-1"
	>
		<h3 class="period-filter-heading">{{ label }}</h3>
		<form :id="`${formId}-embedded`" @submit.prevent="apply">
			<PeriodEditor v-model="draft" :label="label" :today="today" />
			<p v-if="error" role="alert">{{ error }}</p>
		</form>
		<div class="period-filter-actions">
			<UiButton @click="cancel">撤销日期</UiButton>
			<UiButton variant="primary" type="submit" :form="`${formId}-embedded`"
				>应用日期</UiButton
			>
		</div>
	</div>
	<template v-else>
		<button
			ref="trigger"
			class="preview-period-trigger"
			:aria-label="`${label}：${summary}`"
			aria-haspopup="dialog"
			:aria-expanded="open"
			@click="show"
		>
			<span>{{ label }}</span
			><strong>{{ summary }}</strong
			><span aria-hidden="true">▾</span>
		</button>
		<Overlay
			v-if="open"
			:title="label"
			:transient-owner="owner"
			:drawer="isMobile"
			:panel-style="
				isMobile
					? {
							position: 'fixed',
							bottom: '0',
							left: '0',
							width: '100%',
							maxHeight: '85dvh',
							margin: '0',
						}
					: position
			"
			@close="cancel"
		>
			<form :id="`${formId}-range`" @submit.prevent="apply">
				<PeriodEditor v-model="draft" :label="label" :today="today" />
				<p v-if="error" role="alert">{{ error }}</p>
			</form>
			<template #footer>
				<UiButton @click="cancel">取消</UiButton>
				<UiButton variant="primary" :form="`${formId}-range`" type="submit">应用</UiButton>
			</template>
		</Overlay>
	</template>
</template>
