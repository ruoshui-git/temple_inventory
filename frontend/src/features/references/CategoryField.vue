<script setup lang="ts">
import DisclosureSection from "../../components/ui/DisclosureSection.vue";
import { computed, nextTick, ref, watch } from "vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import { useFormValidation } from "../../composables/useFormValidation";
import { useReferenceCreation } from "./useReferenceCreation";
import CategoryFormFields, { type CategoryDraft } from "./CategoryFormFields.vue";
const props = defineProps<{ modelValue?: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const {
	reference,
	creating,
	name,
	group,
	parent,
	busy,
	error,
	permitted,
	finish,
	create,
	candidates,
	recover,
} = useReferenceCreation("category", (value) => emit("update:modelValue", value));
const trigger = ref<InstanceType<typeof UiButton>>();
watch(creating, async (value) => {
	if (!value) {
		await nextTick();
		(
			document.querySelector<HTMLElement>(
				".preview-supporting-field .search-select-input input",
			) || (trigger.value?.$el as HTMLElement | undefined)
		)?.focus();
	}
});
const validation = useFormValidation();
validation.register("category-name", () => name.value, [
	(v) => (v.trim() ? true : "请输入分类名称"),
]);
const categoryOptions = computed(() => [
	{ value: "", label: "无分类" },
	...reference.categories.map((row) => ({
		value: row.name,
		label: row.label || row.name,
		detail: row.parent
			? `${reference.categories.find((p) => p.name === row.parent)?.label || row.parent} / ${row.label}`
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
async function close() {
	await finish();
}
async function submit() {
	if (!validation.validate().ok) return;
	await create();
}
</script>
<template>
	<div class="preview-supporting-field">
		<div class="supporting-field-control">
			<SearchSelect
				label="分类"
				:model-value="modelValue"
				:disabled="disabled || creating || busy"
				:options="categoryOptions"
				@update:model-value="emit('update:modelValue', $event)"
			/><UiButton
				ref="trigger"
				v-if="!disabled && permitted"
				aria-label="新建分类"
				title="新建分类"
				@click="creating = true"
				><span class="category-create-short">+ 分类</span
				><span class="category-create-full">新建分类</span></UiButton
			>
		</div>
		<DisclosureSection
			v-if="candidates.length"
			title="此浏览器有未完成输入"
			:count="candidates.length"
			:summary="`最近 ${candidates[0].updatedAt}`"
			><article v-for="candidate in candidates" :key="candidate.editorId">
				<p>{{ candidate.updatedAt }}</p>
				<RecoverySummary
					kind="Item Group"
					:values="candidate.values"
					:copy-text="JSON.stringify(candidate.values, null, 2)"
					><UiButton @click="recover(candidate)">恢复输入</UiButton></RecoverySummary
				>
			</article></DisclosureSection
		>
		<Overlay v-if="creating" title="新建分类" size="small" @close="close">
			<form novalidate @submit.prevent="submit">
				<CategoryFormFields
					v-model="categoryDraft"
					:categories="reference.categories"
					:disabled="busy"
					:name-error="validation.errors['category-name']"
				/>
				<p v-if="error" role="alert">{{ error }}</p>
				<div class="dialog-actions">
					<UiButton @click="close">取消</UiButton
					><UiButton variant="primary" :disabled="busy" :loading="busy" type="submit"
						>创建并使用分类</UiButton
					>
				</div>
			</form>
		</Overlay>
	</div>
</template>
<style scoped>
.supporting-field-control {
	display: flex;
	align-items: end;
	gap: 8px;
}
.supporting-field-control :deep(.form-field) {
	flex: 1;
	min-width: 0;
}
.category-create-short {
	display: none;
}
.dialog-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 16px;
}
@media (max-width: 640px) {
	.category-create-full {
		display: none;
	}
	.category-create-short {
		display: inline;
	}
	.category-create-short {
		white-space: nowrap;
	}
}
</style>
