<script setup lang="ts">
import { computed, ref } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import PreviewIconButton from "./PreviewIconButton.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import { usePreviewScroll, previewScrollOwner } from "../scroll";
const props = withDefaults(
	defineProps<{ active?: boolean; hidden?: boolean; heading?: HTMLElement }>(),
	{ active: true, hidden: false },
);
const root = ref<HTMLElement>();
const { isMobile } = useResponsiveLayout();
const { top, viewport } = usePreviewScroll(root, () => props.active);
const visible = computed(
	() => props.active && !props.hidden && viewport.value > 0 && top.value > viewport.value * 2,
);
function returnToTop() {
	const heading =
		props.heading ||
		root.value?.closest("section, .inventory-example")?.querySelector<HTMLElement>("h1");
	if (!heading) return;
	const owner = previewScrollOwner(heading);
	const origin = heading.closest<HTMLElement>(".inventory-example") || heading;
	const rect = origin.getBoundingClientRect();
	const edge = owner === window ? 0 : (owner as HTMLElement).getBoundingClientRect().top;
	heading.setAttribute("tabindex", "-1");
	heading.focus({ preventScroll: true });
	owner.scrollBy({
		top: rect.top - edge - 12,
		behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
			? "instant"
			: "smooth",
	});
}
</script>
<template>
	<span ref="root">
		<PreviewIconButton
			v-if="visible"
			class="preview-return-top"
			label="返回顶部"
			:title="isMobile ? '' : '返回顶部'"
			@click="returnToTop"
		>
			<InventoryIcon name="chevron-down" />
		</PreviewIconButton>
	</span>
</template>
