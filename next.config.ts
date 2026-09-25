import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["pg", "firebase-admin", "@opentelemetry/sdk-node", "@langfuse/otel", "@langfuse/tracing"],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/policy": ["./knowledge/liam-demo-policy.pdf"],
    "/api/labels/*": ["./skills/liam-parcel-exceptions/SKILL.md"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
