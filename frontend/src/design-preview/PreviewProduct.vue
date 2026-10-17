<script setup lang="ts">
import AsyncImage from "../components/ui/AsyncImage.vue";
import type { StockItem } from "./model";
defineProps<{ kind: StockItem["illustration"]; name: string }>();
</script>
<template>
	<div class="product-art" :class="`product-art--${kind}`">
		<AsyncImage
			v-if="kind === 'none'"
			:alt="name"
			placeholder-label="暂无图片"
			width="100%"
			height="100%"
		/>
		<svg v-else viewBox="0 0 240 160" role="img" :aria-label="`${name} · 示意插画`">
			<ellipse cx="120" cy="139" rx="53" ry="7" fill="currentColor" opacity=".08" />
			<g v-if="kind === 'rice'" stroke="#9B896B" stroke-width="1.5" stroke-linejoin="round">
				<path d="M87 28h67l-6 15 11 80q0 11-12 11H91q-13 0-11-13l13-78z" fill="#E5D9BC" />
				<path d="m89 32 61 2m-57 9h55" fill="none" />
				<path d="M86 67h67v42H83z" fill="#FFFDF5" stroke="none" />
				<path
					d="M116 97V76m0 12-8-6m8 1 8-7m-8 19 10-8"
					fill="none"
					stroke="#687650"
					stroke-width="2"
				/>
				<path d="m101 116 36 1" stroke="#9B896B" stroke-width="2" />
			</g>
			<g v-else-if="kind === 'oil'" stroke="#B58D37" stroke-width="1.5">
				<path d="M103 38h33l14 24v62q0 11-11 11H97q-11 0-11-11V63z" fill="#E9C768" />
				<rect
					x="102"
					y="27"
					width="34"
					height="14"
					rx="3"
					fill="#527454"
					stroke="#527454"
				/>
				<path d="M136 49h15q9 0 9 10v23h-10" fill="none" stroke-width="5" />
				<rect x="88" y="77" width="60" height="33" fill="#FFF9E7" stroke="none" />
				<path d="M113 102q-12-17 10-19-1 17-10 19Z" fill="#6E874E" stroke="none" />
			</g>
			<g
				v-else-if="kind === 'cloth'"
				stroke="#7C8F97"
				stroke-width="1.5"
				stroke-linejoin="round"
			>
				<path
					d="m97 35-28 14-15 35 25 11 10-18v58h65V77l10 18 25-11-15-35-30-14q-24 16-47 0Z"
					fill="#B6C6CB"
				/>
				<path d="m97 35 24 20 23-20m-23 20v80M99 80h12v19H99z" fill="none" />
				<path d="m89 126 65 0" stroke="#8A9EA5" />
			</g>
			<g v-else stroke="#8B9A8D" stroke-width="1.5" stroke-linejoin="round">
				<path d="m72 66 78-11 27 21-79 13Z" fill="#EDF0E7" />
				<path d="m76 71 23 16v46l-20-16Z" fill="#CED9CE" />
				<path d="m99 87 74-10-4 43-70 13Z" fill="#DEE7DC" />
				<path d="m68 62 81-12 31 23-82 13Z" fill="#A2B6A1" />
				<path d="m68 62 1 9 29 23 82-12v-9M98 86v8" fill="none" />
				<path d="m128 94 18-3v10l-18 3Z" fill="#F6F8F2" />
			</g>
		</svg>
	</div>
</template>
