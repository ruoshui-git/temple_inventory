<script setup lang="ts">
import { ref } from "vue";
import InventoryIcon from "./InventoryIcon.vue";

const props = withDefaults(
	defineProps<{
		title: string;
		count?: number | string;
		icon?: string;
		collapsible?: boolean;
		initialOpen?: boolean;
		clearable?: boolean;
	}>(),
	{
		count: 0,
		icon: "filter",
		collapsible: true,
		initialOpen: true,
		clearable: false,
	},
);
const emit = defineEmits<{ clear: []; toggle: [open: boolean] }>();
const open = ref(props.initialOpen);
function toggle() {
	open.value = !open.value;
	emit("toggle", open.value);
}
</script>

<template>
	<section class="compact-filter-section" :class="{ 'is-open': open }">
		<header class="compact-filter-section-heading">
			<button
				type="button"
				class="compact-filter-section-toggle"
				:aria-expanded="collapsible ? open : true"
				:disabled="!collapsible"
				@click="collapsible && toggle()"
			>
				<InventoryIcon v-if="icon" :name="icon" />
				<strong>{{ title }}</strong>
				<span v-if="count" class="compact-filter-section-count">{{ count }}</span>
				<span v-if="collapsible" class="compact-filter-section-chevron" aria-hidden="true"
					>⌃</span
				>
			</button>
			<button
				v-if="clearable"
				type="button"
				class="compact-filter-section-clear"
				@click="emit('clear')"
			>
				清除
			</button>
		</header>
		<div v-show="!collapsible || open" class="compact-filter-section-body">
			<slot />
		</div>
	</section>
</template>

<style>
.compact-filter-section {
	border: 1px solid #e5dfd5;
	border-radius: 10px;
	background: #fff;
}
.compact-filter-section + .compact-filter-section {
	margin-top: 10px;
}
.compact-filter-section-heading {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 7px 2px 2px;
	/* Reset browser/global heading margins so collapsed filters stay compact. */
	margin: 0;
}
.compact-filter-section-toggle {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 8px;
	min-height: 44px;
	padding: 7px 8px;
	border: 0;
	background: transparent;
	color: #313a45;
	text-align: left;
}
.compact-filter-section-toggle strong {
	flex: 1;
}
.compact-filter-section-toggle:disabled {
	cursor: default;
	opacity: 1;
}
.compact-filter-section-count {
	color: #8a6a43;
	font-size: 11px;
}
.compact-filter-section-chevron {
	font-size: 15px;
	transition: transform 120ms ease;
}
.compact-filter-section:not(.is-open) .compact-filter-section-chevron {
	transform: rotate(180deg);
}
.compact-filter-section-clear {
	min-height: 34px;
	padding: 4px 6px;
	border: 0;
	background: transparent;
	color: #8a5a2c;
}
.compact-filter-section-body {
	padding: 0 10px 10px;
	border-top: 1px solid #eee9e1;
}
.compact-filter-section-body > label,
.compact-filter-section-body > fieldset {
	display: grid;
	gap: 5px;
	margin: 9px 0 0;
}
.compact-filter-section-body > fieldset {
	padding: 0;
	border: 0;
}
.compact-filter-section-body > label > input:not([type="checkbox"]):not([type="radio"]),
.compact-filter-section-body > label > select,
.compact-filter-section-body > fieldset > input:not([type="checkbox"]):not([type="radio"]),
.compact-filter-section-body > fieldset > select {
	box-sizing: border-box;
	min-height: 36px;
	margin: 0;
	border-radius: 7px;
}
.compact-filter-section-body .choice-row {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 36px;
	margin: 0;
	padding: 5px;
}
.compact-filter-section-body .choice-row input {
	min-height: auto;
}
</style>
