<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
const props = withDefaults(
	defineProps<{ keys: string[]; estimate?: number; threshold?: number }>(),
	{
		estimate: 120,
		threshold: 100,
	},
);
const viewport = ref<HTMLElement>();
// Retain the last focused row through pointer focus transfer and detail-return.
// Clearing on focusout can unmount the clicked button before its click fires.
const top = ref(0),
	height = ref(480),
	revision = ref(0),
	pinned = ref(-1);
const measured = new Map<string, number>();
const enabled = computed(() => props.keys.length > props.threshold);
const offsets = computed(() => {
	void revision.value;
	const result = [0];
	props.keys.forEach((key) =>
		result.push(result.at(-1)! + (measured.get(key) ?? props.estimate)),
	);
	return result;
});
const anchor = () =>
	Math.max(
		0,
		offsets.value.findIndex(
			(offset, index) => offset <= top.value && offsets.value[index + 1]! > top.value,
		),
	);
const indices = computed(() => {
	if (!enabled.value) return props.keys.map((_, index) => index);
	const first = Math.max(0, anchor() - 4);
	let last = first;
	while (last < props.keys.length && offsets.value[last]! < top.value + height.value) last++;
	const rows = Array.from(
		{ length: Math.min(props.keys.length, last + 5) - first },
		(_, index) => first + index,
	);
	if (pinned.value >= 0 && pinned.value < props.keys.length && !rows.includes(pinned.value))
		rows.push(pinned.value);
	return rows.sort((a, b) => a - b);
});
let observer: ResizeObserver | undefined;
let lastWidth = 0;
const observed = new Set<HTMLElement>();
function measure() {
	for (const row of observed)
		if (!row.isConnected) {
			observer?.unobserve(row);
			observed.delete(row);
		}
	const index = anchor();
	const before = offsets.value[index] || 0;
	let changed = false;
	viewport.value?.querySelectorAll<HTMLElement>("[data-virtual-index]").forEach((row) => {
		const key = props.keys[Number(row.dataset.virtualIndex)];
		const size = row.getBoundingClientRect().height;
		if (key && size > 0 && measured.get(key) !== size) {
			measured.set(key, size);
			changed = true;
		}
		if (!observed.has(row)) {
			observer?.observe(row);
			observed.add(row);
		}
	});
	if (changed) {
		revision.value++;
		if (viewport.value && enabled.value)
			viewport.value.scrollTop += (offsets.value[index] || 0) - before;
	}
}
onMounted(() => {
	if (typeof ResizeObserver !== "undefined") {
		observer = new ResizeObserver((entries) => {
			const entry = entries.find((entry) => entry.target === viewport.value);
			if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
				height.value = entry.contentRect.height;
				if (lastWidth && lastWidth !== entry.contentRect.width) {
					const index = anchor();
					const withinRow = top.value - (offsets.value[index] || 0);
					measured.clear();
					revision.value++;
					if (viewport.value) {
						viewport.value.scrollTop = (offsets.value[index] || 0) + withinRow;
						top.value = viewport.value.scrollTop;
					}
				}
				lastWidth = entry.contentRect.width;
			}
			measure();
		});
		if (viewport.value) observer.observe(viewport.value);
	}
	measure();
});
onBeforeUnmount(() => observer?.disconnect());
watch(indices, () => nextTick(measure));
watch(
	() => [...props.keys],
	(keys, previous) => {
		if (previous && previous.every((key, index) => keys[index] === key)) return;
		top.value = 0;
		pinned.value = -1;
		if (viewport.value) viewport.value.scrollTop = 0;
	},
);
async function scrollToIndex(index: number, focus = false) {
	if (!viewport.value) return;
	const offset = offsets.value[index] || 0;
	if (
		offset < viewport.value.scrollTop ||
		offset + (measured.get(props.keys[index]!) || props.estimate) >
			viewport.value.scrollTop + height.value
	)
		viewport.value.scrollTop = offset;
	top.value = viewport.value.scrollTop;
	await nextTick();
	const row = viewport.value.querySelector<HTMLElement>(`[data-virtual-index="${index}"]`);
	if (focus)
		row?.querySelector<HTMLElement>('input,button,[tabindex="0"]')?.focus({
			preventScroll: true,
		});
}
function key(event: KeyboardEvent) {
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
	const row = (event.target as HTMLElement).closest<HTMLElement>("[data-virtual-index]");
	if (!row) return;
	event.preventDefault();
	const index = Number(row.dataset.virtualIndex);
	const target =
		event.key === "Home"
			? 0
			: event.key === "End"
				? props.keys.length - 1
				: Math.max(
						0,
						Math.min(
							props.keys.length - 1,
							index + (event.key === "ArrowDown" ? 1 : -1),
						),
					);
	scrollToIndex(target, true);
}
defineExpose({ scrollToIndex });
</script>
<template>
	<div
		ref="viewport"
		class="preview-virtual-list"
		:class="{ 'is-virtual': enabled }"
		:data-total="keys.length"
		@scroll="top = ($event.target as HTMLElement).scrollTop"
		@keydown="key"
		@focusin="
			pinned = Number(
				($event.target as HTMLElement).closest<HTMLElement>('[data-virtual-index]')
					?.dataset.virtualIndex ?? -1,
			)
		"
	>
		<div
			:style="enabled ? { height: offsets.at(-1) + 'px', position: 'relative' } : undefined"
		>
			<div
				v-for="index in indices"
				:key="keys[index]"
				:data-virtual-index="index"
				:style="
					enabled
						? { position: 'absolute', top: offsets[index] + 'px', width: '100%' }
						: undefined
				"
			>
				<slot :index="index" />
			</div>
		</div>
	</div>
</template>
<style scoped>
.preview-virtual-list {
	min-width: 0;
	overflow-anchor: none;
}
.is-virtual {
	height: min(480px, 55dvh);
	overflow: auto;
}
</style>
