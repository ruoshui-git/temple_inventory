<script setup lang="ts">
import { nextTick, ref } from "vue";
import { activityLabel, activityOptions } from "../activityData";
import type { ReviewDraft } from "../reviewModel";
import PreviewActivityEditor from "./PreviewActivityEditor.vue";
import PreviewSearchSelect from "./PreviewSearchSelect.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
const props = defineProps<{ draft: ReviewDraft; disabled?: boolean; mode?: "edit" | "display" }>();
const creating = ref(false);
const trigger = ref<InstanceType<typeof PreviewUiButton>>();
async function finish(id?: string) {
	if (id) props.draft.activity = id;
	creating.value = false;
	await nextTick();
	(trigger.value?.$el as HTMLElement)?.focus();
}
</script>
<template>
	<dl v-if="mode === 'display'" class="preview-info-grid">
		<div>
			<dt>关联活动</dt>
			<dd>{{ activityLabel(draft.activity) }}</dd>
		</div>
		<div>
			<dt>{{ draft.kind === "Receive" ? "来源" : "用途" }}</dt>
			<dd>{{ (draft.kind === "Receive" ? draft.source : draft.purpose) || "未填写" }}</dd>
		</div>
	</dl>
	<div v-else class="form-fields">
		<template v-if="!creating">
			<dl v-if="draft.loanName" class="preview-info-grid">
				<div>
					<dt>关联活动</dt>
					<dd>{{ activityLabel(draft.activity) }}</dd>
				</div>
			</dl>
			<PreviewSearchSelect
				v-else
				label="关联活动"
				v-model="draft.activity"
				:disabled="disabled"
				:options="activityOptions(draft.activity)"
			/>
			<PreviewUiButton
				ref="trigger"
				class="preview-field-action"
				v-if="!draft.loanName"
				:disabled="disabled"
				@click="creating = true"
				>新建活动</PreviewUiButton
			>
			<p v-if="draft.loanName" class="muted">活动由原借用记录确定。</p>
			<label v-if="draft.kind === 'Receive'" class="preview-field"
				>来源<input v-model="draft.source" :disabled="disabled"
			/></label>
			<label v-else class="preview-field"
				>用途<input v-model="draft.purpose" :disabled="disabled"
			/></label>
		</template>
		<PreviewActivityEditor
			v-else
			class="full-field"
			contextual
			@saved="finish"
			@cancel="finish()"
		/>
	</div>
</template>
