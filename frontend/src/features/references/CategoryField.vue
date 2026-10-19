<script setup lang="ts">
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
} = useReferenceCreation("category", (name) => emit("update:modelValue", name));
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
	<div class="preview-supporting-field">
		<SearchSelect
			label="分类"
			:model-value="modelValue"
			:disabled="disabled || creating || busy"
			:options="
				reference.categories.map((row) => ({
					value: row.name,
					label: row.label || row.name,
					detail: row.parent ? `${row.parent} / ${row.label}` : '分类根节点',
				}))
			"
			@update:model-value="emit('update:modelValue', $event)"
		/>
		<UiButton ref="trigger" v-if="!disabled && !creating && permitted" @click="creating = true"
			>新建分类</UiButton
		>
		<details v-if="candidates.length">
			<summary>此浏览器有未完成输入</summary>
			<article v-for="candidate in candidates" :key="candidate.editorId">
				<p>{{ candidate.updatedAt }}</p>
				<RecoverySummary
					kind="Item Group"
					:values="candidate.values"
					:copy-text="JSON.stringify(candidate.values, null, 2)"
				>
					<UiButton @click="recover(candidate)">恢复输入</UiButton>
				</RecoverySummary>
			</article>
		</details>
		<p v-if="creating && recoveryError" role="alert">{{ recoveryError }}</p>
		<Teleport :to="editorTarget || 'body'" :disabled="!editorTarget">
			<fieldset
				ref="editor"
				class="preview-supporting-editor"
				v-if="creating"
				:disabled="disabled || busy"
			>
				<legend>新建分类</legend>
				<label class="preview-field">分类名称<input v-model="name" /></label
				><SearchSelect
					label="上级分类"
					v-model="parent"
					:options="
						reference.categories.filter((row) => row.is_group).map((row) => row.name)
					"
				/><label class="preview-choice-label"
					><input v-model="group" type="checkbox" />允许下级分类</label
				>
				<p v-if="error" role="alert">{{ error }}</p>
				<UiButton @click="finish">返回选择</UiButton
				><UiButton @click="create" :disabled="busy" :loading="busy"
					>创建并使用分类</UiButton
				>
			</fieldset>
		</Teleport>
	</div>
</template>
