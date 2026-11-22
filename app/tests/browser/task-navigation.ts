import { expect, type Locator, type Page } from "@playwright/test";

// Use the producer's real disclosure controls; never force actions or alter DOM visibility.
export async function expandDisclosure(details: Locator) {
  await expect(details).toHaveCount(1);
  const summary = details.locator(":scope > summary");
  await expect(summary).toBeVisible();
  if ((await details.getAttribute("open")) === null) await summary.click();
  await expect(details).toHaveAttribute("open", "");
}

export async function openTaskRegistration(page: Page, advanced = false) {
  const registration = page.locator("details.card").filter({
    has: page.getByText("手动登记任务（通常直接在会话中安排即可）", { exact: true }),
  });
  if ((await registration.getAttribute("open")) === null)
    await expect(page.getByLabel("任务标题")).toBeHidden();
  await expandDisclosure(registration);
  await expect(page.getByLabel("任务标题")).toBeVisible();
  if (advanced) {
    const options = registration.locator("details.task-advanced");
    if ((await options.getAttribute("open")) === null)
      await expect(page.getByLabel("执行方式")).toBeHidden();
    await expandDisclosure(options);
    await expect(page.getByLabel("执行方式")).toBeVisible();
  }
}

export async function openTaskCard(page: Page, title: string) {
  const card = page.locator(".task-card").filter({
    has: page.getByText(title, { exact: true }),
  });
  await expect(card).toBeVisible();
  const button=card.getByRole("button",{name:"查看详情",exact:true});
  if(await button.count())await button.click();
  await expect(card.locator(".task-expanded")).toBeVisible();
  return card;
}
