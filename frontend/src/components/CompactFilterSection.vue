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
				<span
					v-if="collapsible"
					class="compact-filter-section-chevron disclosure-triangle"
					:class="{ expanded: open }"
					aria-hidden="true"
				></span>
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
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	background: var(--ti-surface);
}
.compact-filter-section + .compact-filter-section {
	margin-top: var(--ti-space-2);
}
.compact-filter-section-heading {
	display: flex;
	align-items: center;
	gap: var(--ti-space-1);
	padding: 2px var(--ti-space-2) 2px 2px;
	/* Reset browser/global heading margins so collapsed filters stay compact. */
	margin: 0;
}
.compact-filter-section-toggle {
	display: flex;
	flex: 1;
	align-items: center;
	gap: var(--ti-space-2);
	min-height: var(--ti-density-control);
	padding: var(--ti-space-2) var(--ti-space-2);
	border: 0;
	background: transparent;
	color: var(--ti-ink);
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
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
}
.compact-filter-section-chevron {
	transition: transform var(--ti-motion-fast) ease;
}
.compact-filter-section-chevron.disclosure-triangle {
	display: inline-block;
	flex: none;
	width: 0;
	height: 0;
	border-top: 4px solid transparent;
	border-bottom: 4px solid transparent;
	border-left: 6px solid currentColor;
	color: var(--ti-muted);
	transform: rotate(0deg);
}
.compact-filter-section-chevron.disclosure-triangle.expanded {
	transform: rotate(90deg);
}
.compact-filter-section-clear {
	min-height: var(--ti-control-height);
	padding: var(--ti-space-1) var(--ti-space-1);
	border: 0;
	background: transparent;
	color: var(--ti-accent);
}
.compact-filter-section-body {
	padding: 0 var(--ti-space-2) var(--ti-space-2);
	border-top: 1px solid var(--ti-accent-soft);
}
.compact-filter-section-body > label,
.compact-filter-section-body > fieldset {
	display: grid;
	gap: var(--ti-space-1);
	margin: var(--ti-space-2) 0 0;
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
	min-height: var(--ti-control-height);
	margin: 0;
	border-radius: var(--ti-radius-control);
}
.compact-filter-section-body .choice-row {
	display: flex;
	align-items: center;
	gap: var(--ti-space-2);
	min-height: var(--ti-control-height);
	margin: 0;
	padding: var(--ti-space-1);
}
.compact-filter-section-body .choice-row input {
	min-height: auto;
}
</style>
