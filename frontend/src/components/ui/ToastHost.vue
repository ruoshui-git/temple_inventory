<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiButton from "./UiButton.vue";
import { useOptionalReferenceData } from "../../services/contracts";
import type { ToastMessage, ToastTone } from "../../services/toast";

const reference = useOptionalReferenceData();
const current = ref<ToastMessage>();
const target = ref<HTMLElement | string>("body");
let queue: ToastMessage[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let observer: MutationObserver | undefined;
let dedupe: { key: string; at: number } | undefined;

function updateTarget() {
	const stages = Array.from(document.querySelectorAll<HTMLElement>(".overlay-stage-panel"));
	const stage = [...stages].reverse().find((element) => !element.closest("[inert]"));
	const dialog = Array.from(document.querySelectorAll<HTMLElement>(".preview-dialog"))
		.reverse()
		.find((element) => !element.closest("[inert]"));
	target.value = stage || dialog || "body";
}
function showNext() {
	if (timer) clearTimeout(timer);
	current.value = queue.shift();
	if (current.value && !current.value.persistent) timer = setTimeout(showNext, 5000);
}
function receive(event: Event) {
	const value = (event as CustomEvent<ToastMessage>).detail;
	if (!value || typeof value.message !== "string" || !value.message.trim()) return;
	const tone: ToastTone = ["danger", "warning"].includes(value.tone) ? value.tone : "success";
	const dedupeKey = value.dedupeKey || `${value.tone}:${value.message}`;
	if (dedupe?.key === dedupeKey && Date.now() - dedupe.at < 1600) return;
	dedupe = { key: dedupeKey, at: Date.now() };
	queue.push({ ...value, tone });
	if (!current.value) showNext();
}
function dismiss() {
	const dismissed = current.value;
	current.value = undefined;
	dismissed?.onDismiss?.();
	showNext();
}
function runAction() {
	const action = current.value?.action;
	dismiss();
	try {
		action?.action();
	} catch {
		// The action owner displays its own persistent error if it cannot proceed.
	}
}
watch(
	() => reference?.user,
	() => {
		queue = [];
		current.value = undefined;
		if (timer) clearTimeout(timer);
		dedupe = undefined;
	},
);
const role = computed(() => (current.value?.tone === "success" ? "status" : "alert"));
onMounted(() => {
	window.addEventListener("temple-inventory-toast", receive);
	observer = new MutationObserver(updateTarget);
	observer.observe(document.body, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["inert"],
	});
	updateTarget();
});
onBeforeUnmount(() => {
	window.removeEventListener("temple-inventory-toast", receive);
	observer?.disconnect();
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<Teleport :to="target">
		<div
			v-if="current"
			class="preview-toast"
			:class="{
				'is-danger': current.tone === 'danger',
				'is-warning': current.tone === 'warning',
			}"
			:role="role"
			aria-live="polite"
			aria-atomic="true"
		>
			<span>{{ current.message }}</span>
			<UiButton
				v-if="current.action"
				size="compact"
				:disabled="current.action.disabled"
				@click="runAction"
				>{{ current.action.label }}</UiButton
			>
			<UiButton
				size="compact"
				variant="ghost"
				aria-label="关闭通知"
				title="关闭通知"
				@click="dismiss"
				>×</UiButton
			>
		</div>
	</Teleport>
</template>
