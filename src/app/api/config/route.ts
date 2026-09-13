import { localMailEnabled } from "@/server/auth";
import { isStructuredModelConfigured } from "@/server/structured-llm";
export function GET() {
  return Response.json({
    interpretationMode: isStructuredModelConfigured()
      ? "provider"
      : "unconfigured",
    localMail: localMailEnabled,
    accountDeliveryMode: localMailEnabled
      ? "local"
      : process.env.MAIL_PROVIDER === "resend" &&
          process.env.RESEND_API_KEY &&
          process.env.MAIL_FROM
        ? "configured"
        : "unconfigured",
  });
}
