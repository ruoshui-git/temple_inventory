<script setup lang="ts">
import { watch } from "vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import FormField from "../../components/ui/FormField.vue";
import { useActivityEditor } from "./useActivityEditor";
const props = defineProps<{ activityId?: string; contextual?: boolean; recoveryId?: string }>();
const emit = defineEmits<{
	saved: [activity: any];
	cancel: [];
	dirtyChange: [dirty: boolean];
}>();
const controller = useActivityEditor(props, (activity) =>
	emit("saved", props.contextual ? activity : activity.name),
);
watch(
	() => controller.dirty.value,
	(dirty) => emit("dirtyChange", dirty),
	{ immediate: true },
);
defineExpose({
	requestLeave: controller.requestLeave,
	breadcrumbLabel: () => controller.existing.value?.title || undefined,
});
const {
	recoveryError,
	requestLeave,
	reload,
	input,
	existing,
	loading,
	busy,
	writable,
	error,
	conflict,
	save,
	types,
	reference,
	recoveryText,
} = controller;
const fieldLabels: Record<string, string> = {
	title: "名称",
	typeId: "类型",
	start: "开始日期",
	end: "结束日期",
	description: "简短说明",
	notes: "详细备注",
};
async function cancel() {
	if (await requestLeave()) emit("cancel");
}
</script>
<template>
	<section class="supporting-editor" aria-label="活动资料编辑">
		<p v-if="recoveryError" role="alert">{{ recoveryError }}</p>
		<SkeletonBlock v-if="loading && !existing" variant="lines" :count="4" />
		<dl v-if="!writable" class="info-grid">
			<div v-for="(value, label) in input" :key="label">
				<dt>{{ fieldLabels[label] }}</dt>
				<dd class="content-long-text">
					{{
						label === "typeId"
							? reference.activityTypes.find((row) => row.value === value)?.label ||
								value
							: value || "未填写"
					}}
				</dd>
			</div>
		</dl>
		<form v-else class="form-fields" novalidate @submit.prevent="save">
			<FormField
				label="名称"
				required
				:error="controller.validation.errors['activity-title']"
			>
				<template #default="{ fieldAttrs }"
					><input
						v-model="input.title"
						v-bind="fieldAttrs"
						:disabled="busy || loading || conflict"
						autocomplete="name"
				/></template>
			</FormField>
			<FormField label="类型" required :error="controller.validation.errors['activity-type']"
				><template #default="{ fieldAttrs }"
					><SearchSelect
						label="类型"
						external-label
						v-model="input.typeId"
						:options="types"
						v-bind="fieldAttrs"
						:disabled="busy || loading || conflict" /></template
			></FormField>
			<FormField label="开始日期" :error="controller.validation.errors['activity-start']"
				><template #default="{ fieldAttrs }"
					><input
						type="date"
						v-model="input.start"
						v-bind="fieldAttrs"
						:disabled="busy || loading || conflict" /></template
			></FormField>
			<FormField label="结束日期" :error="controller.validation.errors['activity-end']"
				><template #default="{ fieldAttrs }"
					><input
						type="date"
						v-model="input.end"
						v-bind="fieldAttrs"
						:disabled="busy || loading || conflict" /></template
			></FormField>
			<FormField class="full-field" label="简短说明"
				><template #default="{ fieldAttrs }"
					><input
						v-model="input.description"
						v-bind="fieldAttrs"
						:disabled="busy || loading || conflict" /></template
			></FormField>
			<FormField class="full-field" label="详细备注" hint="纯文本，保留段落与换行。"
				><template #default="{ fieldAttrs }">
					<textarea
						v-model="input.notes"
						rows="7"
						v-bind="fieldAttrs"
						:disabled="busy || loading || conflict"
					/></template
			></FormField>
		</form>
		<p v-if="existing" class="muted">
			编号 {{ existing.name }} · 标题可以修改，关联记录保持不变。
		</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<div v-if="conflict">
			<p>原记录已变化。当前输入已保留；重新读取会替换当前输入。</p>
			<RecoverySummary kind="Inventory Activity" :values="input" :copy-text="recoveryText" />
			<UiButton @click="reload">重新读取</UiButton>
		</div>
		<div class="form-actions">
			<UiButton @click="cancel">取消</UiButton
			><UiButton
				v-if="writable"
				variant="primary"
				:disabled="loading || busy || conflict"
				:loading="busy"
				@click="save"
				>{{ contextual ? "创建并使用活动" : "保存活动" }}</UiButton
			>
		</div>
	</section>
</template>
