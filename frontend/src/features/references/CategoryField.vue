<script setup lang="ts">
import DisclosureIcon from "../../components/ui/DisclosureIcon.vue";
import { computed, nextTick, ref, watch } from "vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import UiButton from "../../components/ui/UiButton.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import { useReferenceCreation } from "./useReferenceCreation";
import CategoryFormFields, { type CategoryDraft } from "./CategoryFormFields.vue";
const props = defineProps<{
	modelValue?: string;
	disabled?: boolean;
	editorTarget?: HTMLElement;
}>();
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
const categoryOptions = computed(() => [
	{ value: "", label: "无分类" },
	...reference.categories.map((row) => ({
		value: row.name,
		label: row.label || row.name,
		detail: row.parent
			? `${reference.categories.find((parent) => parent.name === row.parent)?.label || row.parent} / ${row.label}`
			: "顶层分类",
	})),
]);
const categoryDraft = computed<CategoryDraft>({
	get: () => ({ label: name.value, parent: parent.value, is_group: group.value }),
	set: (value) => {
		name.value = value.label;
		parent.value = value.parent;
		group.value = value.is_group;
	},
});
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
			label="分类（可选）"
			:model-value="modelValue"
			:disabled="disabled || creating || busy"
			:options="categoryOptions"
			@update:model-value="emit('update:modelValue', $event)"
		/>
		<UiButton ref="trigger" v-if="!disabled && !creating && permitted" @click="creating = true"
			>新建分类</UiButton
		>
		<details v-if="candidates.length">
			<summary class="ti-disclosure">
				<DisclosureIcon variant="inline" />此浏览器有未完成输入
			</summary>
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
				<CategoryFormFields
					v-model="categoryDraft"
					:categories="reference.categories"
					:disabled="disabled || busy"
				/>
				<p v-if="error" role="alert">{{ error }}</p>
				<UiButton @click="finish">返回选择</UiButton
				><UiButton @click="create" :disabled="busy" :loading="busy"
					>创建并使用分类</UiButton
				>
			</fieldset>
		</Teleport>
	</div>
</template>
