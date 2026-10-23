<script setup lang="ts">
withDefaults(
	defineProps<{
		variant?: "lines" | "card" | "list" | "detail";
		count?: number;
		rows?: number;
	}>(),
	{ variant: "lines", count: 3, rows: 4 },
);
</script>

<template>
	<div class="skeleton-block" :class="`skeleton-block--${variant}`" aria-hidden="true">
		<template v-if="variant === 'lines'">
			<span
				v-for="line in count"
				:key="line"
				class="skeleton skeleton-block__line"
				:class="{ short: line === count }"
			/>
		</template>
		<template v-else-if="variant === 'list'">
			<div v-for="row in rows" :key="row" class="skeleton-block__list-row">
				<span class="skeleton skeleton-block__avatar" />
				<span class="skeleton-block__list-copy"
					><i class="skeleton" /><i class="skeleton short"
				/></span>
			</div>
		</template>
		<template v-else-if="variant === 'card'">
			<div class="skeleton-block__card-image skeleton" />
			<span class="skeleton" />
			<span class="skeleton short" />
		</template>
		<template v-else>
			<div class="skeleton-block__detail-heading">
				<span class="skeleton skeleton-block__avatar" />
				<span class="skeleton-block__list-copy"
					><i class="skeleton" /><i class="skeleton short"
				/></span>
			</div>
			<div class="skeleton-block__detail-grid">
				<span v-for="cell in count" :key="cell" class="skeleton-block__detail-cell">
					<i class="skeleton short" /><i class="skeleton" />
				</span>
			</div>
			<span v-for="line in rows" :key="`line-${line}`" class="skeleton" />
		</template>
	</div>
</template>

<style scoped>
.skeleton-block {
	display: grid;
	gap: var(--p-space-3);
	min-width: 0;
}
.skeleton-block__line {
	display: block;
	margin-top: 0;
}
.skeleton-block__list-row,
.skeleton-block__detail-heading {
	display: flex;
	align-items: center;
	gap: var(--p-space-3);
	min-width: 0;
}
.skeleton-block__avatar {
	width: 40px;
	height: 40px;
	margin: 0;
	border-radius: var(--p-radius-md);
	flex: none;
}
.skeleton-block__list-copy {
	display: grid;
	gap: var(--p-space-2);
	flex: 1;
	min-width: 0;
}
.skeleton-block__list-copy .skeleton {
	display: block;
	margin: 0;
}
.skeleton-block__card-image {
	aspect-ratio: 1;
	margin: 0;
}
.skeleton-block--card {
	overflow: hidden;
	padding: var(--p-card-pad);
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-card);
	background: var(--p-surface);
}
.skeleton-block--card .skeleton {
	display: block;
	margin: 0;
}
.skeleton-block--card .skeleton-block__card-image {
	margin: calc(0px - var(--p-card-pad)) calc(0px - var(--p-card-pad)) 0;
	width: calc(100% + var(--p-card-pad) + var(--p-card-pad));
	border-radius: 0;
}
.skeleton-block__detail-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
	gap: var(--p-space-3);
}
.skeleton-block__detail-cell {
	display: grid;
	gap: var(--p-space-2);
	padding: var(--p-space-3);
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-md);
}
.skeleton-block__detail-cell .skeleton {
	display: block;
	margin: 0;
}
</style>
