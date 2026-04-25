import path from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURE_CERT = path.resolve(__dirname, "fixtures/sample-certificate.pdf");
const SCREENSHOTS = path.resolve(__dirname, "screenshots");

const MOCK_SUCCESS = {
  proof_code: "ZKH-ABCD-1234",
  public_claims: {
    claim_type: "hackathon_wins",
    claim_value: "1",
    issuer_pubkey: "0xdeadbeef",
  },
};

const MOCK_GAP = {
  gap: {
    reason: "Certificate organiser could not be verified — reputability score below threshold.",
    missing_evidence: ["organizer_reputation_high"],
  },
};

const MOCK_VERIFY = {
  public_claims: MOCK_SUCCESS.public_claims,
  issued_at: Math.floor(Date.now() / 1000) - 3600,
  expires_at: Math.floor(Date.now() / 1000) + 86400 * 365,
};

test.describe("candidate portal", () => {
  test("happy path: upload certificate → get ZKH- code → verify", async ({
    page,
  }) => {
    await page.route("/api/issue/candidate", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_SUCCESS });
    });
    await page.route("/api/verify/ZKH-ABCD-1234", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_VERIFY });
    });

    await page.goto("/candidate");
    await expect(page.getByText("Verify a Hackathon Win")).toBeVisible();

    const input = page.getByLabel("Certificate file");
    await input.setInputFiles(FIXTURE_CERT);

    await page.screenshot({
      path: path.join(SCREENSHOTS, "candidate-before-submit.png"),
    });

    await page.getByRole("button", { name: /generate credential/i }).click();
    await expect(page.getByText("Credential Issued")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("ZKH-ABCD-1234").first()).toBeVisible();
    await expect(page.getByText("hackathon wins: 1")).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOTS, "candidate-credential-issued.png"),
    });

    await page.goto("/verify/ZKH-ABCD-1234");
    await expect(page.getByText("Hackathon Win")).toBeVisible();
    await expect(page.getByText("Valid")).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOTS, "candidate-verify-success.png"),
    });
  });

  test("low reputability: gap surfaced, no proof issued", async ({ page }) => {
    await page.route("/api/issue/candidate", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_GAP });
    });

    await page.goto("/candidate");
    const input = page.getByLabel("Certificate file");
    await input.setInputFiles(FIXTURE_CERT);
    await page.getByRole("button", { name: /generate credential/i }).click();

    await expect(
      page.getByText("Could not issue credential")
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(/reputability score below threshold/i)
    ).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOTS, "candidate-gap-surfaced.png"),
    });
  });

  test("replay rejection: same subject gets 409 from issuer", async ({
    page,
  }) => {
    await page.route("/api/issue/candidate", async (route) => {
      await route.fulfill({
        status: 409,
        json: { error: "NullifierCollisionError: credential already issued for this subject and claim type" },
      });
    });

    await page.goto("/candidate");
    const input = page.getByLabel("Certificate file");
    await input.setInputFiles(FIXTURE_CERT);
    await page.getByRole("button", { name: /generate credential/i }).click();

    await expect(page.getByText(/NullifierCollisionError/i)).toBeVisible({
      timeout: 60_000,
    });
  });
});
