<script setup lang="ts">
defineProps<{
	label: string;
	serials: string[];
	inputValue: string;
	autoCount?: number;
	hasSeries: boolean;
	disabled?: boolean;
	generateOnBlur?: boolean;
	autoCountLabel?: string;
	largeTargets?: boolean;
}>();
const emit = defineEmits<{
	"update:inputValue": [value: string];
	"toggle-auto": [enabled: boolean];
	"update:auto-count": [value: number];
	add: [value: string];
	remove: [serial: string];
	generate: [];
}>();
</script>
<template>
	<div class="inbound-serial-field" :class="{ 'has-large-targets': largeTargets }">
		<label v-if="hasSeries" class="operation-serial-auto inbound-serial-auto">
			<input
				type="checkbox"
				:checked="autoCount !== undefined"
				:disabled="disabled"
				@change="emit('toggle-auto', ($event.target as HTMLInputElement).checked)"
			/>
			自动生成
		</label>
		<input
			v-if="autoCount !== undefined"
			type="number"
			inputmode="decimal"
			min="1"
			step="1"
			:aria-label="autoCountLabel || `${label}自动生成序列号数量`"
			:value="autoCount"
			:disabled="disabled"
			@input="
				emit(
					'update:auto-count',
					Math.max(1, Number(($event.target as HTMLInputElement).value) || 1),
				)
			"
			@blur="generateOnBlur && emit('generate')"
		/>
		<template v-else>
			<div class="inbound-serial-chips">
				<span
					v-for="serial in serials"
					:key="serial"
					class="operation-serial-chip inbound-serial-chip"
				>
					{{ serial }}
					<button
						type="button"
						:disabled="disabled"
						:aria-label="`移除序列号 ${serial}`"
						@click="emit('remove', serial)"
					>
						×
					</button>
				</span>
			</div>
			<input
				data-field="serials"
				:aria-label="`${label}序列号`"
				:value="inputValue"
				placeholder="输入或扫描后按回车"
				:disabled="disabled"
				@input="emit('update:inputValue', ($event.target as HTMLInputElement).value)"
				@keydown.enter.prevent="emit('add', inputValue)"
				@paste.prevent="emit('add', $event.clipboardData?.getData('text') || '')"
			/>
		</template>
	</div>
</template>
<style scoped>
.inbound-serial-field {
	display: grid;
	gap: var(--p-control-gap);
	min-width: 0;
}
.inbound-serial-chips {
	display: flex;
	flex-wrap: wrap;
	gap: var(--p-field-gap);
}
.inbound-serial-chip,
.inbound-serial-auto {
	display: inline-flex;
	align-items: center;
	gap: var(--p-field-gap);
	min-height: 44px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	padding: var(--p-space-1) var(--p-space-2);
	background: var(--p-surface);
}
.inbound-serial-chip button {
	min-width: 32px;
	min-height: 32px;
	border: 0;
	background: transparent;
	color: inherit;
	cursor: pointer;
}
.inbound-serial-auto input {
	width: 20px;
	min-height: 20px;
	flex: 0 0 20px;
	margin: 0;
	padding: 0;
}
@media (max-width: 1023px) {
	.inbound-serial-field input {
		min-height: 44px;
		font-size: var(--p-input-text);
	}
}
@media (max-width: 700px) {
	.has-large-targets .inbound-serial-chip button {
		min-width: 44px;
		min-height: 44px;
	}
}
</style>
