<script setup lang="ts">
import DisclosureIcon from "./ui/DisclosureIcon.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { router } from "../router";
import InventoryIcon from "./InventoryIcon.vue";
import UiButton from "./ui/UiButton.vue";
import Overlay from "./ui/Overlay.vue";
import { frappePlatform } from "../services/frappePlatform";
import { useLogoutController } from "../features/more/useLogoutController";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import type { NavigationItem } from "../lib/appNavigation";
import type { AppRouteTarget } from "../lib/routeRegistry";
import { registerRouteProgress } from "../lib/routeProgress";
import { environment } from "../lib/environment";
import EnvironmentBadge from "./EnvironmentBadge.vue";
import ConfirmDialog from "./ui/ConfirmDialog.vue";
import { useVirtualKeyboard } from "../composables/useVirtualKeyboard";
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
const taskEditor = computed(() => Boolean(router.currentRoute.value.meta.taskEditor));
const { keyboardOpen } = useVirtualKeyboard();
const routeProgressVisible = ref(false);
const unregisterRouteProgress = registerRouteProgress(router, (value) => {
	routeProgressVisible.value = value;
});
onBeforeUnmount(unregisterRouteProgress);
const logout = useLogoutController(
	frappePlatform(() => props.user),
	() => props.user,
);
const {
	open: logoutOpen,
	busy: logoutBusy,
	error: logoutError,
	close: closeLogout,
	logout: submitLogout,
} = logout;
const accountMenuOpen = ref(false);
const accountTrigger = ref<HTMLButtonElement>();
const accountLogout = ref<HTMLButtonElement>();
const mobileItems = computed(() =>
	props.mobilePrimary?.length ? props.mobilePrimary : props.primary,
);
const desktopNavigation = ref<HTMLElement>();
const mobileNavigation = ref<HTMLElement>();
const mobileTopbar = ref<HTMLElement>();
let observer: ResizeObserver | undefined;
let previousHeight = "";
let previousDesktopHeight = "";
let previousTopbarHeight = "";
function measureNavigation() {
	document.documentElement.style.setProperty(
		"--preview-nav-height",
		`${mobileNavigation.value?.getBoundingClientRect().height || 0}px`,
	);
	document.documentElement.style.setProperty(
		"--preview-desktop-nav-height",
		`${desktopNavigation.value?.getBoundingClientRect().height || 0}px`,
	);
	document.documentElement.style.setProperty(
		"--mobile-app-topbar-height",
		`${mobileTopbar.value?.getBoundingClientRect().height || 0}px`,
	);
}
watch(
	() => [props.active, isMobile.value, taskEditor.value, keyboardOpen.value],
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
	[desktopNavigation, mobileNavigation, mobileTopbar],
	() => {
		observer?.disconnect();
		if (typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(measureNavigation);
			if (desktopNavigation.value) observer.observe(desktopNavigation.value);
			if (mobileNavigation.value) observer.observe(mobileNavigation.value);
			if (mobileTopbar.value) observer.observe(mobileTopbar.value);
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
	if (event.key !== "Escape") return;
	if (accountMenuOpen.value) {
		event.preventDefault();
		event.stopPropagation();
		accountMenuOpen.value = false;
		accountTrigger.value?.focus({ preventScroll: true });
		return;
	}
	closeMenu(true);
}
function onOutsidePointer(event: PointerEvent) {
	if (
		accountMenuOpen.value &&
		(!(event.target instanceof Element) || !event.target.closest(".app-account-menu"))
	)
		accountMenuOpen.value = false;
	if (
		!(event.target instanceof Element) ||
		event.target.closest(".inventory-menu, [data-inventory-menu-trigger]")
	)
		return;
	closeMenu();
}
function onAccountFocus(event: FocusEvent) {
	if (
		accountMenuOpen.value &&
		(!(event.target instanceof Element) || !event.target.closest(".app-account-menu"))
	)
		accountMenuOpen.value = false;
}
watch(
	() => props.user,
	() => {
		accountMenuOpen.value = false;
		closeLogout();
	},
);
watch(accountMenuOpen, (open) => {
	if (open) void nextTick(() => accountLogout.value?.focus({ preventScroll: true }));
});
function dismissLogout() {
	closeLogout();
	if (logoutOpen.value) return;
	accountMenuOpen.value = false;
	void nextTick(() => accountTrigger.value?.focus({ preventScroll: true }));
}
onMounted(() => {
	previousHeight = document.documentElement.style.getPropertyValue("--preview-nav-height");
	previousDesktopHeight = document.documentElement.style.getPropertyValue(
		"--preview-desktop-nav-height",
	);
	previousTopbarHeight = document.documentElement.style.getPropertyValue(
		"--mobile-app-topbar-height",
	);
	measureNavigation();
	window.addEventListener("resize", measureNavigation);
	document.addEventListener("keydown", onKeydown);
	document.addEventListener("pointerdown", onOutsidePointer);
	document.addEventListener("focusin", onAccountFocus);
});
onBeforeUnmount(() => {
	observer?.disconnect();
	window.removeEventListener("resize", measureNavigation);
	document.removeEventListener("keydown", onKeydown);
	document.removeEventListener("pointerdown", onOutsidePointer);
	document.removeEventListener("focusin", onAccountFocus);
	if (previousHeight)
		document.documentElement.style.setProperty("--preview-nav-height", previousHeight);
	else document.documentElement.style.removeProperty("--preview-nav-height");
	if (previousDesktopHeight)
		document.documentElement.style.setProperty(
			"--preview-desktop-nav-height",
			previousDesktopHeight,
		);
	else document.documentElement.style.removeProperty("--preview-desktop-nav-height");
	if (previousTopbarHeight)
		document.documentElement.style.setProperty(
			"--mobile-app-topbar-height",
			previousTopbarHeight,
		);
	else document.documentElement.style.removeProperty("--mobile-app-topbar-height");
});
</script>
<template>
	<div
		class="preview-workspace"
		:class="{
			'is-mobile': isMobile,
			'is-task-editor': taskEditor,
			'keyboard-open': keyboardOpen,
		}"
	>
		<div
			v-if="routeProgressVisible"
			class="route-progress"
			role="progressbar"
			aria-label="正在切换页面"
			aria-valuetext="页面正在加载"
		></div>
		<header v-if="!isMobile" ref="desktopNavigation" class="sample-sidebar">
			<div class="sample-brand">
				<span class="brand-symbol"><InventoryIcon name="box" /></span>
				<div class="brand-title">
					<strong>物资管理</strong><EnvironmentBadge :environment="environment" />
				</div>
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
						><DisclosureIcon
							v-if="group.key === 'inventory'"
							class="nav-chevron"
							variant="popup"
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
			<div v-if="!isMobile" class="sidebar-bottom app-account-menu">
				<slot name="notifications" />
				<button
					ref="accountTrigger"
					type="button"
					class="app-account-trigger"
					aria-haspopup="menu"
					:aria-expanded="accountMenuOpen"
					:aria-controls="accountMenuOpen ? 'desktop-account-menu' : undefined"
					@click="accountMenuOpen = !accountMenuOpen"
				>
					<span class="avatar">{{ Array.from(user)[0] || "人" }}</span>
					<span class="app-account-label">
						<strong>{{ user }}</strong>
						<small v-if="accountNote">{{ accountNote }}</small>
					</span>
					<DisclosureIcon variant="popup" />
				</button>
				<div
					v-if="accountMenuOpen"
					id="desktop-account-menu"
					class="app-account-dropdown"
					role="menu"
					aria-label="账户菜单"
				>
					<strong>{{ user }}</strong>
					<button
						ref="accountLogout"
						type="button"
						role="menuitem"
						@click="logout.show()"
					>
						退出登录
					</button>
				</div>
			</div>
		</header>
		<header v-if="isMobile" ref="mobileTopbar" class="mobile-app-topbar">
			<div class="mobile-brand-title">
				<strong>物资管理</strong><EnvironmentBadge :environment="environment" />
			</div>
			<slot name="notifications" />
		</header>
		<main :id="contentId" class="sample-content"><slot /></main>
		<nav
			v-if="isMobile && !taskEditor"
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
		<Overlay
			v-if="logoutOpen"
			title="退出登录"
			:dismissible="!logoutBusy"
			@close="dismissLogout"
		>
			<p>退出当前账户后，可重新登录继续工作。</p>
			<p v-if="logoutError" role="alert">{{ logoutError }}</p>
			<template #footer>
				<UiButton :disabled="logoutBusy" @click="dismissLogout">取消</UiButton>
				<UiButton variant="danger" :loading="logoutBusy" @click="submitLogout"
					>确认退出</UiButton
				>
			</template>
		</Overlay>
		<ConfirmDialog />
	</div>
</template>
