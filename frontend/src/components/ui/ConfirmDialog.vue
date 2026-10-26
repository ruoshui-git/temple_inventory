<script setup lang="ts">
import { nextTick, useId, watch } from "vue";
import Overlay from "./Overlay.vue";
import UiButton from "./UiButton.vue";
import { resolveConfirm, useConfirm } from "../../services/confirm";
const { state } = useConfirm();
const messageId = useId();
watch(
	() => state.pending,
	(pending) => {
		if (pending)
			void nextTick(() =>
				document.querySelector<HTMLElement>(".confirm-dialog-cancel")?.focus(),
			);
	},
);
</script>
<template>
	<Overlay
		v-if="state.pending"
		:title="state.pending.options.title"
		size="small"
		role="alertdialog"
		:description-id="messageId"
		initial-focus=".confirm-dialog-cancel"
		@close="resolveConfirm(false)"
	>
		<p :id="messageId">{{ state.pending.options.message }}</p>
		<template #footer>
			<UiButton class="confirm-dialog-cancel" @click="resolveConfirm(false)">
				{{ state.pending.options.cancelLabel || "取消" }}
			</UiButton>
			<UiButton
				:variant="state.pending.options.tone === 'danger' ? 'danger' : 'primary'"
				@click="resolveConfirm(true)"
			>
				{{ state.pending.options.confirmLabel || "确认" }}
			</UiButton>
		</template>
	</Overlay>
</template>
