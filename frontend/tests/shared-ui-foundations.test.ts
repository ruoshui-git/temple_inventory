import { describe, expect, it } from "vitest";
import { effectScope, reactive, nextTick } from "vue";
import { useFormValidation } from "../src/composables/useFormValidation";
import { edgeIsOverflowing } from "../src/composables/useOverflowEdges";
import { confirm, resolveConfirm } from "../src/services/confirm";
import { toastPlacementClass } from "../src/services/toast";

describe("shared UI foundations", () => {
	it("validates fields in order, focuses the first invalid field, and clears errors on edit", async () => {
		const scope = effectScope();
		const result = scope.run(() => {
			const form = useFormValidation();
			const data = reactive({ name: "", location: "" });
			let focused = "";
			form.register("name", () => data.name, [(value) => value ? true : "请输入名称"], () => { focused = "name"; });
			form.register("location", () => data.location, [(value) => value ? true : "请选择位置"]);
			return { form, data, getFocused: () => focused };
		});
		if (!result) throw new Error("validation scope missing");
		expect(result.form.validate()).toMatchObject({ ok: false, firstInvalid: "name" });
		expect(result.getFocused()).toBe("name");
		result.data.name = "物品";
		await nextTick();
		expect(result.form.errors.name).toBeUndefined();
		scope.stop();
	});

	it("resolves a promise confirmation and declines concurrent requests", async () => {
		const pending = confirm({ title: "确认", message: "删除？", tone: "danger" });
		expect(await confirm({ title: "其他", message: "其他" })).toBe(false);
		resolveConfirm(true);
		expect(await pending).toBe(true);
	});

	it("keeps overflow edge state through 1–8px nudges", () => {
		expect(edgeIsOverflowing(4, false)).toBe(false);
		expect(edgeIsOverflowing(4, true)).toBe(true);
		expect(edgeIsOverflowing(1, true)).toBe(false);
		expect(edgeIsOverflowing(9, false)).toBe(true);
	});

	it("selects responsive toast placement classes", () => {
		expect(toastPlacementClass(true)).toBe("preview-toast--phone");
		expect(toastPlacementClass(false)).toBe("preview-toast--desktop");
	});
});
