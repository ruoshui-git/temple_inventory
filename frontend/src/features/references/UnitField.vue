<script setup lang="ts">
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import { nextTick, ref, watch } from "vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import UiButton from "../../components/ui/UiButton.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import { useReferenceCreation } from "./useReferenceCreation";
defineProps<{ modelValue?: string; disabled?: boolean; editorTarget?: HTMLElement }>();
const emit = defineEmits<{
	"update:modelValue": [value: string];
	dirtyChange: [dirty: boolean];
}>();
const {
	reference,
	creating,
	name,
	whole,
	group,
	parent,
	busy,
	error,
	permitted,
	finish,
	create,
	dirty,
	candidates,
	recoveryError,
	recover,
} = useReferenceCreation("unit", (name) => emit("update:modelValue", name));
const editor = ref<HTMLElement>();
const trigger = ref<InstanceType<typeof UiButton>>();
watch(creating, async (value) => {
	await nextTick();
	if (value) editor.value?.querySelector<HTMLInputElement>("input")?.focus();
	else (trigger.value?.$el as HTMLElement)?.focus();
});
watch([dirty, creating], () => emit("dirtyChange", dirty.value || creating.value), {
	immediate: true,
	flush: "sync",
});
</script>
<template>
	<div class="preview-unit-field preview-supporting-field">
		<SearchSelect
			label="计量单位"
			:model-value="modelValue"
			:options="
				reference.units.map((unit) => ({
					value: unit.name,
					label: unit.name,
					detail: unit.whole ? '整数数量' : '允许小数',
				}))
			"
			:disabled="disabled || busy"
			@update:model-value="emit('update:modelValue', $event)"
		/>
		<UiButton
			ref="trigger"
			v-if="!disabled && !creating && permitted"
			:disabled="!permitted"
			variant="ghost"
			@click="creating = true"
			>新建单位</UiButton
		>
		<p v-if="!permitted" class="muted">没有新建单位的权限；可选择已有单位。</p>
		<DisclosureSection
			v-if="candidates.length"
			title="此浏览器有未完成输入"
			:count="candidates.length"
			:summary="`最近 ${candidates[0].updatedAt}`"
		>
			<article v-for="candidate in candidates" :key="candidate.editorId">
				<p>{{ candidate.updatedAt }}</p>
				<RecoverySummary
					kind="UOM"
					:values="candidate.values"
					:copy-text="JSON.stringify(candidate.values, null, 2)"
				>
					<UiButton @click="recover(candidate)">恢复输入</UiButton>
				</RecoverySummary>
			</article>
		</DisclosureSection>
		<p v-if="creating && recoveryError" role="alert">{{ recoveryError }}</p>
		<Teleport :to="editorTarget || 'body'" :disabled="!editorTarget">
			<fieldset
				ref="editor"
				class="preview-supporting-editor"
				v-if="creating"
				:disabled="disabled || busy"
			>
				<legend>新建单位</legend>
				<label class="preview-field">单位名称<input v-model="name" /></label>
				<label class="preview-choice-label"
					><input v-model="whole" type="checkbox" />只允许整数数量</label
				>
				<p v-if="error" role="alert">{{ error }}</p>
				<UiButton @click="finish">取消</UiButton>
				<UiButton @click="create" :disabled="busy" :loading="busy"
					>保存并使用单位</UiButton
				>
			</fieldset>
		</Teleport>
	</div>
</template>
