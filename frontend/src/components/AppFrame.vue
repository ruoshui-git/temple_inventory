<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import InventoryIcon from "./InventoryIcon.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import type { NavigationItem } from "../lib/appNavigation";
const props = withDefaults(
	defineProps<{
		primary: NavigationItem[];
		mobilePrimary?: NavigationItem[];
		inventory: NavigationItem[];
		active?: string;
		inventorySection?: string;
		inventoryExpanded?: boolean;
		moreRoute: string;
		user: string;
		accountNote?: string;
		contentId?: string;
	}>(),
	{ inventoryExpanded: true, contentId: "app-content", accountNote: "" },
);
const emit = defineEmits<{
	primary: [route: string];
	inventory: [route: string];
	more: [route: string];
	"update:inventoryExpanded": [value: boolean];
}>();
const { isMobile } = useResponsiveLayout();
const mobileItems = computed(() =>
	props.mobilePrimary?.length ? props.mobilePrimary : props.primary,
);
const mobileNavigation = ref<HTMLElement>();
let observer: ResizeObserver | undefined;
let previousHeight = "";
function measureNavigation() {
	document.documentElement.style.setProperty(
		"--preview-nav-height",
		`${mobileNavigation.value?.getBoundingClientRect().height || 0}px`,
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
	mobileNavigation,
	() => {
		observer?.disconnect();
		if (typeof ResizeObserver !== "undefined" && mobileNavigation.value) {
			observer = new ResizeObserver(measureNavigation);
			observer.observe(mobileNavigation.value);
		}
		measureNavigation();
	},
	{ flush: "post" },
);
function choose(item: NavigationItem) {
	if (item.key === "inventory")
		emit(
			"update:inventoryExpanded",
			props.active === "inventory" ? !props.inventoryExpanded : true,
		);
	emit("primary", item.route);
}
onMounted(() => {
	previousHeight = document.documentElement.style.getPropertyValue("--preview-nav-height");
	measureNavigation();
	window.addEventListener("resize", measureNavigation);
});
onBeforeUnmount(() => {
	observer?.disconnect();
	window.removeEventListener("resize", measureNavigation);
	if (previousHeight)
		document.documentElement.style.setProperty("--preview-nav-height", previousHeight);
	else document.documentElement.style.removeProperty("--preview-nav-height");
});
</script>
<template>
	<div class="preview-workspace" :class="{ 'is-mobile': isMobile }">
		<aside v-if="!isMobile" class="sample-sidebar">
			<div class="sample-brand">
				<span class="brand-symbol"><InventoryIcon name="box" /></span>
				<div><strong>寺院物资</strong><small>每一份，都妥善安放</small></div>
			</div>
			<slot name="navigation-caption" />
			<nav aria-label="应用主导航">
				<div v-for="group in primary" :key="group.key" class="nav-group">
					<button
						:class="{ active: active === group.key }"
						:aria-current="
							group.key !== 'inventory' && active === group.key ? 'page' : undefined
						"
						:aria-expanded="group.key === 'inventory' ? inventoryExpanded : undefined"
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
					<div
						v-if="group.key === 'inventory' && inventoryExpanded"
						class="nav-children"
					>
						<button
							v-for="child in inventory"
							:key="child.key"
							:aria-current="
								active === 'inventory' && inventorySection === child.key
									? 'page'
									: undefined
							"
							@click="emit('inventory', child.route)"
						>
							{{ child.label }}
						</button>
					</div>
				</div>
			</nav>
			<button
				class="preview-tools-link"
				:aria-current="active === 'more' ? 'page' : undefined"
				@click="emit('more', moreRoute)"
			>
				<InventoryIcon name="more" />更多
			</button>
			<div class="sidebar-bottom">
				<span class="avatar">{{ Array.from(user)[0] || "人" }}</span>
				<div>
					<strong>{{ user }}</strong
					><small v-if="accountNote">{{ accountNote }}</small>
				</div>
			</div>
		</aside>
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
