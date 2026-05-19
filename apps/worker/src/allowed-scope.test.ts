import { describe, expect, it } from "vitest";
import { parseAllowedFileScope } from "./allowed-scope.js";

describe("parseAllowedFileScope", () => {
  it("extracts only file paths from Chinese inline descriptions", () => {
    const description = [
      "Assigned work: 前端Vue只读页",
      "允许修改路径: apps/admin-web/src/pages/identity/support-grants.vue, apps/admin-web/tests/e2e/identity-support-grants.spec.js。参考 apps/admin-web/html/support-grant-detail.html 和 apps/admin-web/src/pages/identity/roles.vue 的布局风格；禁止 v-html/raw HTML/Element Plus 组件；页面必须有 loading/error/empty、刷新、租户过滤读取、状态标签、scope/到期时间展示。"
    ].join("\n");

    expect(parseAllowedFileScope(description)).toEqual([
      "apps/admin-web/src/pages/identity/support-grants.vue",
      "apps/admin-web/tests/e2e/identity-support-grants.spec.js"
    ]);
  });

  it("keeps bullet file scopes", () => {
    const description = [
      "允许修改路径:",
      "- apps/admin-api/internal/handler/admin/identity/identity_handler.go",
      "- docs/contracts/admin-api.md"
    ].join("\n");

    expect(parseAllowedFileScope(description)).toEqual([
      "apps/admin-api/internal/handler/admin/identity/identity_handler.go",
      "docs/contracts/admin-api.md"
    ]);
  });

  it("keeps top-level repository directory scopes from bullet lists", () => {
    const description = [
      "允许修改路径:",
      "- migrations/",
      "- features_test/",
      "- docs/specs/",
      "",
      "验收标准: 只允许补 D1 数据基座、BDD 和规格。"
    ].join("\n");

    expect(parseAllowedFileScope(description)).toEqual([
      "docs/specs/",
      "features_test/",
      "migrations/"
    ]);
  });
});
