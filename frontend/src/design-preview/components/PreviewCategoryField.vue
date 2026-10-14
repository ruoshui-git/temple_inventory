<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { reviewSession } from "../reviewModel";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
defineProps<{ modelValue?: string; disabled?: boolean; editorTarget?: HTMLElement }>();
const emit = defineEmits<{
	"update:modelValue": [value: string];
	dirtyChange: [dirty: boolean];
}>();
const creating = ref(false);
const name = ref("");
const parent = ref("全部物资");
const group = ref(false);
const error = ref("");

const editor = ref<HTMLElement>();
const trigger = ref<InstanceType<typeof PreviewUiButton>>();
watch(creating, async (value) => {
	await nextTick();
	if (value) editor.value?.querySelector<HTMLInputElement>("input")?.focus();
	else (trigger.value?.$el as HTMLButtonElement | undefined)?.focus();
});
const dirty = computed(() => !!name.value || parent.value !== "全部物资" || group.value);
function finish() {
	creating.value = false;
	name.value = "";
	parent.value = "全部物资";
	group.value = false;
	error.value = "";
}
watch(dirty, (value) => emit("dirtyChange", value), { immediate: true, flush: "sync" });

function create() {
	const value = name.value.trim();
	if (!value) {
		error.value = "请填写分类名称";
		return;
	}
	if (reviewSession.categories.some((row) => row.name === value)) {
		error.value = "分类已存在，请直接选择";
		return;
	}
	if (!reviewSession.categories.some((row) => row.name === parent.value && row.is_group)) {
		error.value = "请选择上级分组";
		return;
	}
	reviewSession.categories.push({
		name: value,
		label: value,
		parent: parent.value,
		is_group: group.value,
	});
	emit("update:modelValue", value);
	finish();
}
</script>
<template>
	<div class="preview-supporting-field">
		<PreviewSearchSelect
			label="分类"
			:model-value="modelValue"
			:disabled="disabled || creating"
			:options="
				reviewSession.categories.map((row) => ({
					value: row.name,
					label: row.label,
					detail: row.parent ? `${row.parent} / ${row.label}` : '分类根节点',
				}))
			"
			@update:model-value="emit('update:modelValue', $event)"
		/>
		<PreviewUiButton ref="trigger" v-if="!disabled && !creating" @click="creating = true"
			>新建分类</PreviewUiButton
		>
		<Teleport :to="editorTarget || 'body'" :disabled="!editorTarget">
			<fieldset ref="editor" class="preview-supporting-editor" v-if="creating && !disabled">
				<legend>新建分类</legend>
				<label class="preview-field">分类名称<input v-model="name" /></label
				><PreviewSearchSelect
					label="上级分类"
					v-model="parent"
					:options="
						reviewSession.categories
							.filter((row) => row.is_group)
							.map((row) => row.name)
					"
				/><label class="preview-choice-label"
					><input v-model="group" type="checkbox" />允许下级分类</label
				>
				<p v-if="error" role="alert">{{ error }}</p>
				<PreviewUiButton @click="finish">返回选择</PreviewUiButton
				><PreviewUiButton @click="create">创建并使用分类</PreviewUiButton>
			</fieldset>
		</Teleport>
	</div>
</template>
