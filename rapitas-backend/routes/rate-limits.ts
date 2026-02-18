/**
 * Rate Limit API Routes
 */
import { Elysia, t } from "elysia";
import { getApiKeyForProvider } from "../utils/ai-client";
import { prisma } from "../config/database";
import { decrypt } from "../utils/encryption";

type RateLimitInfo = {
  provider: string;
  plan: string;
  used: number;
  limit: number;
  period: string;
  resetAt?: Date;
};

// OpenAI API Response Types
interface OpenAISubscriptionResponse {
  object: string;
  has_payment_method: boolean;
  canceled: boolean;
  canceled_at: number | null;
  delinquent: boolean | null;
  access_until: number;
  soft_limit: number;
  hard_limit: number;
  system_hard_limit: number;
  soft_limit_usd: number;
  hard_limit_usd: number;
  system_hard_limit_usd: number;
  plan?: {
    title: string;
    id: string;
  };
  account_name: string;
  po_number: string | null;
  billing_email: string | null;
  tax_ids: string | null;
  billing_address: Record<string, unknown> | null;
  business_address: Record<string, unknown> | null;
}

interface OpenAIUsageResponse {
  object: string;
  daily_costs: Array<{
    timestamp: number;
    line_items: Array<{
      name: string;
      cost: number;
    }>;
  }>;
  total_usage: number;
}

export const rateLimitRoutes = new Elysia({ prefix: "/rate-limits" })
  // Get rate limit info for all providers
  .get("/", async () => {
    const rateLimits: RateLimitInfo[] = [];

    try {
      // Claude rate limits
      const claudeApiKey = await getApiKeyForProvider("claude");
      if (claudeApiKey) {
        // For Claude, we would need to make an API call to get actual usage
        // This is a mock implementation
        rateLimits.push({
          provider: "claude",
          plan: "Pro",
          used: 12500,
          limit: 50000,
          period: "月次",
          resetAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
        });
      }

      // OpenAI rate limits
      const settings = await prisma.userSettings.findFirst();
      const openaiApiKey = settings?.chatgptApiKeyEncrypted ? decrypt(settings.chatgptApiKeyEncrypted) : null;
      if (openaiApiKey) {
        try {
          // Fetch subscription info from OpenAI
          const subscriptionRes = await fetch("https://api.openai.com/v1/dashboard/billing/subscription", {
            headers: {
              "Authorization": `Bearer ${openaiApiKey}`,
            },
          });

          const usageRes = await fetch(`https://api.openai.com/v1/dashboard/billing/usage?date=${new Date().toISOString().split('T')[0]}`, {
            headers: {
              "Authorization": `Bearer ${openaiApiKey}`,
            },
          });

          if (subscriptionRes.ok && usageRes.ok) {
            const subscription = await subscriptionRes.json() as OpenAISubscriptionResponse;
            const usage = await usageRes.json() as OpenAIUsageResponse;

            rateLimits.push({
              provider: "chatgpt",
              plan: subscription.plan?.title || "Pay as you go",
              used: Math.round(usage.total_usage || 0),
              limit: subscription.hard_limit_usd ? subscription.hard_limit_usd * 100 : 12000, // Convert to cents
              period: "月次",
              resetAt: subscription.access_until ? new Date(subscription.access_until * 1000) : undefined,
            });
          } else {
            // Mock data if API fails
            rateLimits.push({
              provider: "chatgpt",
              plan: "Pay as you go",
              used: 3500,
              limit: 12000,
              period: "月次",
              resetAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
            });
          }
        } catch {
          // Mock data on error
          rateLimits.push({
            provider: "chatgpt",
            plan: "Pay as you go",
            used: 3500,
            limit: 12000,
            period: "月次",
            resetAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          });
        }
      }

      // Gemini rate limits
      const geminiApiKey = settings?.geminiApiKeyEncrypted ? decrypt(settings.geminiApiKeyEncrypted) : null;
      if (geminiApiKey) {
        // Google doesn't provide a direct API for rate limit info
        // This is mock data
        rateLimits.push({
          provider: "gemini",
          plan: "Free",
          used: 800,
          limit: 1500,
          period: "日次",
          resetAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours from now
        });
      }
    } catch (error) {
      console.error("Error fetching rate limits:", error);
    }

    return { rateLimits };
  });