<script setup lang="ts">
import { computed, reactive, ref, watch, onActivated } from "vue";
import { activities, activityTypes, activityTypeLabel } from "../activityData";
import { saveActivity, activityPermissions } from "../activityModel";
import PreviewUiButton from "./PreviewUiButton.vue";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
const props = defineProps<{ activityId?: string; contextual?: boolean }>();
const emit = defineEmits<{ saved: [id: string]; cancel: [] }>();
const existing = computed(() => activities.find((row) => row.id === props.activityId));
const version = ref(existing.value?.version);
const input = reactive({
	title: existing.value?.title || "",
	typeId: existing.value?.typeId || "",
	start: existing.value?.start || "",
	end: existing.value?.end || "",
	description: existing.value?.description || "",
	notes: existing.value?.notes || "",
});
function load() {
	const row = existing.value;
	Object.assign(input, {
		title: row?.title || "",
		typeId: row?.typeId || "",
		start: row?.start || "",
		end: row?.end || "",
		description: row?.description || "",
		notes: row?.notes || "",
	});
	version.value = row?.version;
}
watch(() => props.activityId, load);
onActivated(load);
const fieldLabels: Record<string, string> = {
	title: "名称",
	typeId: "类型",
	start: "开始日期",
	end: "结束日期",
	description: "简短说明",
	notes: "详细备注",
};
const error = ref("");
const types = computed(() =>
	activityTypes
		.filter((row) => row.enabled || row.id === existing.value?.typeId)
		.sort((a, b) => a.order - b.order)
		.map((row) => ({
			value: row.id,
			label: row.label,
			detail: row.enabled ? "" : "已停用 · 保留原类型",
		})),
);
function save() {
	const result = saveActivity(input, props.activityId, version.value);
	error.value = result.error || "";
	if (result.activity) emit("saved", result.activity.id);
}
</script>
<template>
	<section class="preview-supporting-editor" aria-label="活动资料编辑">
		<dl v-if="!activityPermissions.write" class="preview-info-grid">
			<div v-for="(value, label) in input" :key="label">
				<dt>{{ fieldLabels[label] }}</dt>
				<dd class="preview-long-text">
					{{ label === "typeId" ? activityTypeLabel(value) : value || "未填写" }}
				</dd>
			</div>
		</dl>
		<div v-else class="form-fields">
			<label class="preview-field">名称 *<input v-model="input.title" required /></label>
			<PreviewSearchSelect label="类型 *" v-model="input.typeId" :options="types" />
			<label class="preview-field"
				>开始日期<input type="date" v-model="input.start"
			/></label>
			<label class="preview-field">结束日期<input type="date" v-model="input.end" /></label>
			<label class="preview-field full-field"
				>简短说明<input v-model="input.description"
			/></label>
			<label class="preview-field full-field"
				>详细备注<textarea v-model="input.notes" rows="7" aria-label="详细备注" /><small
					>纯文本，保留段落与换行。</small
				></label
			>
		</div>
		<p v-if="existing" class="muted">
			编号 {{ existing.id }} · 标题可以修改，关联记录保持不变。
		</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<div class="form-actions">
			<PreviewUiButton @click="emit('cancel')">{{
				contextual ? "返回选择" : "取消"
			}}</PreviewUiButton
			><PreviewUiButton v-if="activityPermissions.write" variant="primary" @click="save">{{
				contextual ? "创建并使用活动" : "保存活动"
			}}</PreviewUiButton>
		</div>
	</section>
</template>
