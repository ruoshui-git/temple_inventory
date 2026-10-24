<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { OperationDraft } from "./operationModel";
import { useInventoryServices, useReferenceData } from "../../services/contracts";
import { newReportQuery } from "../../lib/reportContract";
import RemoteSelect from "../../components/ui/RemoteSelect.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ActivityEditor from "../activities/ActivityEditor.vue";
const props = defineProps<{
	draft: Pick<OperationDraft, "source" | "purpose" | "activity" | "loanName"> & { kind: string };
	disabled?: boolean;
	activityLabel: string;
	mode?: "edit" | "display";
}>();
const emit = defineEmits<{ dirtyChange: [value: boolean] }>();
const services = useInventoryServices(),
	reference = useReferenceData();
const creating = ref(false),
	trigger = ref<InstanceType<typeof UiButton>>();
watch(creating, (value) => emit("dirtyChange", value), { flush: "sync" });
async function finish(id?: string) {
	if (id) props.draft.activity = id;
	creating.value = false;
	await nextTick();
	(trigger.value?.$el as HTMLElement)?.focus();
}
async function search(search: string, start: number, signal: AbortSignal) {
	const query = newReportQuery("activities");
	query.view = "metadata";
	query.activityStatus = "active";
	query.search = search;
	const page = await services.report(query, { start, page_length: 30 }, signal);
	const rows = page.rows.map((row) => ({
		value: String(row.activity || row.id),
		label: String(row.title),
		detail: String(row.activity_type_label || ""),
	}));
	for (const row of rows)
		if (!reference.activities.some((old) => old.value === row.value))
			reference.activities.push(row);
	return { rows, total: page.matched_count, next: page.next_start };
}
</script>
<template>
	<dl v-if="mode === 'display'" class="preview-info-grid">
		<div>
			<dt>关联活动</dt>
			<dd>
				{{ activityLabel }}
			</dd>
		</div>
		<div>
			<dt>{{ draft.kind === "Receive" ? "来源" : "用途" }}</dt>
			<dd>{{ (draft.kind === "Receive" ? draft.source : draft.purpose) || "未填写" }}</dd>
		</div>
	</dl>
	<div v-else class="form-fields">
		<template v-if="!creating"
			><dl v-if="draft.loanName" class="preview-info-grid">
				<div>
					<dt>关联活动</dt>
					<dd>
						{{ activityLabel }}
					</dd>
				</div>
			</dl>
			<RemoteSelect
				v-else
				label="关联活动"
				v-model="draft.activity"
				:disabled="disabled"
				:load="search"
				:selected-label="draft.activity ? activityLabel : undefined" /><UiButton
				v-if="!draft.loanName"
				ref="trigger"
				:disabled="disabled"
				class="preview-field-action"
				@click="creating = true"
				>新建活动</UiButton
			>
			<p v-if="draft.loanName" class="muted">活动由原借用记录确定。</p>
			<label class="preview-field" v-if="draft.kind === 'Receive'"
				>来源<input v-model="draft.source" :disabled="disabled" /></label
			><label class="preview-field" v-else
				>用途<input v-model="draft.purpose" :disabled="disabled" /></label
		></template>
		<ActivityEditor v-else contextual class="full-field" @saved="finish" @cancel="finish()" />
	</div>
</template>
