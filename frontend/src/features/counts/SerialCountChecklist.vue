<script setup lang="ts">
import { ref } from "vue";
import { unitLabel } from "../../lib/units";
import { useOptionalInventoryServices } from "../../services/contracts";
import type { CountRow } from "./countModel";

const props = defineProps<{
	row: CountRow;
	writable: boolean;
	busy: boolean;
}>();
const emit = defineEmits<{ update: [serials: string[] | null] }>();
const services = useOptionalInventoryServices();
const input = ref("");
const error = ref("");
const expanded = ref(false);
const limit = 8;
const baseline = () => props.row.baseline_serials || [];
const actual = () => props.row.actual_serials || [];
const visibleSerials = () => new Set(expanded.value ? baseline() : baseline().slice(0, limit));
const present = () => baseline().filter((serial) => actual().includes(serial));
const missing = () =>
	props.row.review_state === "Reviewed"
		? baseline().filter((serial) => !actual().includes(serial))
		: [];
const unconfirmed = () =>
	props.row.review_state === "Unreviewed"
		? baseline().filter((serial) => !actual().includes(serial))
		: [];
const found = () => actual().filter((serial) => !baseline().includes(serial));

function toggle(serial: string) {
	if (!props.writable || props.busy) return;
	const next = new Set(actual());
	if (next.has(serial)) next.delete(serial);
	else next.add(serial);
	emit("update", [...next].sort());
}

function allPresent() {
	if (!props.writable || props.busy) return;
	emit("update", [...new Set([...actual(), ...baseline()])].sort());
}

function markZero() {
	if (!props.writable || props.busy) return;
	emit("update", []);
}

async function addFound() {
	const serial = input.value.trim();
	if (!serial || !props.writable || props.busy) return;
	error.value = "";
	try {
		const result = await services?.call<{
			serial?: string;
			matches?: { item_code: string }[];
		}>("catalog.scan_code", { value: serial });
		if (
			result?.serial &&
			result.matches?.some((match) => match.item_code === props.row.item_code)
		) {
			await services?.call("counts.validate_count_serial", {
				item_code: props.row.item_code,
				warehouse: props.row.warehouse,
				serial: result.serial,
			});
			emit("update", [...new Set([...actual(), result.serial])].sort());
			input.value = "";
			return;
		}
		if (!result?.serial) throw new Error(`没有找到序列号 ${serial}`);
		throw new Error(`序列号 ${serial} 属于其他物品`);
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "序列号读取失败";
	}
}
</script>

<template>
	<div class="serial-count" :data-serial-count="row.item_code">
		<div class="serial-count-toolbar">
			<div class="serial-count-summary">
				<strong>实点 {{ actual().length }} {{ unitLabel(row.stock_uom) }}</strong>
				<span class="serial-count-book-total">账面 {{ baseline().length }} 个序列号</span>
			</div>
			<div v-if="writable" class="serial-count-actions">
				<button type="button" :disabled="busy" @click="allPresent">全部在位</button>
				<button type="button" :disabled="busy" @click="markZero">盘点为 0</button>
			</div>
		</div>
		<div v-if="!row.baseline_serials?.length" class="serial-count-empty">账面无序列号</div>
		<div class="serial-count-groups">
			<div
				v-for="(serials, group) in {
					在位: present(),
					未确认: unconfirmed(),
					缺少: missing(),
				}"
				:key="group"
				v-show="serials.length"
				class="serial-count-group"
			>
				<strong>{{ group }}</strong>
				<div class="serial-count-chips">
					<button
						v-for="serial in serials.filter((value) => visibleSerials().has(value))"
						:key="serial"
						type="button"
						class="serial-count-chip"
						:class="{
							'is-present': actual().includes(serial),
							'is-missing': missing().includes(serial),
						}"
						:aria-pressed="actual().includes(serial)"
						:disabled="!writable || busy"
						@click="toggle(serial)"
					>
						{{ serial }}
					</button>
				</div>
			</div>
			<div v-if="found().length" class="serial-count-group">
				<strong>发现</strong>
				<div class="serial-count-chips">
					<button
						v-for="serial in found()"
						:key="serial"
						type="button"
						class="serial-count-chip is-found"
						:disabled="!writable || busy"
						:aria-label="`移除发现的序列号 ${serial}`"
						@click="toggle(serial)"
					>
						{{ serial }} ×
					</button>
				</div>
			</div>
			<button
				v-if="baseline().length > limit"
				type="button"
				class="serial-count-more"
				@click="expanded = !expanded"
			>
				{{ expanded ? "收起" : `显示全部 ${baseline().length} 个` }}
			</button>
		</div>
		<form v-if="writable" class="serial-count-add" @submit.prevent="addFound">
			<label class="sr-only" :for="`serial-found-${row.item_code}-${row.warehouse}`"
				>发现序列号</label
			>
			<input
				:id="`serial-found-${row.item_code}-${row.warehouse}`"
				v-model="input"
				type="text"
				autocomplete="off"
				placeholder="扫描或输入序列号"
				:disabled="busy"
			/>
			<button type="submit" :disabled="busy || !input.trim()">添加</button>
		</form>
		<p v-if="error" class="serial-count-error" role="alert">{{ error }}</p>
		<small v-if="row.review_state === 'Unreviewed'" class="serial-count-pending">未核对</small>
	</div>
