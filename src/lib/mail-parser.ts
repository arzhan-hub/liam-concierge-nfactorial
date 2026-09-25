// Email content is untrusted evidence, never a custody or identity confirmation.
export type EmailClaim =
  "Mentioned" | "Shipped" | "Out for delivery" | "Reported delivered";
export type MailCandidate = {
  carrier: string;
  tracking: string;
  claim: EmailClaim;
};

export function emailText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDeliveryEmail(
  subject: string,
  body: string,
): MailCandidate[] {
  const text = emailText(`${subject}\n${body}`).slice(0, 60000);
  // Conservative: only recognize known prefixes or explicitly labelled numbers.
  // Never interpret an Amazon order number, phone number or apartment as tracking.
  const candidates = new Map<string, MailCandidate>();
  const found: { carrier: string; tracking: string }[] = [];
  for (const [carrier, pattern] of [
    ["Amazon", /\bTBA\d{10,16}\b/gi],
    ["UPS", /\b1Z[A-Z0-9]{16}\b/gi],
    ["GOFO", /\bGFUS\d{10,20}\b/gi],
    ["UniUni", /\bUUS[A-Z0-9]{12,24}\b/gi],
    ["SwiftX", /\bSWX\d{12,22}\b/gi],
  ] as const) {
    for (const match of text.matchAll(pattern))
      found.push({ carrier, tracking: match[0].toUpperCase() });
  }
  const labelled =
    /\b(?:tracking(?:\s+(?:number|id|no\.?))?|трек(?:-номер)?)\s*[:#]?\s*((?:\d[ -]?){10,35})(?!\d)/gi;
  for (const match of text.matchAll(labelled)) {
    const tracking = match[1].replace(/[ -]/g, "");
    if (/^9\d{19,25}$/.test(tracking) && /\bUSPS\b/i.test(text))
      found.push({ carrier: "USPS", tracking });
    else if (/^(?:\d{12}|\d{15})$/.test(tracking) && /\bFedEx\b/i.test(text))
      found.push({ carrier: "FedEx", tracking });
    else if (/^\d{10}$/.test(tracking) && /\bDHL\b/i.test(text))
      found.push({ carrier: "DHL", tracking });
  }
  // Only assign an email-level state when exactly one distinct shipment was found.
  // A digest about several parcels may mix delivered and pending items.
  for (const item of found)
    candidates.set(`${item.carrier}:${item.tracking}`, {
      ...item,
      claim: "Mentioned",
    });
  if (candidates.size === 1) {
    const item = [...candidates.values()][0];
    const negative =
      /\b(not (?:yet )?(?:delivered|shipped|out for delivery)|delivery (?:failed|attempt|exception)|could not deliver|undeliverable|hasn.t (?:been delivered|shipped)|will be delivered|expected to be delivered)\b/i.test(
        text,
      );
    if (
      !negative &&
      /\b(?:was|has been|is) delivered\b|\bdelivered today\b|\bpackage delivered\b|\byour (?:package|order) (?:has )?arrived\b/i.test(
        text,
      )
    )
      item.claim = "Reported delivered";
    else if (!negative && /\bout for delivery\b/i.test(text))
      item.claim = "Out for delivery";
    else if (!negative && /\b(?:has |was )?shipped\b/i.test(text))
      item.claim = "Shipped";
  }
  return [...candidates.values()].slice(0, 20);
}

type Part = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: Part[];
};
export function gmailBody(part?: Part): string {
  const pending = part ? [{ part, depth: 0 }] : [];
  let text = "",
    visited = 0;
  while (pending.length && visited++ < 200 && text.length < 60000) {
    const { part: current, depth } = pending.pop()!;
    if (depth > 10 || current.filename) continue; // No attachments or remote content.
    if (
      ["text/plain", "text/html"].includes(current.mimeType || "") &&
      current.body?.data
    )
      text +=
        Buffer.from(current.body.data.slice(0, 100000), "base64url").toString(
          "utf8",
        ) + "\n";
    for (const child of (current.parts || []).slice(0, 30).reverse())
      pending.push({ part: child, depth: depth + 1 });
  }
  return text.slice(0, 60000);
}
