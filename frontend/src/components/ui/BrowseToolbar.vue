<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useScrollSurface } from "../../composables/scrollSurface";
import UiButton from "./UiButton.vue";
const props = defineProps<{ summary: string; filterCount?: number; active?: boolean }>();
const emit = defineEmits<{ scan: []; filters: [] }>();
const root = ref<HTMLElement>(),
	full = ref<HTMLElement>(),
	compactRow = ref<HTMLElement>();
const automatic = ref(false),
	choice = ref<boolean>();
const compact = computed(() => choice.value ?? automatic.value);
const { top } = useScrollSurface(root, () => props.active !== false);
watch(top, (value) => {
	if (value > 160) automatic.value = true;
});
watch(compact, async (value) => {
	if (value && full.value?.contains(document.activeElement)) {
		await nextTick();
		compactRow.value?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
	}
});
async function reveal(target?: "search" | "filters") {
	choice.value = false;
	await nextTick();
	if (target === "search")
		full.value
			?.querySelector<HTMLElement>('input[type="search"], input')
			?.focus({ preventScroll: true });
	if (target === "filters") emit("filters");
}
</script>
<template>
	<div ref="root" class="preview-browse-controls refined-toolbar">
		<div v-if="compact" ref="compactRow" class="compact-action-row">
			<strong>{{ summary }}</strong>
			<div class="button-row">
				<UiButton @click="reveal('search')">搜索</UiButton
				><UiButton icon="scan" @click="emit('scan')">扫码</UiButton
				><UiButton @click="reveal('filters')"
					>筛选{{ filterCount ? `（${filterCount}）` : "" }}</UiButton
				><UiButton @click="reveal()">展开工具</UiButton>
			</div>
		</div>
		<div v-show="!compact" ref="full" class="expanded-browse-tools">
			<slot /><UiButton variant="ghost" @click="choice = true">收起工具</UiButton>
		</div>
	</div>
</template>
