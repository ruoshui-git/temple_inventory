<script setup lang="ts">
import { computed, reactive, ref, nextTick } from "vue";
import { reviewSession } from "../reviewModel";
import PreviewOverlay from "../PreviewOverlay.vue";
import PreviewUnitField from "./PreviewUnitField.vue";
import PreviewUiButton from "./PreviewUiButton.vue";
const props = defineProps<{ allowCreate?: boolean; eligible?: string[] }>();
const emit = defineEmits<{ close: []; select: [code: string]; notify: [message: string] }>();
const search = ref("");
const creating = ref(false);
const discard = ref(false);
const pendingSelection = ref<string>();
const error = ref("");
const model = reactive({
	code: `ITM-PREVIEW-${reviewSession.stock.length + 1}`,
	name: "",
	category: "日用品",
	uom: "",
	tracksBatch: false,
	tracksExpiry: false,
});
const visible = computed(() =>
	reviewSession.stock.filter(
		(item) =>
			(!props.eligible || props.eligible.includes(item.code)) &&
			`${item.name} ${item.code}`
				.toLocaleLowerCase()
				.includes(search.value.toLocaleLowerCase()),
	),
);
const content = ref<HTMLElement>();
async function showCreate(value: boolean) {
	creating.value = value;
	discard.value = false;
	await nextTick();
	content.value?.querySelector<HTMLInputElement>("input")?.focus();
}
const initialCode = model.code;
const dirty = computed(
	() =>
		!!(
			model.name ||
			model.uom ||
			model.tracksBatch ||
			model.tracksExpiry ||
			model.category !== "日用品" ||
			model.code !== initialCode
		),
);
function close() {
	pendingSelection.value = undefined;
	if (dirty.value) {
		discard.value = true;
		return;
	}
	emit("close");
}
function selectExisting(code: string) {
	if (dirty.value) {
		pendingSelection.value = code;
		discard.value = true;
		return;
	}
	emit("select", code);
}
function discardEdits() {
	if (pendingSelection.value) emit("select", pendingSelection.value);
	else emit("close");
}
function save() {
	if (!model.code.trim() || !model.name.trim() || !model.uom) {
		error.value = "请填写编号、名称和单位";
		return;
	}
	if (reviewSession.stock.some((item) => item.code === model.code.trim())) {
		error.value = "物品编号已存在";
		return;
	}
	reviewSession.stock.push({
		...model,
		code: model.code.trim(),
		name: model.name.trim(),
		tracksBatch: model.tracksBatch || model.tracksExpiry,
		illustration: "none",
		locations: [],
		available: 0,
		loaned: 0,
		damaged: 0,
	});
	emit("notify", "物品已创建并加入入库单；取消入库不会删除物品或单位。");
	emit("select", model.code.trim());
}
</script>
<template>
	<PreviewOverlay :title="creating ? '新建物品' : '选择物品'" drawer @close="close">
		<div ref="content">
			<template v-if="!creating">
				<label>搜索物品<input v-model="search" type="search" /></label>
				<PreviewUiButton v-if="allowCreate" @click="showCreate(true)"
					>新建物品</PreviewUiButton
				>
				<button
					v-for="item in visible"
					:key="item.code"
					class="browse-rank-row picker-row"
					@click="selectExisting(item.code)"
				>
					<span
						>{{ item.name }}<small>{{ item.code }} · {{ item.category }}</small></span
					><span>{{ item.uom }}</span>
				</button>
				<p v-if="!visible.length">没有匹配的物品</p>
			</template>
			<form v-else class="preview-filter-fields" @submit.prevent="save">
				<PreviewUiButton variant="ghost" @click="showCreate(false)"
					>返回选择物品（保留填写）</PreviewUiButton
				>
				<label>物品编号<input v-model="model.code" /></label>
				<label>物品名称<input v-model="model.name" /></label>
				<label
					>分类<select v-model="model.category">
						<option
							v-for="category in [
								...new Set(reviewSession.stock.map((item) => item.category)),
							]"
							:key="category"
						>
							{{ category }}
						</option>
					</select></label
				>
				<PreviewUnitField v-model="model.uom" />
				<label
					><input
						v-model="model.tracksBatch"
						type="checkbox"
						:disabled="model.tracksExpiry"
					/>按批次管理</label
				>
				<label><input v-model="model.tracksExpiry" type="checkbox" />记录效期</label>
				<p class="muted">批次、数量和效期在入库单中填写。</p>
				<p v-if="error" role="alert">{{ error }}</p>
				<PreviewUiButton type="submit" variant="primary">创建并使用</PreviewUiButton>
			</form>
			<div v-if="discard" role="alert">
				<p>放弃未保存的物品资料？已创建的单位仍会保留。</p>
				<PreviewUiButton @click="showCreate(true)">继续填写</PreviewUiButton
				><PreviewUiButton @click="discardEdits">放弃填写</PreviewUiButton>
			</div>
		</div>
	</PreviewOverlay>
</template>
