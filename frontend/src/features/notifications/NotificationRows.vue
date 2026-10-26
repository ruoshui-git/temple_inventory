<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import InventoryIcon from "../../components/InventoryIcon.vue";
import UiButton from "../../components/ui/UiButton.vue";
import type { InventoryNotification } from "./model";
import {
	isDownloadLink,
	notificationData,
	notificationGroups,
	notificationIcon,
	relativeTime,
} from "./model";
const props = defineProps<{
	rows: InventoryNotification[];
	markRead: (name: string) => Promise<void>;
}>();
const emit = defineEmits<{ navigate: [] }>();
const router = useRouter();
const groups = computed(() => notificationGroups(props.rows));
async function open(row: InventoryNotification) {
	await props.markRead(row.name).catch(() => undefined);
	if (isDownloadLink(row.link)) {
		window.location.assign(row.link);
		return;
	}
	const path = row.link.replace(/^\/inventory(?=\/|$)/, "") || "/";
	void router.push(path);
	emit("navigate");
}
function data(row: InventoryNotification) {
	return notificationData(row);
}
function isExport(row: InventoryNotification) {
	return row.type === "导出完成";
}
function exportFailure(row: InventoryNotification) {
	const value = data(row);
	if (value.status !== "Failed") return "";
	return String(value.reason || value.error || value.message || "导出失败，请打开报表重试。");
}
</script>
<template>
	<div v-for="group in groups" :key="group.label" class="notification-day-group">
		<h3>{{ group.label }}</h3>
		<ul class="notification-rows">
			<li
				v-for="row in group.items"
				:key="row.name"
				:class="{ unread: !row.read, 'is-export': isExport(row) }"
			>
				<div class="notification-kind">
					<InventoryIcon :name="notificationIcon(row)" />
				</div>
				<div class="notification-copy">
					<button
						class="notification-subject"
						:class="{ unread: !row.read }"
						@click="open(row)"
					>
						{{ row.subject }}
					</button>
					<time>{{ relativeTime(row.creation) }}</time>
				</div>
				<span v-if="!row.read" class="notification-unread-dot" aria-label="未读"></span>
				<template v-if="isExport(row)">
					<small v-if="exportFailure(row)" class="notification-export-reason">{{
						exportFailure(row)
					}}</small>
					<span
						v-if="data(row).status === 'Completed' && row.unavailable"
						class="notification-unavailable"
						>文件已不可用</span
					>
					<UiButton
						v-else-if="data(row).status === 'Completed'"
						size="compact"
						icon="download"
						@click="open(row)"
						>下载</UiButton
					>
					<UiButton v-else size="compact" icon="report" @click="open(row)"
						>打开报表</UiButton
					>
				</template>
			</li>
		</ul>
	</div>
</template>
