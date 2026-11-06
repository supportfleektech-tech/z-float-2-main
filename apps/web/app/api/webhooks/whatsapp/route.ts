import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@zfloat/config";
import { createHmac } from "node:crypto";

/**
 * WhatsApp Business API webhook endpoint.
 * 
 * GET /api/webhooks/whatsapp - Verify webhook (Meta challenge)
 * POST /api/webhooks/whatsapp - Receive message status updates and inbound messages
 * 
 * Meta sends:
 * - Message status: sent, delivered, read, failed
 * - Inbound messages (if user replies)
 * - Template status updates
 */
export async function GET(request: NextRequest) {
  const config = getConfig();
  const verifyToken = config.WHATSAPP_VERIFY_TOKEN;

  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[whatsapp] Webhook verified successfully");
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  console.warn("[whatsapp] Webhook verification failed");
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const config = getConfig();
  const appSecret = config.WHATSAPP_APP_SECRET;

  // Verify signature if app secret is configured
  if (appSecret) {
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) {
      console.warn("[whatsapp] Missing signature header");
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.text();
    const expectedSignature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;

    if (signature !== expectedSignature) {
      console.warn("[whatsapp] Invalid signature");
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // Re-parse JSON after reading text
    const payload = JSON.parse(body);
    await handleWhatsAppPayload(payload);
    return new NextResponse("OK", { status: 200 });
  }

  // No app secret configured - accept but log warning (dev only)
  console.warn("[whatsapp] No WHATSAPP_APP_SECRET configured - skipping signature verification");
  const payload = await request.json();
  await handleWhatsAppPayload(payload);
  return new NextResponse("OK", { status: 200 });
}

async function handleWhatsAppPayload(payload: unknown): Promise<void> {
  const p = payload as Record<string, unknown>;
  
  // Handle entry array (standard Meta webhook format)
  const entries = p.entry as Array<Record<string, unknown>> | undefined;
  if (!entries) return;

  for (const entry of entries) {
    const changes = entry.changes as Array<Record<string, unknown>> | undefined;
    if (!changes) continue;

    for (const change of changes) {
      const value = change.value as Record<string, unknown> | undefined;
      if (!value) continue;

      // Handle message status updates
      if (value.statuses) {
        const statuses = value.statuses as Array<Record<string, unknown>>;
        for (const status of statuses) {
          await handleMessageStatus(status);
        }
      }

      // Handle inbound messages (user replies)
      if (value.messages) {
        const messages = value.messages as Array<Record<string, unknown>>;
        for (const message of messages) {
          await handleInboundMessage(message, value.metadata as Record<string, unknown> | undefined);
        }
      }

      // Handle template status updates
      if (change.field === "message_template_status_update") {
        await handleTemplateStatusUpdate(value);
      }
    }
  }
}

async function handleMessageStatus(status: Record<string, unknown>): Promise<void> {
  const messageId = String(status.id ?? "");
  const statusType = String(status.status ?? ""); // sent, delivered, read, failed
  const _timestamp = String(status.timestamp ?? "");
  const recipientId = String(status.recipient_id ?? "");
  const _conversationId = status.conversation && typeof status.conversation === "object" && "id" in status.conversation
    ? String((status.conversation as Record<string, unknown>).id)
    : undefined;
  const _pricing = status.pricing as Record<string, unknown> | undefined;
  const _errors = status.errors as Array<Record<string, unknown>> | undefined;

  console.log(`[whatsapp] Message status: ${messageId} -> ${statusType} for ${recipientId}`);

  // Here you could update notification delivery status in DB
  // For now, we just log. In production, you'd update the notifications table
  // to track delivery/read receipts.
}

async function handleInboundMessage(
  message: Record<string, unknown>,
  _metadata?: Record<string, unknown>
): Promise<void> {
  const _messageId = String(message.id ?? "");
  const from = String(message.from ?? "");
  const _timestamp = String(message.timestamp ?? "");
  const type = String(message.type ?? ""); // text, image, document, button, interactive
  const text = message.text as Record<string, unknown> | undefined;

  console.log(`[whatsapp] Inbound message from ${from}: ${type}`);

  // Handle button replies (from template buttons)
  if (type === "interactive") {
    const interactive = message.interactive as Record<string, unknown>;
    const interactiveType = String(interactive?.type ?? "");
    
    if (interactiveType === "button_reply") {
      const buttonReply = interactive.button_reply as Record<string, unknown>;
      const buttonId = String(buttonReply?.id ?? "");
      const buttonTitle = String(buttonReply?.title ?? "");
      
      console.log(`[whatsapp] Button reply: ${buttonId} (${buttonTitle}) from ${from}`);
      
      // Handle approval button clicks
      // Button IDs could be like "approve_<token>" or "reject_<token>"
      if (buttonId.startsWith("approve_")) {
        const token = buttonId.slice("approve_".length);
        await processApprovalToken(token, "APPROVE", from);
      } else if (buttonId.startsWith("reject_")) {
        const token = buttonId.slice("reject_".length);
        await processApprovalToken(token, "REJECT", from);
      }
    } else if (interactiveType === "list_reply") {
      const listReply = interactive.list_reply as Record<string, unknown>;
      const listId = String(listReply?.id ?? "");
      const listTitle = String(listReply?.title ?? "");
      console.log(`[whatsapp] List reply: ${listId} (${listTitle}) from ${from}`);
    }
  }

  // Handle text messages (could be commands like "APPROVE <token>")
  if (type === "text" && text?.body) {
    const body = String(text.body).trim().toUpperCase();
    if (body.startsWith("APPROVE ")) {
      const token = body.slice("APPROVE ".length).trim();
      await processApprovalToken(token, "APPROVE", from);
    } else if (body.startsWith("REJECT ")) {
      const token = body.slice("REJECT ".length).trim();
      await processApprovalToken(token, "REJECT", from);
    }
  }
}

async function processApprovalToken(token: string, decision: "APPROVE" | "REJECT", fromPhone: string): Promise<void> {
  // This would be called from an inbound message/button reply
  // The token should be validated and processed
  // For security, we don't process directly here but log for manual review
  // In production, you'd call the approval service
  console.log(`[whatsapp] Approval action via chat: ${decision} token=${token} from=${fromPhone}`);
  // TODO: Integrate with approval service when user replies via WhatsApp chat
}

async function handleTemplateStatusUpdate(value: Record<string, unknown>): Promise<void> {
  const templateName = String(value.template_name ?? "");
  const status = String(value.status ?? ""); // approved, rejected, pending
  const reason = String(value.reason ?? "");
  
  console.log(`[whatsapp] Template status: ${templateName} -> ${status}${reason ? ` (${reason})` : ""}`);
}

export const dynamic = "force-dynamic";