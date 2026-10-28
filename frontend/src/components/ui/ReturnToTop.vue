<script setup lang="ts">
import { computed, ref } from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import IconButton from "./IconButton.vue";
import InventoryIcon from "../InventoryIcon.vue";
import { useScrollSurface, scrollOwner } from "../../composables/scrollSurface";
const props = withDefaults(defineProps<{ active?: boolean; hidden?: boolean }>(), {
	active: true,
	hidden: false,
});
const root = ref<HTMLElement>();
const { isMobile } = useResponsiveLayout();
const { top, viewport } = useScrollSurface(root, () => props.active);
const visible = computed(
	() => props.active && !props.hidden && viewport.value > 0 && top.value > 160,
);
function returnToTop() {
	const surface = root.value;
	if (!surface) return;
	const owner = scrollOwner(surface);
	const page = surface.closest<HTMLElement>(
		".browse-page, .dashboard, .inventory-surface, .inventory-example",
	);
	const heading =
		page?.querySelector<HTMLElement>("h1") ||
		surface.closest<HTMLElement>("main")?.querySelector<HTMLElement>("h1");
	if (heading) {
		heading.setAttribute("tabindex", "-1");
		heading.focus({ preventScroll: true });
	}
	const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
		? "instant"
		: "smooth";
	if (owner === window) window.scrollTo({ top: 0, behavior });
	else (owner as HTMLElement).scrollTo({ top: 0, behavior });
}
</script>
<template>
	<span ref="root">
		<IconButton
			v-if="visible"
			class="return-top"
			label="返回顶部"
			:title="isMobile ? '' : '返回顶部'"
			@click="returnToTop"
		>
			<InventoryIcon name="chevron-down" />
		</IconButton>
	</span>
</template>