</template>

<style scoped>
.serial-count {
	display: grid;
	gap: 6px;
	width: 100%;
	min-width: 0;
	box-sizing: border-box;
}
.serial-count-toolbar,
.serial-count-add,
.serial-count-actions,
.serial-count-summary {
	display: flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
}
.serial-count-toolbar {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: start;
	gap: 8px;
}
.serial-count-actions {
	justify-content: flex-end;
}
.serial-count-actions button,
.serial-count-add button,
.serial-count-more {
	min-height: 36px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	padding: 3px 8px;
	color: var(--p-accent-strong);
	background: var(--p-surface);
}
.serial-count-chips {
	display: flex;
	flex-wrap: wrap;
	width: 100%;
	gap: 4px;
	max-width: 100%;
}
.serial-count-groups,
.serial-count-group {
	display: grid;
	min-width: 0;
	gap: 4px;
}
.serial-count-group > strong {
	color: var(--p-muted);
	font-size: 0.78rem;
}
.serial-count-chip {
	min-height: 30px;
	max-width: 100%;
	box-sizing: border-box;
	border: 1px solid var(--p-border);
	border-radius: 999px;
	padding: 3px 9px;
	color: var(--p-ink);
	background: var(--p-surface);
	font: inherit;
	font-size: 0.8rem;
	overflow-wrap: anywhere;
}
.serial-count-chip.is-present {
	border-color: var(--p-success);
	color: var(--p-success);
	background: var(--p-success-bg);
}
.serial-count-chip.is-missing {
	border-color: var(--p-danger);
	color: var(--p-danger);
}
.serial-count-chip.is-found {
	border-color: var(--p-accent);
}
.serial-count-add input {
	box-sizing: border-box;
	width: 100%;
	min-width: 110px;
	min-height: 40px;
	flex: 1;
	padding: 5px 8px;
}
.serial-count-error {
	margin: 0;
	color: var(--p-danger);
	font-size: 0.8rem;
}
.serial-count-pending,
.serial-count-empty {
	color: var(--p-muted);
	font-size: 0.78rem;
}
@media (max-width: 1023px) {
	.serial-count-toolbar {
		grid-template-columns: minmax(0, 1fr);
	}
	.serial-count-actions {
		justify-content: flex-start;
	}
	.serial-count-add {
		width: 100%;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.serial-count-chip {
		min-height: 44px;
	}
	.serial-count-toolbar button,
	.serial-count-add button,
	.serial-count-more {
		min-height: 44px;
	}
}
</style>
