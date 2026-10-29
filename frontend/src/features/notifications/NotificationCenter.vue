<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import InventoryIcon from "../../components/InventoryIcon.vue";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import { useNotifications } from "./useNotifications";
import NotificationRows from "./NotificationRows.vue";
import { badgeLabel } from "./model";
import { chooseFilterPopoverPlacement } from "../../lib/filterPopoverPlacement";
const c = useNotifications(20, false, true);
const { isMobile } = useResponsiveLayout();
const router = useRouter();
const open = ref(false),
	pendingAll = ref(false);
const transientOwner = "notification-center";
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const popoverStyle = ref<Record<string, string>>({});
const countLabel = computed(() => `通知，${c.unreadCount.value} 条未读`);
function close(returnFocus = false) {
	open.value = false;
	if (returnFocus) void nextTick(() => trigger.value?.focus({ preventScroll: true }));
}
function keydown(event: KeyboardEvent) {
	if (!open.value) return;
	if (event.key === "Escape") {
		event.preventDefault();
		close(true);
		return;
	}
	if (event.key !== "Tab" || isMobile.value) return;
	const focusable = panel.value?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
	if (!focusable?.length) return;
	if (event.shiftKey && document.activeElement === focusable[0]) {
		event.preventDefault();
		focusable[focusable.length - 1].focus();
	} else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
		event.preventDefault();
		focusable[0].focus();
	}
}
function outside(event: PointerEvent) {
	if (
		open.value &&
		!isMobile.value &&
		event.target instanceof Node &&
		!panel.value?.contains(event.target) &&
		!trigger.value?.contains(event.target)
	)
		close();
}
async function markAll() {
	pendingAll.value = true;
	try {
		await c.markAllRead();
	} finally {
		pendingAll.value = false;
	}
}
function navigateAll() {
	close();
	void router.push({ name: "notifications" });
}
function reposition() {
	if (!open.value || isMobile.value || !trigger.value || !panel.value) return;
	const rect = trigger.value.getBoundingClientRect();
	const width = Math.min(440, window.innerWidth - 16);
	const placement = chooseFilterPopoverPlacement({
		triggerTop: rect.top,
		triggerBottom: rect.bottom,
		viewportHeight: window.innerHeight,
		naturalHeight: panel.value.scrollHeight,
		margin: 8,
		gap: 4,
		minimumHeight: 180,
		triggerLeft: rect.left,
		triggerRight: rect.right,
		viewportWidth: window.innerWidth,
		popupWidth: width,
		align: "end",
		horizontalMargin: 8,
	});
	popoverStyle.value = {
		left: `${placement.left ?? 8}px`,
		top: `${placement.top}px`,
		width: `${width}px`,
		maxHeight: `${placement.maxHeight}px`,
	};
}
function routeChanged() {
	close();
}
function otherTransient(event: Event) {
	if ((event as CustomEvent).detail !== transientOwner) close();
}
watch(open, (value) => {
	void c.setPopoverOpen(value);
	if (value && !isMobile.value)
		document.dispatchEvent(
			new CustomEvent("browse-filter-panel-open", { detail: transientOwner }),
		);
	if (value && !isMobile.value)
		if (value && !isMobile.value)
			void nextTick(() => {
				reposition();
				const first = panel.value?.querySelector<HTMLElement>(
					"button:not(:disabled), a[href]",
				);
				(first || panel.value)?.focus({ preventScroll: true });
			});
});
onMounted(() => {
	document.addEventListener("keydown", keydown);
	document.addEventListener("pointerdown", outside);
	document.addEventListener("browse-filter-panel-open", otherTransient);
	document.addEventListener("inventory-navigation", routeChanged);
	window.addEventListener("popstate", routeChanged);
	window.addEventListener("hashchange", routeChanged);
	window.addEventListener("resize", reposition);
	window.addEventListener("scroll", reposition, true);
});
onBeforeUnmount(() => {
	document.removeEventListener("keydown", keydown);
	document.removeEventListener("pointerdown", outside);
	document.removeEventListener("browse-filter-panel-open", otherTransient);
	document.removeEventListener("inventory-navigation", routeChanged);
	window.removeEventListener("popstate", routeChanged);
	window.removeEventListener("hashchange", routeChanged);
	window.removeEventListener("resize", reposition);
	window.removeEventListener("scroll", reposition, true);
});
</script>
<template>
	<div class="notification-center">
		<button
			ref="trigger"
			class="notification-trigger"
			type="button"
			:aria-label="countLabel"
			:aria-expanded="open"
			@click="open = !open"
		>
			<span class="notification-bell-wrap"
				><InventoryIcon name="notice" /><span
					v-if="c.hasRunningExports.value"
					class="notification-progress-ring"
				></span
			></span>
			<span v-if="c.unreadCount.value" class="notification-badge">{{
				badgeLabel(c.unreadCount.value)
			}}</span>
		</button>
		<Overlay
			v-if="open && isMobile"
			title="通知"
			panel-class="notification-sheet"
			:transient-owner="transientOwner"
			@close="close"
		>
			<div class="notification-mobile-actions">
				<UiButton
					size="compact"
					:loading="pendingAll"
					:disabled="!c.unreadCount.value"
					@click="markAll"
					>全部已读</UiButton
				>
				<RouterLink
					class="notification-settings-link"
					aria-label="通知设置"
					to="/settings/notifications"
					@click="close"
					><InventoryIcon name="settings"
				/></RouterLink>
			</div>
			<p v-if="c.error.value" role="alert">
				{{ c.error.value }} <UiButton @click="c.refresh">重试</UiButton>
			</p>
			<p v-if="c.loading.value && c.initialized.value" class="muted" role="status">
				正在更新通知…
			</p>
			<SkeletonBlock
				v-if="c.loading.value && !c.initialized.value"
				variant="lines"
				:count="4"
			/>
			<div v-else-if="c.rows.value.length" ref="panel">
				<NotificationRows
					:rows="c.rows.value"
					:mark-read="c.markRead"
					@navigate="close"
				/><UiButton
					v-if="c.hasMore.value"
					:loading="c.loadingMore.value"
					@click="c.loadMore"
					>加载更多</UiButton
				>
			</div>
			<div v-else-if="c.initialized.value" class="notification-empty">
				<InventoryIcon name="notice" /><strong>暂无通知</strong>
			</div>
			<template #footer><UiButton @click="navigateAll">查看全部</UiButton></template>
		</Overlay>
		<Teleport to="body">
			<section
				v-if="open && !isMobile"
				ref="panel"
				class="notification-popover"
				:style="popoverStyle"
				role="dialog"
				tabindex="-1"
				aria-label="通知"
			>
				<header class="notification-popover-header">
					<strong>通知</strong
					><UiButton
						size="compact"
						:loading="pendingAll"
						:disabled="!c.unreadCount.value"
						@click="markAll"
						>全部已读</UiButton
					><RouterLink
						class="notification-settings-link"
						aria-label="通知设置"
						to="/settings/notifications"
						@click="close"
						><InventoryIcon name="settings"
					/></RouterLink>
				</header>
				<p v-if="c.error.value" role="alert">
					{{ c.error.value }} <UiButton @click="c.refresh">重试</UiButton>
				</p>
				<p v-if="c.loading.value && c.initialized.value" class="muted" role="status">
					正在更新通知…
				</p>
				<SkeletonBlock
					v-if="c.loading.value && !c.initialized.value"
					variant="lines"
					:count="4"
				/>
				<template v-else-if="c.rows.value.length"
					><div class="notification-popover-list">
						<NotificationRows
							:rows="c.rows.value"
							:mark-read="c.markRead"
							@navigate="close"
						/><UiButton
							v-if="c.hasMore.value"
							:loading="c.loadingMore.value"
							@click="c.loadMore"
							>加载更多</UiButton
						>
					</div></template
				>
				<div v-else-if="c.initialized.value" class="notification-empty">
					<InventoryIcon name="notice" /><strong>暂无通知</strong>
				</div>
				<footer><button @click="navigateAll">查看全部</button></footer>
			</section>
		</Teleport>
	</div>
</template>
