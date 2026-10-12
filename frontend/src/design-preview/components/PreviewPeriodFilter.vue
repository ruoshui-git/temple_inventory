<script setup lang="ts">
import { computed, ref, onDeactivated } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import PreviewOverlay from "../PreviewOverlay.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
import { periodLabels, resolvePeriod, type PreviewPeriod } from "../browseModel";
const props = defineProps<{ modelValue: PreviewPeriod; label: string }>();
const emit = defineEmits<{ "update:modelValue": [value: PreviewPeriod] }>();
const { isMobile } = useResponsiveLayout();
const trigger = ref<HTMLElement>();
const open = ref(false);
const draft = ref<PreviewPeriod>({ key: "all", from: "", to: "" });
const error = ref("");
onDeactivated(() => {
	open.value = false;
});
const position = ref<Record<string, string>>({});
const summary = computed(() => {
	const range = resolvePeriod(props.modelValue);
	return props.modelValue.key === "all"
		? "全部时间"
		: `${periodLabels[props.modelValue.key]} · ${range.from} 至 ${range.to}`;
});
function show() {
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
	open.value = false;
}
</script>
<template>
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
	<PreviewOverlay
		v-if="open"
		:title="label"
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
		@close="open = false"
	>
		<form :id="`${label}-range`" class="preview-filter-fields" @submit.prevent="apply">
			<label
				>时间范围<select v-model="draft.key" aria-label="时间范围预设">
					<option v-for="(label, key) in periodLabels" :key="key" :value="key">
						{{ label }}
					</option>
				</select></label
			>
			<template v-if="draft.key === 'custom'"
				><label
					>开始日期<input
						v-model="draft.from"
						type="date"
						aria-label="开始日期" /></label
				><label
					>结束日期<input v-model="draft.to" type="date" aria-label="结束日期" /></label
				><small>包含开始和结束日期当天。</small></template
			>
			<p v-else class="muted">
				{{
					draft.key === "all"
						? "不限日期"
						: `${resolvePeriod(draft).from} 至 ${resolvePeriod(draft).to}`
				}}
			</p>
			<p v-if="error" role="alert">{{ error }}</p>
		</form>
		<template #footer
			><PreviewUiButton @click="open = false">取消</PreviewUiButton
			><PreviewUiButton variant="primary" :form="`${label}-range`" type="submit"
				>应用</PreviewUiButton
			></template
		>
	</PreviewOverlay>
</template>
