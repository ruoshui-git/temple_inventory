<script setup lang="ts">
import UiButton from "../../components/ui/UiButton.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
import { useActivityEditor } from "./useActivityEditor";
const props = defineProps<{ activityId?: string; contextual?: boolean; recoveryId?: string }>();
const emit = defineEmits<{ saved: [id: string]; cancel: [] }>();
const controller = useActivityEditor(props, (name) => emit("saved", name));
defineExpose({ requestLeave: controller.requestLeave });
const {
	dirty,
	recoveryError,
	candidates,
	recover,
	requestLeave,
	finishLeave,
	leaveRequested,
	reloadRequested,
	input,
	existing,
	loading,
	busy,
	writable,
	error,
	conflict,
	save,
	load,
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
	<section class="preview-supporting-editor" aria-label="活动资料编辑">
		<p v-if="recoveryError" role="alert">{{ recoveryError }}</p>
		<details v-if="candidates.length">
			<summary>此浏览器有未完成的活动输入</summary>
			<p>仅在当前浏览器和账户可用。</p>
			<article v-for="candidate in candidates" :key="candidate.editorId">
				<RecoverySummary
					kind="Inventory Activity"
					:values="candidate.values"
					:copy-text="JSON.stringify(candidate.values, null, 2)"
				>
					<UiButton @click="recover(candidate)">核对后恢复</UiButton>
				</RecoverySummary>
			</article>
		</details>
		<section v-if="leaveRequested" role="alert">
			<p>离开当前活动编辑？未完成输入仅能在此浏览器恢复。</p>
			<UiButton @click="finishLeave('stay')">继续编辑</UiButton
			><UiButton @click="finishLeave('retain')">保留输入并离开</UiButton
			><UiButton variant="danger" @click="finishLeave('discard')">放弃输入并离开</UiButton>
		</section>
		<section v-if="reloadRequested" role="alert">
			<p>重新读取会替换当前输入，请先复制需要保留的文字。</p>
			<RecoverySummary kind="Inventory Activity" :values="input" :copy-text="recoveryText" />
			<UiButton @click="reloadRequested = false">继续编辑</UiButton
			><UiButton
				variant="danger"
				@click="
					reloadRequested = false;
					load();
				"
				>放弃输入并重新读取</UiButton
			>
		</section>
		<p v-if="loading" role="status">正在读取活动…</p>
		<dl v-if="!writable" class="preview-info-grid">
			<div v-for="(value, label) in input" :key="label">
				<dt>{{ fieldLabels[label] }}</dt>
				<dd class="preview-long-text">
					{{
						label === "typeId"
							? reference.activityTypes.find((row) => row.value === value)?.label ||
								value
							: value || "未填写"
					}}
				</dd>
			</div>
		</dl>
		<fieldset v-else class="form-fields" :disabled="busy || loading || conflict">
			<label class="preview-field">名称 *<input v-model="input.title" required /></label>
			<SearchSelect label="类型 *" v-model="input.typeId" :options="types" />
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
		</fieldset>
		<p v-if="existing" class="muted">
			编号 {{ existing.name }} · 标题可以修改，关联记录保持不变。
		</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<div v-if="conflict">
			<p>原记录已变化。当前输入已保留；重新读取会替换当前输入。</p>
			<RecoverySummary kind="Inventory Activity" :values="input" :copy-text="recoveryText" />
			<UiButton @click="dirty ? (reloadRequested = true) : load()">重新读取</UiButton>
		</div>
		<div class="form-actions">
			<UiButton @click="cancel">{{ contextual ? "返回选择" : "取消" }}</UiButton
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
