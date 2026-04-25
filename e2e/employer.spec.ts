import path from "node:path";
import { expect, test } from "@playwright/test";

const SCREENSHOTS = path.resolve(__dirname, "screenshots");

const MOCK_SUCCESS = {
  proof_code: "ZKH-EFGH-5678",
  public_claims: {
    claim_type: "reputable_company",
    claim_value: "true",
    issuer_pubkey: "0xdeadbeef",
  },
};

const MOCK_VERIFY = {
  public_claims: MOCK_SUCCESS.public_claims,
  issued_at: Math.floor(Date.now() / 1000) - 3600,
  expires_at: Math.floor(Date.now() / 1000) + 86400 * 365,
};

const MOCK_GAP_NOT_FOUND = {
  gap: {
    reason: "Company not found in Companies House registry.",
    missing_evidence: ["company_registry_active"],
  },
};

const MOCK_GAP_NO_FUNDING = {
  gap: {
    reason: "Company exists but funding evidence below threshold.",
    missing_evidence: ["funding_bracket_500k_2m"],
  },
};

test.describe("employer portal", () => {
  test("happy path: CH number + URL → credential → verify", async ({
    page,
  }) => {
    await page.route("/api/issue/employer", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_SUCCESS });
    });
    await page.route("/api/verify/ZKH-EFGH-5678", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_VERIFY });
    });

    await page.goto("/employer");
    await expect(page.getByText("Verify Your Company")).toBeVisible();

    await page.getByLabel("Companies House number").fill("00000006");
    await page
      .getByLabel("Supporting URL")
      .fill("https://www.crunchbase.com/organization/sibrox");

    await page.screenshot({
      path: path.join(SCREENSHOTS, "employer-before-submit.png"),
    });

    await page.getByRole("button", { name: /generate credential/i }).click();
    await expect(page.getByText("Credential Issued")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("ZKH-EFGH-5678").first()).toBeVisible();
    await expect(page.getByText("reputable company")).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOTS, "employer-credential-issued.png"),
    });

    await page.goto("/verify/ZKH-EFGH-5678");
    await expect(page.getByText("Reputable Company")).toBeVisible();
    await expect(page.getByText("Valid")).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOTS, "employer-verify-success.png"),
    });
  });

  test("entity not found: gap surfaced", async ({ page }) => {
    await page.route("/api/issue/employer", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_GAP_NOT_FOUND });
    });

    await page.goto("/employer");
    await page.getByLabel("Companies House number").fill("99999999");
    await page.getByLabel("Supporting URL").fill("https://example.com");
    await page.getByRole("button", { name: /generate credential/i }).click();

    await expect(
      page.getByText("Could not issue credential")
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(/not found in Companies House/i)
    ).toBeVisible();
  });

  test("company exists but no funding data: gap surfaced", async ({ page }) => {
    await page.route("/api/issue/employer", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_GAP_NO_FUNDING });
    });

    await page.goto("/employer");
    await page.getByLabel("Companies House number").fill("00000006");
    await page.getByLabel("Supporting URL").fill("https://nofunding.com");
    await page.getByRole("button", { name: /generate credential/i }).click();

    await expect(
      page.getByText("Could not issue credential")
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(/funding evidence below threshold/i)
    ).toBeVisible();
  });
});
