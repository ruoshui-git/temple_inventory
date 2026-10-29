<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useInventoryServices, useReferenceData } from "../../services/contracts";
import UiButton from "../../components/ui/UiButton.vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { detectInstallPlatform } from "../../lib/installGuidance";
import { subscribePushDevice } from "../settings/useNotificationSettings";

const services = useInventoryServices();
const reference = useReferenceData();
const account = reference.user;
const route = useRoute();
const { isMobile } = useResponsiveLayout();
const ready = ref(false);
const dismissed = ref(true);
const busy = ref(false);
const error = ref("");
const pushAvailable = () =>
	!import.meta.env.DEV &&
	window.isSecureContext &&
	"Notification" in window &&
	"serviceWorker" in navigator &&
	"PushManager" in window &&
	Notification.permission === "default";
const visible = computed(
	() =>
		ready.value &&
		!dismissed.value &&
		pushAvailable() &&
		!(
			detectInstallPlatform(
				navigator.userAgent,
				navigator.platform,
				navigator.maxTouchPoints,
			) === "ios" &&
			!window.matchMedia("(display-mode: standalone)").matches &&
			(navigator as Navigator & { standalone?: boolean }).standalone !== true
		) &&
		!(isMobile.value && route.meta.taskEditor),
);
onMounted(async () => {
	if (!pushAvailable()) return;
	try {
		const [wasDismissed, subscription] = await Promise.all([
			services.call<boolean>("preferences.push_prompt_dismissed"),
			navigator.serviceWorker.ready.then((registration) =>
				registration.pushManager.getSubscription(),
			),
		]);
		dismissed.value = wasDismissed || !!subscription;
	} catch {
		dismissed.value = true;
	} finally {
		ready.value = reference.user === account;
	}
});
async function dismiss() {
	dismissed.value = true;
	try {
		await services.call("preferences.dismiss_push_prompt");
	} catch {
		error.value = "未能保存此设置，请稍后重试。";
		dismissed.value = false;
	}
}
async function enable() {
	if (busy.value) return;
	busy.value = true;
	error.value = "";
	try {
		await subscribePushDevice(services, true);
		dismissed.value = true;
	} catch (reason) {
		// A denial is answered in 通知设置, which explains how to re-allow it.
		if (Notification.permission === "denied") dismissed.value = true;
		else error.value = reason instanceof Error ? reason.message : "开启系统通知失败";
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<aside v-if="visible" class="push-prompt" role="region" aria-label="系统通知">
		<span>开启系统通知，及时收到导出完成、过期提醒等消息</span>
		<UiButton variant="primary" :loading="busy" @click="enable">开启</UiButton>
		<UiButton :disabled="busy" @click="dismiss">不再提示</UiButton>
		<p v-if="error" role="alert">{{ error }}</p>
	</aside>
</template>

<style scoped>
.push-prompt {
	position: fixed;
	z-index: 60;
	inset-inline: 16px;
	bottom: calc(16px + env(safe-area-inset-bottom));
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	max-width: 680px;
	margin-inline: auto;
	padding: 12px 16px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
	box-shadow: var(--p-shadow-raised);
}
.push-prompt p {
	flex-basis: 100%;
}
@media (max-width: 600px) {
	.push-prompt {
		flex-wrap: wrap;
	}
	.push-prompt span {
		flex-basis: 100%;
	}
	.push-prompt .ui-button {
		flex: 1;
	}
}
</style>
