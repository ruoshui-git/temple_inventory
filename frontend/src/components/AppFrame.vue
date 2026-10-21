<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import InventoryIcon from "./InventoryIcon.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import type { NavigationItem } from "../lib/appNavigation";
import type { AppRouteTarget } from "../lib/routeRegistry";
const props = withDefaults(
	defineProps<{
		primary: NavigationItem[];
		mobilePrimary?: NavigationItem[];
		inventory: NavigationItem[];
		active?: string;
		inventorySection?: string;
		inventoryExpanded?: boolean;
		moreRoute: AppRouteTarget;
		user: string;
		accountNote?: string;
		contentId?: string;
	}>(),
	{ inventoryExpanded: true, contentId: "app-content", accountNote: "" },
);
const emit = defineEmits<{
	primary: [route: AppRouteTarget];
	inventory: [route: AppRouteTarget];
	more: [route: AppRouteTarget];
	"update:inventoryExpanded": [value: boolean];
}>();
const { isMobile } = useResponsiveLayout();
const mobileItems = computed(() =>
	props.mobilePrimary?.length ? props.mobilePrimary : props.primary,
);
const desktopNavigation = ref<HTMLElement>();
const mobileNavigation = ref<HTMLElement>();
let observer: ResizeObserver | undefined;
let previousHeight = "";
let previousDesktopHeight = "";
function measureNavigation() {
	document.documentElement.style.setProperty(
		"--preview-nav-height",
		`${mobileNavigation.value?.getBoundingClientRect().height || 0}px`,
	);
	document.documentElement.style.setProperty(
		"--preview-desktop-nav-height",
		`${desktopNavigation.value?.getBoundingClientRect().height || 0}px`,
	);
}
watch(
	() => [props.active, isMobile.value],
	async () => {
		await nextTick();
		if (!isMobile.value) return;
		mobileNavigation.value
			?.querySelector<HTMLElement>('[aria-current="page"]')
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
		measureNavigation();
	},
	{ flush: "post" },
);
watch(
	[desktopNavigation, mobileNavigation],
	() => {
		observer?.disconnect();
		if (typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(measureNavigation);
			if (desktopNavigation.value) observer.observe(desktopNavigation.value);
			if (mobileNavigation.value) observer.observe(mobileNavigation.value);
		}
		measureNavigation();
	},
	{ flush: "post" },
);
function choose(item: NavigationItem) {
	if (item.key === "inventory") {
		if (isMobile.value) {
			emit("primary", item.route);
			return;
		}
		emit("update:inventoryExpanded", !props.inventoryExpanded);
		return;
	}
	emit("primary", item.route);
}
function closeMenu(returnFocus = false) {
	if (!props.inventoryExpanded) return;
	emit("update:inventoryExpanded", false);
	if (returnFocus)
		document.querySelector<HTMLButtonElement>("[data-inventory-menu-trigger]")?.focus();
}
function onKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") closeMenu(true);
}
function onOutsidePointer(event: PointerEvent) {
	if (
		!(event.target instanceof Element) ||
		event.target.closest(".inventory-menu, [data-inventory-menu-trigger]")
	)
		return;
	closeMenu();
}
onMounted(() => {
	previousHeight = document.documentElement.style.getPropertyValue("--preview-nav-height");
	previousDesktopHeight = document.documentElement.style.getPropertyValue(
		"--preview-desktop-nav-height",
	);
	measureNavigation();
	window.addEventListener("resize", measureNavigation);
	document.addEventListener("keydown", onKeydown);
	document.addEventListener("pointerdown", onOutsidePointer);
});
onBeforeUnmount(() => {
	observer?.disconnect();
	window.removeEventListener("resize", measureNavigation);
	document.removeEventListener("keydown", onKeydown);
	document.removeEventListener("pointerdown", onOutsidePointer);
	if (previousHeight)
		document.documentElement.style.setProperty("--preview-nav-height", previousHeight);
	else document.documentElement.style.removeProperty("--preview-nav-height");
	if (previousDesktopHeight)
		document.documentElement.style.setProperty(
			"--preview-desktop-nav-height",
			previousDesktopHeight,
		);
	else document.documentElement.style.removeProperty("--preview-desktop-nav-height");
});
</script>
<template>
	<div class="preview-workspace" :class="{ 'is-mobile': isMobile }">
		<header v-if="!isMobile" ref="desktopNavigation" class="sample-sidebar">
			<div class="sample-brand">
				<span class="brand-symbol"><InventoryIcon name="box" /></span>
				<div><strong>寺院物资</strong></div>
			</div>
			<nav aria-label="应用主导航">
				<div v-for="group in primary" :key="group.key" class="nav-group">
					<button
						v-if="group.key === 'inventory'"
						data-inventory-menu-trigger
						:class="{ active: active === group.key }"
						:aria-current="active === group.key ? 'page' : undefined"
						:aria-controls="inventoryExpanded ? 'inventory-menu' : undefined"
						:aria-expanded="inventoryExpanded"
						@click="choose(group)"
					>
						<InventoryIcon class="nav-leading-icon" :name="group.icon" /><span
							class="nav-label"
							>{{ group.label }}</span
						><InventoryIcon
							v-if="group.key === 'inventory'"
							class="nav-chevron"
							name="chevron-down"
						/>
					</button>
					<button
						v-else
						:class="{ active: active === group.key }"
						:aria-current="active === group.key ? 'page' : undefined"
						@click="choose(group)"
					>
						<InventoryIcon class="nav-leading-icon" :name="group.icon" /><span
							class="nav-label"
							>{{ group.label }}</span
						>
					</button>
					<div
						v-if="group.key === 'inventory' && inventoryExpanded"
						class="nav-children inventory-menu"
						id="inventory-menu"
						aria-label="库存页面"
					>
						<button
							v-for="child in inventory"
							:key="child.key"
							:aria-current="
								active === 'inventory' && inventorySection === child.key
									? 'page'
									: undefined
							"
							@click="
								emit('inventory', child.route);
								closeMenu(true);
							"
						>
							{{ child.label }}
						</button>
					</div>
				</div>
			</nav>
			<div class="sidebar-bottom">
				<span class="avatar">{{ Array.from(user)[0] || "人" }}</span>
				<div>
					<strong>{{ user }}</strong
					><small v-if="accountNote">{{ accountNote }}</small>
				</div>
			</div>
		</header>
		<main :id="contentId" class="sample-content"><slot /></main>
		<nav
			v-if="isMobile"
			ref="mobileNavigation"
			class="sample-mobile-nav"
			aria-label="应用主导航"
			:style="{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }"
		>
			<button
				v-for="group in mobileItems"
				:key="group.key"
				:aria-current="active === group.key ? 'page' : undefined"
				@click="choose(group)"
			>
				<InventoryIcon :name="group.icon" /><span>{{ group.label }}</span>
			</button>
		</nav>
	</div>
</template>
