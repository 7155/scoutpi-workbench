import assert from "node:assert/strict";
import test from "node:test";
import { translate, translateRole, translateStatus } from "../apps/web/src/i18n.ts";

test("Workbench localization switches stable product labels without changing domain identifiers", () => {
  assert.equal(translate("Evidence graph", {}, "en"), "Evidence graph");
  assert.equal(translate("Evidence graph", {}, "zh-CN"), "证据图谱");
  assert.equal(translate("count.review", { count: 3 }, "en"), "3 review");
  assert.equal(translate("count.review", { count: 3 }, "zh-CN"), "3 项待审核");
  assert.equal(translateRole("built_surface", "zh-CN"), "建成区");
  assert.equal(translateRole("custom_science_role", "zh-CN"), "custom science role");
  assert.equal(translateStatus("blocked_auth", "zh-CN"), "认证阻断");
});
