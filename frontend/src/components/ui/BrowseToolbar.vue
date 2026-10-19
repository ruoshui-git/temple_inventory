<script setup lang="ts">
import { computed, nextTick, ref, useId, watch, onDeactivated } from "vue";
import { scrollBy, useScrollSurface } from "../../composables/scrollSurface";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import PageHeader from "./PageHeader.vue";
import UiButton from "./UiButton.vue";
import FilterButton from "./FilterButton.vue";
import Overlay from "./Overlay.vue";
const props = withDefaults(
	defineProps<{
		title?: string;
		summary: string;
		filterCount?: number;
		filtersOpen?: boolean;
		active?: boolean;
		scannable?: boolean;
		search?: string;
		searchLabel?: string;
	}>(),
	{ active: true, search: "", searchLabel: "搜索" },
);
const emit = defineEmits<{
	scan: [];
	filters: [];
	"update:search": [value: string];
	"update:compact": [value: boolean];
}>();
const root = ref<HTMLElement>();
const automatic = ref(false),
	choice = ref<boolean>();
const compact = computed(() => choice.value ?? automatic.value);
const heading = computed(() => props.title || props.summary.split(" · ")[0]);
const searchOpen = ref(false);
const { isMobile } = useResponsiveLayout();
onDeactivated(() => {
	searchOpen.value = false;
});
const controlsId = useId();
const { top, owner } = useScrollSurface(root, () => props.active);
watch(top, (value) => {
	if (value > 160) automatic.value = true;
});
let transition = 0;
watch(compact, async (value) => {
	const generation = ++transition;
	const header = root.value;
	const focused = document.activeElement;
	const hiddenFocus =
		value &&
		!!focused &&
		!!header?.contains(focused) &&
		!(focused as HTMLElement).closest(".browse-tools-toggle");
	const bottom = header?.getBoundingClientRect().bottom || 0;
	const candidates = Array.from(
		header?.parentElement?.querySelectorAll<HTMLElement>("[data-browse-row]") || [],
	).filter(
		(row) => !header?.contains(row) && row.getBoundingClientRect().top < window.innerHeight,
	);
	const anchor =
		top.value > 0
			? candidates.find((row) => row.getBoundingClientRect().top >= bottom) ||
				candidates.find((row) => row.getBoundingClientRect().bottom > bottom)
			: undefined;
	const offset = anchor ? anchor.getBoundingClientRect().top - bottom : 0;
	emit("update:compact", value);
	await nextTick();
	if (generation !== transition || !header?.isConnected) return;
	if (anchor?.isConnected && owner.value) {
		const headerBottom = header.getBoundingClientRect().bottom;
		const navTop =
			document.querySelector(".sample-mobile-nav")?.getBoundingClientRect().top ??
			window.innerHeight;
		const viewportBottom = Math.min(window.innerHeight, navTop);
		const visibleOffset = Math.min(
			Math.max(0, offset),
			Math.max(0, viewportBottom - headerBottom - 44),
		);
		const delta = anchor.getBoundingClientRect().top - headerBottom - visibleOffset;
		if (Math.abs(delta) > 1) scrollBy(owner.value, delta);
	}
	if (hiddenFocus)
		header.querySelector<HTMLElement>(".browse-tools-toggle")?.focus({ preventScroll: true });
});
watch([() => props.active, isMobile], () => {
	searchOpen.value = false;
});
defineExpose({ compact });
</script>
<template>
	<div
		ref="root"
		class="preview-browse-controls refined-toolbar browse-chrome"
		:class="{ 'is-compact': compact }"
	>
		<PageHeader :title="heading" :compact="compact">
			<template #title-tools><slot name="persistent" /></template>
			<template #subtitle><slot v-if="!compact" name="subtitle" /></template>
			<template #actions>
				<template v-if="compact">
					<UiButton icon="search" @click="searchOpen = true">搜索</UiButton>
					<UiButton v-if="scannable" icon="scan" @click="emit('scan')">扫码</UiButton>
					<FilterButton
						:expanded="!!filtersOpen"
						:count="filterCount || 0"
						@click="emit('filters')"
					/>
				</template>
				<slot v-else name="actions" />
			</template>
			<template #trailing>
				<UiButton
					class="browse-tools-toggle"
					variant="ghost"
					icon="chevron-down"
					:aria-expanded="!compact"
					:aria-controls="controlsId"
					@click="choice = !compact"
				>
					{{ compact ? "展开工具" : "收起工具" }}
				</UiButton>
			</template>
		</PageHeader>
		<div v-show="!compact" :id="controlsId" class="expanded-browse-tools">
			<slot />
			<div v-if="$slots['result-tools']" class="browse-result-toolbar">
				<slot name="result-tools" />
			</div>
		</div>
		<slot name="selection" />
		<Overlay v-if="searchOpen" :title="searchLabel" @close="searchOpen = false">
			<label class="preview-field"
				>{{ searchLabel
				}}<input
					type="search"
					:value="search"
					@input="emit('update:search', ($event.target as HTMLInputElement).value)"
			/></label>
			<template #footer><UiButton @click="searchOpen = false">完成</UiButton></template>
		</Overlay>
	</div>
</template>
