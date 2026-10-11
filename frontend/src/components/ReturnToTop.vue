<script setup lang="ts">
import { ref, toRef } from "vue";
import InventoryIcon from "./InventoryIcon.vue";
import { useReturnToTop } from "../composables/useReturnToTop";

const props = withDefaults(
	defineProps<{
		target?: HTMLElement;
		heading: HTMLElement | undefined;
		hidden?: boolean;
		floatingActionOpen?: boolean;
		hasFloatingAction?: boolean;
	}>(),
	{ hidden: false, floatingActionOpen: false, hasFloatingAction: false },
);
const target = toRef(props, "target");
const heading = toRef(props, "heading");
const { visible, returnToTop } = useReturnToTop({
	root: target,
	heading,
	hidden: () => props.hidden || props.floatingActionOpen,
});
</script>

<template>
	<button
		v-if="visible"
		class="return-to-top"
		:class="{ 'above-floating-action': hasFloatingAction }"
		type="button"
		aria-label="返回顶部"
		title="返回顶部"
		@click="returnToTop"
	>
		<InventoryIcon name="return-top" />
		<span class="return-to-top-tooltip" aria-hidden="true">返回顶部</span>
	</button>
</template>

<style scoped>
.return-to-top {
	box-sizing: border-box;
	position: fixed;
	display: grid;
	place-items: center;
	right: 18px;
	bottom: calc(var(--mobile-nav-height, 0px) + 16px);
	z-index: 43;
	width: 44px;
	height: 44px;
	min-width: 44px;
	min-height: 44px;
	padding: 0;
	border: 1px solid #cfc3b4;
	border-radius: 999px;
	background: #fffdf9;
	color: #553b25;
	box-shadow: 0 3px 12px #17203325;
}
.return-to-top :deep(svg) {
	width: 21px;
	height: 21px;
}
.return-to-top-tooltip {
	display: none;
}
.return-to-top.above-floating-action {
	bottom: calc(var(--mobile-nav-height, 0px) + 82px);
}
@media (min-width: 1024px) {
	.return-to-top,
	.return-to-top.above-floating-action {
		bottom: 22px;
	}
	.return-to-top:hover .return-to-top-tooltip,
	.return-to-top:focus-visible .return-to-top-tooltip {
		position: absolute;
		right: 0;
		bottom: calc(100% + 8px);
		display: block;
		width: max-content;
		max-width: 180px;
		padding: 6px 8px;
		border-radius: 7px;
		background: #172033;
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		line-height: 1.2;
		pointer-events: none;
	}
}
</style>
