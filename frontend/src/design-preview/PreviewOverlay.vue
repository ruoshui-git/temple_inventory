<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, type CSSProperties } from "vue";
import UiButton from "./components/PreviewUiButton.vue";
withDefaults(defineProps<{ title: string; drawer?: boolean; panelStyle?: CSSProperties }>(), {
	drawer: false,
});
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
const titleId = useId();
let invoker: HTMLElement | null = null;
let openingHash = "";
function closeAfterNavigation() {
	if (window.location.hash !== openingHash) emit("close");
}
let previousOverflow = "";
let app: HTMLElement | null = null;
let previousInert = false;
let underlyingOverlays: Array<{ element: HTMLElement; inert: boolean }> = [];
function keydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		emit("close");
	}
	if (event.key !== "Tab") return;
	const controls = Array.from(
		panel.value?.querySelectorAll<HTMLElement>(
			'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
		) || [],
	);
	const first = controls[0];
	const last = controls.at(-1);
	if (!first) {
		event.preventDefault();
		panel.value?.focus();
		return;
	}
	if (
		event.shiftKey &&
		(document.activeElement === first || document.activeElement === panel.value)
	) {
		event.preventDefault();
		last?.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}
onMounted(async () => {
	openingHash = window.location.hash;
	window.addEventListener("hashchange", closeAfterNavigation);
	invoker = document.activeElement as HTMLElement;
	previousOverflow = document.body.style.overflow;
	document.body.style.overflow = "hidden";
	app = document.getElementById("design-preview");
	previousInert = app?.inert || false;
	if (app) app.inert = true;
	underlyingOverlays = Array.from(document.querySelectorAll<HTMLElement>(".preview-overlay"))
		.filter((element) => !element.contains(panel.value || null))
		.map((element) => ({ element, inert: Boolean(element.inert) }));
	underlyingOverlays.forEach(({ element }) => {
		element.inert = true;
	});
	await nextTick();
	panel.value?.focus();
});
onBeforeUnmount(() => {
	window.removeEventListener("hashchange", closeAfterNavigation);
	document.body.style.overflow = previousOverflow;
	if (app) app.inert = previousInert;
	underlyingOverlays.forEach(({ element, inert }) => {
		element.inert = inert;
	});
	invoker?.focus();
});
</script>
<template>
	<Teleport to="body">
		<div class="preview-overlay" @click.self="emit('close')" @keydown="keydown">
			<section
				ref="panel"
				class="preview-dialog"
				:style="panelStyle"
				:class="{ 'preview-drawer': drawer }"
				role="dialog"
				aria-modal="true"
				:aria-labelledby="titleId"
				tabindex="-1"
			>
				<header class="dialog-heading">
					<div>
						<span class="eyebrow">交互预览</span>
						<h2 :id="titleId">{{ title }}</h2>
					</div>
					<UiButton variant="ghost" aria-label="关闭对话框" @click="emit('close')"
						>关闭 ×</UiButton
					>
				</header>
				<div class="dialog-content"><slot /></div>
				<footer v-if="$slots.footer" class="dialog-footer"><slot name="footer" /></footer>
			</section>
		</div>
	</Teleport>
</template>
