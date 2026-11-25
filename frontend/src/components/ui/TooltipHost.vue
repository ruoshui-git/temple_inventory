<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { placeInVisualViewport } from "../../composables/useAnchoredPopup";
import {
	activeTooltip,
	dismissTooltip,
	dismissIfTooltipIsUnusable,
	listenForTooltips,
	tooltipId,
} from "../../lib/tooltip";

const host = ref<HTMLElement>();
const content = computed(() => activeTooltip.value?.value);
const location = computed(() =>
	content.value && typeof content.value === "object" && "location" in content.value
		? content.value.location
		: undefined,
);
const text = computed(() =>
	typeof content.value === "string"
		? content.value
		: content.value && "text" in content.value
			? content.value.text
			: "",
);

function position() {
	const element = host.value;
	const anchor = activeTooltip.value?.anchor;
	if (!element || !anchor) return;
	const rect = anchor.getBoundingClientRect();
	const visual = window.visualViewport;
	const viewport =
		visual && visual.width > 0 && visual.height > 0
			? visual
			: {
					offsetTop: 0,
					offsetLeft: 0,
					width: window.innerWidth,
					height: window.innerHeight,
				};
	if (
		rect.bottom < viewport.offsetTop ||
		rect.top > viewport.offsetTop + viewport.height ||
		rect.right < viewport.offsetLeft ||
		rect.left > viewport.offsetLeft + viewport.width
	) {
		dismissTooltip();
		return;
	}
	element.style.maxWidth = `${Math.max(0, Math.min(290, viewport.width - 16))}px`;
	element.style.maxHeight = "";
	const popup = element.getBoundingClientRect();
	const placement = placeInVisualViewport({
		anchor: rect,
		viewport,
		popupWidth: popup.width,
		naturalHeight: popup.height,
		minimumHeight: popup.height,
		margin: 8,
		gap: 6,
		align: "start",
	});
	element.style.top = `${placement.top}px`;
	element.style.left = `${placement.left}px`;
	element.style.maxHeight = `${placement.maxHeight}px`;
}

function resize() {
	dismissIfTooltipIsUnusable();
	position();
}

watch(activeTooltip, position, { flush: "post" });
let stopListening: (() => void) | undefined;
onMounted(() => {
	stopListening = listenForTooltips();
	window.addEventListener("resize", resize);
	window.visualViewport?.addEventListener("resize", resize);
});
onBeforeUnmount(() => {
	stopListening?.();
	window.removeEventListener("resize", resize);
	window.visualViewport?.removeEventListener("resize", resize);
});
</script>

<template>
	<!-- A body sibling stays outside inert app content and modal focus traps. -->
	<Teleport to="body">
		<div
			v-show="activeTooltip"
			:id="tooltipId"
			ref="host"
			role="tooltip"
			tabindex="-1"
			class="inventory-tooltip"
		>
			<template v-if="location">
				<div class="inventory-tooltip-path">{{ location.path }}</div>
				<div class="inventory-tooltip-levels">
					<div
						v-for="(level, index) in location.levels"
						:key="index"
						class="inventory-tooltip-level"
					>
						<span class="inventory-tooltip-code">{{ level.code }}</span>
						<span>{{ level.name }}</span>
					</div>
				</div>
			</template>
			<template v-else>{{ text }}</template>
		</div>
	</Teleport>
</template>
