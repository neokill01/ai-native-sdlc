import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConsole } from "../../api/server.js";

test("React console: create, edit, approve, execute after closing the page, and read real evidence", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "devos-web-test-"));
  const app = createConsole({ dataDir, stepDelayMs: 100 });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  let page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "让每项开发任务，有迹可循。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("任务名称").fill("智创码坊 · 移动菜单流程演练");
  await page.getByLabel("需求描述").fill("Mock 仅检查流程，不修改业务代码。");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "智创码坊 · 移动菜单流程演练" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "产物与审批", exact: true }).click();
  await dialog
    .getByLabel("产物内容")
    .fill("经人工编辑：演练独立样例、真实测试与有限修复。");
  await dialog.getByRole("button", { name: "保存产物", exact: true }).click();
  await dialog
    .getByRole("button", { name: "批准需求目标", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "批准验收规格", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "批准执行计划", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "启动 Mock 执行", exact: true })
    .click();
  await page.close();
  // Opening another page does not create a new worker or abort the original job.
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  const row = page.locator("tbody tr").first();
  await expect(row.getByText("已完成", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await row.getByRole("button", { name: "查看报告", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "交付报告", exact: true }).click();
  await expect(
    dialog.getByText("fixture-unit · 第 1 次执行", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("exit 1", { exact: true })).toBeVisible();
  await expect(dialog.getByText("exit 0", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("需求验收：待人工审查", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "关闭任务详情" }).click();
  // Create another real pending record so the screenshot is actual backend state, not painted fixture rows.
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("任务名称").fill("官网体验优化 · 需求确认");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "官网体验优化 · 需求确认" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭任务详情" }).click();
  if (process.env.DEVOS_CAPTURE_UI === "1") {
    const dir = resolve(".devos/console-evidence");
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: join(dir, "console-desktop.png"),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  if (process.env.DEVOS_CAPTURE_UI === "1")
    await page.screenshot({
      path: resolve(".devos/console-evidence/console-mobile.png"),
      fullPage: true,
    });
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "创建开发任务" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.deepEqual(errors, []);
});
