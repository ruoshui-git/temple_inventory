<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { LocationQueryRaw } from "vue-router";

export interface MobileSubnavItem {
	key: string;
	label: string;
	path: string;
	query?: LocationQueryRaw;
	count?: number | string;
}

const props = withDefaults(
	defineProps<{
		items: MobileSubnavItem[];
		activeKey: string;
		compact?: boolean;
		ariaLabel?: string;
		className?: string;
	}>(),
	{
		compact: undefined,
		ariaLabel: "当前视图",
		className: "",
	},
);

const internalCompact = ref(false);
const isExternallyControlled = () => props.compact !== undefined;

function resetCompact() {
	if (!isExternallyControlled()) internalCompact.value = false;
}

function updateCompact(event?: Event) {
	if (isExternallyControlled()) return;
	const target = event?.target;
	if (target instanceof HTMLElement) {
		const scrollSurface = target.closest<HTMLElement>(".results-scroll");
		if (!scrollSurface) return;
		internalCompact.value = scrollSurface.scrollTop > 80;
		return;
	}
	const scrollTop = window.scrollY || 0;
	internalCompact.value = scrollTop > 80;
}

const onWindowScroll = (event: Event) => {
	if (event.target instanceof HTMLElement) return;
	updateCompact();
};
const onDocumentScroll = (event: Event) => updateCompact(event);

onMounted(() => {
	if (isExternallyControlled()) return;
	window.addEventListener("scroll", onWindowScroll, { passive: true });
	document.addEventListener("scroll", onDocumentScroll, {
		passive: true,
		capture: true,
	});
});
onBeforeUnmount(() => {
	window.removeEventListener("scroll", onWindowScroll);
	document.removeEventListener("scroll", onDocumentScroll, true);
});
watch(
	() => [
		props.activeKey,
		props.items
			.map((item) => `${item.key}:${item.path}:${JSON.stringify(item.query || {})}`)
			.join("|"),
	],
	resetCompact,
);
</script>

<template>
	<nav
		class="mobile-subnav"
		:class="[{ compact: compact ?? internalCompact }, className]"
		:aria-label="ariaLabel"
	>
		<RouterLink
			v-for="item in items"
			:key="item.key"
			:to="{ path: item.path, query: item.query || {} }"
			:aria-current="activeKey === item.key ? 'page' : undefined"
		>
			<span>{{ item.label }}</span>
			<span v-if="item.count !== undefined" class="mobile-subnav-count">{{
				item.count
			}}</span>
		</RouterLink>
	</nav>
</template>

<style scoped>
.mobile-subnav {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	box-sizing: border-box;
	min-width: 0;
	min-height: 46px;
	gap: 3px;
	padding: 3px;
	border-radius: 8px;
	background: #ece8e1;
}
.mobile-subnav a {
	display: flex;
	min-width: 0;
	min-height: 38px;
	align-items: center;
	justify-content: center;
	gap: 2px;
	box-sizing: border-box;
	padding: 7px 8px;
	border-radius: 6px;
	color: #746d63;
	text-align: center;
	text-decoration: none;
	white-space: nowrap;
}
.mobile-subnav a[aria-current="page"] {
	background: #fff;
	color: #80572f;
	box-shadow: 0 1px 3px #5b49351c;
	font-weight: 700;
}
.mobile-subnav-count {
	font-size: 10px;
}
.mobile-subnav.compact {
	min-height: 40px;
	gap: 2px;
	padding: 2px;
}
.mobile-subnav.compact a {
	min-height: 36px;
	padding: 4px 7px;
	font-size: 11px;
}
@media (min-width: 1024px) {
	.mobile-subnav {
		display: none;
	}
}
</style>
