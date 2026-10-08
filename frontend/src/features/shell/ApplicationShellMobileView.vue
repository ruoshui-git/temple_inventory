<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { LocationQueryRaw } from "vue-router";
import InventoryIcon from "../../components/InventoryIcon.vue";

interface Destination {
	key: "inventory" | "movements" | "loans" | "warehouses" | "more";
	label: string;
	path: string;
}
interface ContextItem {
	key: string;
	label: string;
	path: string;
	query: LocationQueryRaw;
}

const props = defineProps<{
	destinations: Destination[];
	activeDestination: string;
	contextItems: ContextItem[];
	contextKey: string;
	path: string;
}>();

const mobileNav = ref<HTMLElement>();
const mobileContextNav = ref<HTMLElement>();
defineExpose({ mobileNav, mobileContextNav });

let mobileNavObserver: ResizeObserver | undefined;
let mobileContextObserver: ResizeObserver | undefined;

function updateLayoutHeights() {
	document.documentElement.style.setProperty("--shell-header-height", "0px");
	document.documentElement.style.setProperty(
		"--mobile-nav-height",
		`${mobileNav.value?.offsetHeight || 0}px`,
	);
	document.documentElement.style.setProperty(
		"--mobile-context-nav-height",
		`${mobileContextNav.value?.offsetHeight || 0}px`,
	);
}

async function observeNavigation() {
	await nextTick();
	mobileNavObserver?.disconnect();
	mobileContextObserver?.disconnect();
	if (mobileNav.value) mobileNavObserver?.observe(mobileNav.value);
	if (mobileContextNav.value) mobileContextObserver?.observe(mobileContextNav.value);
	updateLayoutHeights();
}

onMounted(() => {
	if (typeof ResizeObserver !== "undefined") {
		mobileNavObserver = new ResizeObserver(updateLayoutHeights);
		mobileContextObserver = new ResizeObserver(updateLayoutHeights);
	}
	void observeNavigation();
});
watch(
	() => props.contextItems,
	() => void observeNavigation(),
	{ deep: true },
);
onBeforeUnmount(() => {
	mobileNavObserver?.disconnect();
	mobileContextObserver?.disconnect();
	document.documentElement.style.removeProperty("--shell-header-height");
	document.documentElement.style.removeProperty("--mobile-nav-height");
	document.documentElement.style.removeProperty("--mobile-context-nav-height");
});
</script>

<template>
	<nav
		v-if="contextItems.length && path !== '/' && path !== '/expiry'"
		ref="mobileContextNav"
		class="mobile-context-nav"
		aria-label="当前视图"
	>
		<RouterLink
			v-for="item in contextItems"
			:key="item.key"
			:to="{ path: item.path, query: item.query }"
			:aria-current="contextKey === item.key ? 'page' : undefined"
			>{{ item.label }}</RouterLink
		>
	</nav>
	<nav ref="mobileNav" class="mobile-nav" aria-label="主导航">
		<RouterLink
			v-for="item in destinations"
			:key="item.path"
			:to="item.path"
			:aria-current="activeDestination === item.path ? 'page' : undefined"
		>
			<svg aria-hidden="true" viewBox="0 0 24 24">
				<path
					v-if="item.key === 'inventory'"
					d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v8m9-4-9 4-9-4m9 4v10"
				/>
				<path
					v-else-if="item.key === 'movements'"
					d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3 3m-3-3 3-3"
				/>
				<path
					v-else-if="item.key === 'loans'"
					d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3"
				/>
				<path
					v-else-if="item.key === 'warehouses'"
					d="m3 10 9-7 9 7v10H3V10Zm4 10v-6h10v6M7 10h10"
				/>
				<path v-else d="M5 12h.01M12 12h.01M19 12h.01" />
			</svg>
			<span>{{ item.label }}</span>
		</RouterLink>
	</nav>
</template>
