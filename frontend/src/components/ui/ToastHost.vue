<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiButton from "./UiButton.vue";
import { useOptionalReferenceData } from "../../services/contracts";
import { toastPlacementClass, type ToastMessage, type ToastTone } from "../../services/toast";

const reference = useOptionalReferenceData();
const messages = ref<ToastMessage[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let dedupe: { key: string; at: number } | undefined;
function receive(event: Event) {
	const value = (event as CustomEvent<ToastMessage>).detail;
	if (!value || typeof value.message !== "string" || !value.message.trim()) return;
	const tone: ToastTone = ["danger", "warning"].includes(value.tone) ? value.tone : "success";
	const dedupeKey = value.dedupeKey || `${value.tone}:${value.message}`;
	if (dedupe?.key === dedupeKey && Date.now() - dedupe.at < 1600) return;
	dedupe = { key: dedupeKey, at: Date.now() };
	const toast = { ...value, tone };
	messages.value.unshift(toast);
	if (!toast.persistent)
		timers.set(
			toast.id,
			setTimeout(() => dismiss(toast.id), 5000),
		);
}
function dismiss(id: string) {
	const index = messages.value.findIndex((message) => message.id === id);
	if (index < 0) return;
	const [dismissed] = messages.value.splice(index, 1);
	const timer = timers.get(id);
	if (timer) clearTimeout(timer);
	timers.delete(id);
	dismissed?.onDismiss?.();
}
function runAction(message: ToastMessage) {
	const action = message.action;
	dismiss(message.id);
	try {
		action?.action();
	} catch {
		// The action owner displays its own persistent error if it cannot proceed.
	}
}
watch(
	() => reference?.user,
	() => {
		for (const timer of timers.values()) clearTimeout(timer);
		timers.clear();
		messages.value = [];
		dedupe = undefined;
	},
);
const role = (tone: ToastTone) => (tone === "success" ? "status" : "alert");
const placement = ref("preview-toast--desktop");
function updatePlacement() {
	const phone =
		typeof window.matchMedia === "function" &&
		window.matchMedia("(max-width: 1023px)").matches;
	placement.value = toastPlacementClass(phone);
}
onMounted(() => {
	updatePlacement();
	window.addEventListener("resize", updatePlacement);
	window.addEventListener("temple-inventory-toast", receive);
});
onBeforeUnmount(() => {
	window.removeEventListener("temple-inventory-toast", receive);
	window.removeEventListener("resize", updatePlacement);
	for (const timer of timers.values()) clearTimeout(timer);
});
</script>
<template>
	<Teleport to="body">
		<div v-if="messages.length" class="preview-toast-stack" :class="placement">
			<div
				v-for="current in messages"
				:key="current.id"
				class="preview-toast"
				:class="{
					'is-danger': current.tone === 'danger',
					'is-warning': current.tone === 'warning',
				}"
				:role="role(current.tone)"
				aria-live="polite"
				aria-atomic="true"
			>
				<span>{{ current.message }}</span>
				<UiButton
					v-if="current.action"
					size="compact"
					:disabled="current.action.disabled"
					@click="runAction(current)"
				>
					{{ current.action.label }}
				</UiButton>
				<UiButton
					size="compact"
					variant="ghost"
					aria-label="关闭通知"
					title="关闭通知"
					@click="dismiss(current.id)"
				>
					×
				</UiButton>
			</div>
		</div>
	</Teleport>
</template>
