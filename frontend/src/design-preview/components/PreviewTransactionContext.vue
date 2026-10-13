<script setup lang="ts">
import { ref } from "vue";
import { activities } from "../workflowModel";
import type { ReviewDraft } from "../reviewModel";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
const props = defineProps<{ draft: ReviewDraft; disabled?: boolean }>();
const creating = ref(false),
	title = ref(""),
	type = ref("活动"),
	start = ref(""),
	end = ref(""),
	description = ref(""),
	error = ref("");
function create() {
	if (!title.value.trim()) {
		error.value = "请填写活动名称";
		return;
	}
	if (start.value && end.value && end.value < start.value) {
		error.value = "结束日期不能早于开始日期";
		return;
	}
	if (activities.some((row) => row.name === title.value.trim())) {
		error.value = "活动已存在，请直接选择";
		return;
	}
	activities.push({
		name: title.value.trim(),
		type: type.value,
		start: start.value,
		end: end.value,
		description: description.value,
	});
	props.draft.activity = title.value.trim();
	creating.value = false;
	error.value = "";
}
</script>
<template>
	<div class="form-fields">
		<template v-if="!creating"
			><PreviewSearchSelect
				label="关联活动"
				v-model="draft.activity"
				:disabled="disabled"
				:options="[
					...new Set(
						[...activities.map((row) => row.name), draft.activity].filter(Boolean),
					),
				]" /><PreviewUiButton v-if="!disabled" @click="creating = true"
				>新建活动</PreviewUiButton
			><label>用途<input v-model="draft.purpose" :disabled="disabled" /></label
			><PreviewSearchSelect
				label="负责人"
				v-model="draft.responsible"
				:options="['王师兄', '李师姐', '值班管理员']"
				:disabled="disabled"
		/></template>
		<fieldset v-else :disabled="disabled">
			<legend>新建活动</legend>
			<label>名称<input v-model="title" /></label
			><label
				>类型<select v-model="type">
					<option>活动</option>
					<option>日常</option>
					<option>其他</option>
				</select></label
			><label>开始日期<input type="date" v-model="start" /></label
			><label>结束日期<input type="date" v-model="end" /></label
			><label>说明<textarea v-model="description" /></label>
			<p v-if="error" role="alert">{{ error }}</p>
			<PreviewUiButton @click="creating = false">返回选择</PreviewUiButton
			><PreviewUiButton @click="create">创建并使用活动</PreviewUiButton>
		</fieldset>
	</div>
</template>
