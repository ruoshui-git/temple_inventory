import { onBeforeUnmount, onMounted, ref } from "vue";
export function useVirtualKeyboard() {
	const keyboardOpen = ref(false);
	let viewport: VisualViewport | null = null;
	function update() {
		const active = document.activeElement;
		const editing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || (active instanceof HTMLElement && active.isContentEditable);
		keyboardOpen.value = !!editing && !!viewport && viewport.height < window.innerHeight * 0.78;
		if (keyboardOpen.value && active instanceof HTMLElement) requestAnimationFrame(() => active.scrollIntoView({ block: "nearest", behavior: "smooth" }));
	}
	onMounted(() => { viewport = window.visualViewport; viewport?.addEventListener("resize", update); window.addEventListener("focusin", update); window.addEventListener("focusout", update); update(); });
	onBeforeUnmount(() => { viewport?.removeEventListener("resize", update); window.removeEventListener("focusin", update); window.removeEventListener("focusout", update); });
	return { keyboardOpen };
}
