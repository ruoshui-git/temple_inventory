<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { breadcrumbsForRoute } from "../lib/routeRegistry";
import { inject } from "vue";
import { routeBreadcrumbLabelKey } from "../lib/routeBreadcrumbLabel";
const route = useRoute();
const label = inject(routeBreadcrumbLabelKey, undefined);
const breadcrumbs = computed(() => {
	const value = breadcrumbsForRoute({ name: route.name, params: route.params });
	if (label?.value.value) {
		const authorized = value.find((crumb) => crumb.authorizedLabel);
		if (authorized) authorized.label = label.value.value;
	}
	return value;
});
</script>

<template>
	<nav class="sample-breadcrumb" aria-label="面包屑">
		<template v-for="(crumb, index) in breadcrumbs" :key="`${index}-${crumb.label}`">
			<span v-if="index" aria-hidden="true">/</span>
			<RouterLink v-if="crumb.to" :to="crumb.to">{{ crumb.label }}</RouterLink>
			<span v-else-if="crumb.current" aria-current="page">{{ crumb.label }}</span>
			<span v-else>{{ crumb.label }}</span>
		</template>
	</nav>
</template>
