<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { OperationDraft } from "./operationModel";
import { useInventoryServices, useReferenceData } from "../../services/contracts";
import RemoteSelect from "../../components/ui/RemoteSelect.vue";
import UiButton from "../../components/ui/UiButton.vue";
import FormField from "../../components/ui/FormField.vue";
import ActivityEditor from "../activities/ActivityEditor.vue";
import Overlay from "../../components/ui/Overlay.vue";
const props = defineProps<{
	draft: Pick<OperationDraft, "source" | "purpose" | "activity" | "loanName"> & { kind: string };
	returnLoanDetails?: { name: string; activityLabel: string }[];
	disabled?: boolean;
	activityLabel: string;
	mode?: "edit" | "display";
}>();
const emit = defineEmits<{ dirtyChange: [value: boolean] }>();
const services = useInventoryServices(),
	reference = useReferenceData();
const creating = ref(false),
	activityDirty = ref(false),
	trigger = ref<InstanceType<typeof UiButton>>(),
	activityEditor = ref<InstanceType<typeof ActivityEditor>>(),
	selectedTitle = ref(""),
	selectedId = ref("");
watch([creating, activityDirty], ([open, dirty]) => emit("dirtyChange", open || dirty), {
	flush: "sync",
});
watch(
	() => props.draft.activity,
	(value) => {
		if (value !== selectedId.value) selectedTitle.value = "";
	},
);
async function finish(activity?: string | { name: string; title: string }) {
	if (activity) {
		const name = typeof activity === "string" ? activity : activity.name;
		const title =
			typeof activity === "string"
				? reference.activities.find((row) => row.value === activity)?.label || ""
				: activity.title;
		selectedId.value = name;
		selectedTitle.value = title;
		props.draft.activity = name;
		const option = reference.activities.find((row) => row.value === name);
		if (option && title) option.label = title;
		else if (title) reference.activities.push({ value: name, label: title });
	}
	creating.value = false;
	activityDirty.value = false;
	await nextTick();
	(trigger.value?.$el as HTMLElement)?.focus();
}
async function closeCreation() {
	if (await activityEditor.value?.requestLeave()) await finish();
}
async function search(search: string, start: number, signal: AbortSignal) {
	const page = await services.call<{
		rows: {
			name: string;
			title: string;
			type_label: string;
			start_date: string | null;
			end_date: string | null;
		}[];
		total: number;
		next: number | null;
	}>("activities.search_activities", { search, start, limit: 30 }, signal);
	const rows = page.rows.map((row) => ({
		value: row.name,
		label: row.title,
		detail: [row.type_label, [row.start_date, row.end_date].filter(Boolean).join(" – ")]
			.filter(Boolean)
			.join(" · "),
	}));
	for (const row of rows)
		if (!reference.activities.some((old) => old.value === row.value))
			reference.activities.push(row);
	return { rows, total: page.total, next: page.next };
}
</script>
<template>
	<dl v-if="mode === 'display'" class="info-grid">
		<div v-if="draft.kind !== 'Return'">
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
		<template v-if="draft.kind === 'Return'">
			<dl class="info-grid return-activity-summary">
				<div>
					<dt>关联活动</dt>
					<dd>由原借用记录确定</dd>
				</div>
			</dl>
			<ul class="return-loan-context-list">
				<li v-for="loan in returnLoanDetails || []" :key="loan.name">
					原借出 {{ loan.name }} · 活动 {{ loan.activityLabel }}
				</li>
			</ul>
			<FormField label="用途">
				<template #default="{ fieldAttrs }">
					<input v-model="draft.purpose" v-bind="fieldAttrs" :disabled="disabled" />
				</template>
			</FormField>
		</template>
		<template v-else-if="!creating"
			><dl v-if="draft.loanName" class="info-grid">
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
				:selected-label="
					draft.activity
						? selectedTitle && selectedId === draft.activity
							? selectedTitle
							: activityLabel
						: undefined
				"
			/><UiButton
				v-if="!draft.loanName"
				ref="trigger"
				:disabled="disabled"
				class="form-field-action"
				@click="creating = true"
				>新建活动</UiButton
			>
			<p v-if="draft.loanName" class="muted">活动由原借用记录确定。</p>
			<FormField v-if="draft.kind === 'Receive'" label="来源">
				<template #default="{ fieldAttrs }">
					<input v-model="draft.source" v-bind="fieldAttrs" :disabled="disabled" />
				</template>
			</FormField>
			<FormField v-else label="用途">
				<template #default="{ fieldAttrs }">
					<input v-model="draft.purpose" v-bind="fieldAttrs" :disabled="disabled" />
				</template>
			</FormField>
		</template>
	</div>
	<Overlay v-if="creating" title="新建活动" size="small" @close="closeCreation">
		<ActivityEditor
			ref="activityEditor"
			contextual
			class="activity-dialog-editor"
			@saved="finish"
			@cancel="finish()"
			@dirty-change="activityDirty = $event"
		/>
	</Overlay>
</template>

<style scoped>
.return-loan-context-list {
	margin: 0 0 var(--p-space-3);
	padding-inline-start: 1.25em;
	color: var(--p-muted);
	font-size: var(--p-small);
}

/* The dialog already frames the editor; drop the inline card chrome. */
.activity-dialog-editor {
	padding: 0;
	background: none;
	border: 0;
}
</style>
