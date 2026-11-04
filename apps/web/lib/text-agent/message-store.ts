import "server-only";
import { getTextTransportDisplayName } from "@/lib/integrations/text-transport";
import type { SupabaseServiceClient, TableRow } from "@/lib/text-agent/store-types";
import type { TextDeliveryEvent, TextInboundMessage, TextTransportProvider, TextWebhookRecord } from "@/lib/integrations/text-transport";
import type { Json } from "@/lib/supabase/types";

const staleWebhookProcessingMinutes = 5;

export async function upsertTextThread(
  supabase: SupabaseServiceClient,
  {
    chatId,
    from,
    phoneNumberId,
    provider,
    status,
    to,
    userId,
  }: {
    chatId: string;
    from: string;
    phoneNumberId: string | null;
    provider: TextTransportProvider;
    status: string;
    to: string;
    userId: string | null;
  },
) {
  const existing = await supabase
    .from("text_threads")
    .select("*")
    .eq("provider", provider)
    .eq("provider_chat_id", chatId)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  if (existing.data) {
    if (existing.data.user_id && userId && existing.data.user_id !== userId) {
      throw new Error(
        `${getTextTransportDisplayName(provider)} chat is already linked to a different Kinfolk user.`,
      );
    }

    const updated = await supabase
      .from("text_threads")
      .update({
        from_phone_e164: from,
        last_message_at: new Date().toISOString(),
        phone_number_id: phoneNumberId ?? existing.data.phone_number_id,
        status,
        to_phone_e164: to,
        user_id: userId ?? existing.data.user_id,
      })
      .eq("id", existing.data.id)
      .select("*")
      .single();

    if (updated.error) {
      throw updated.error;
    }

    return updated.data;
  }

  const inserted = await supabase
    .from("text_threads")
    .insert({
      from_phone_e164: from,
      last_message_at: new Date().toISOString(),
      phone_number_id: phoneNumberId,
      provider,
      provider_chat_id: chatId,
      status,
      to_phone_e164: to,
      user_id: userId,
    })
    .select("*")
    .single();

  // Two concurrent first-contact webhooks race this insert; the loser hits
  // the provider+chat unique index and re-reads the winner's row (the same
  // recovery recordInboundMessage uses).
  if (inserted.error && inserted.error.code === "23505") {
    const winner = await supabase
      .from("text_threads")
      .select("*")
      .eq("provider", provider)
      .eq("provider_chat_id", chatId)
      .single();
    if (winner.error) {
      throw winner.error;
    }
    return winner.data;
  }

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data;
}

export async function recordInboundMessage(
  supabase: SupabaseServiceClient,
  inbound: TextInboundMessage,
  threadId: string,
  userId: string | null,
  phoneNumberId: string | null,
) {
  const result = await supabase
    .from("text_messages")
    .insert({
      body: inbound.body,
      direction: "inbound",
      from_phone_e164: inbound.from,
      media: inbound.media as Json,
      phone_number_id: phoneNumberId,
      provider: inbound.provider,
      provider_chat_id: inbound.chatId,
      provider_event_id: inbound.eventId,
      provider_message_id: inbound.messageId,
      raw_payload: inbound.raw as Json,
      received_at: inbound.receivedAt,
      service: inbound.service,
      thread_id: threadId,
      to_phone_e164: inbound.to,
      user_id: userId,
    })
    .select("*")
    .single();

  if (result.error && result.error.code === "23505") {
    const existing = await supabase
      .from("text_messages")
      .select("*")
      .eq("provider", inbound.provider)
      .eq("provider_event_id", inbound.eventId)
      .single();

    if (existing.error) {
      throw existing.error;
    }

    return existing.data;
  }

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

export async function findInboundMessageByProviderMessageId(
  supabase: SupabaseServiceClient,
  inbound: TextInboundMessage,
): Promise<TableRow<"text_messages"> | null> {
  const existing = await supabase
    .from("text_messages")
    .select("*")
    .eq("provider", inbound.provider)
    .eq("provider_message_id", inbound.messageId)
    .eq("provider_chat_id", inbound.chatId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  return existing.data;
}

export async function hasNonFailedTextAgentRunForMessage(
  supabase: SupabaseServiceClient,
  messageId: string,
) {
  const existing = await supabase
    .from("text_agent_runs")
    .select("id, run_status")
    .eq("message_id", messageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  return Boolean(existing.data && existing.data.run_status !== "failed");
}

export async function recordWebhookEvent(
  supabase: SupabaseServiceClient,
  event: TextWebhookRecord,
) {
  const result = await supabase.from("text_webhook_events").insert({
    event_type: event.eventType,
    provider: event.provider,
    provider_event_id: event.eventId,
    raw_payload: event.raw as Json,
    status: "processing",
    trace_id: event.traceId,
  });

  if (result.error && result.error.code === "23505") {
    const existing = await supabase
      .from("text_webhook_events")
      .select("status,updated_at")
      .eq("provider", event.provider)
      .eq("provider_event_id", event.eventId)
      .maybeSingle();

    if (existing.error) {
      throw existing.error;
    }

    const processingIsFresh =
      existing.data?.status === "processing" &&
      Date.parse(existing.data.updated_at) >
        Date.now() - staleWebhookProcessingMinutes * 60 * 1000;

    if (
      !existing.data ||
      existing.data.status === "processed" ||
      existing.data.status === "ignored" ||
      processingIsFresh
    ) {
      return { duplicate: true };
    }

    const retry = await supabase
      .from("text_webhook_events")
      .update({
        error_message: null,
        event_type: event.eventType,
        processed_at: null,
        raw_payload: event.raw as Json,
        status: "processing",
        trace_id: event.traceId,
      })
      .eq("provider", event.provider)
      .eq("provider_event_id", event.eventId);

    if (retry.error) {
      throw retry.error;
    }

    return { duplicate: false };
  }

  if (result.error) {
    throw result.error;
  }

  return { duplicate: false };
}

export async function updateWebhookEventStatus(
  supabase: SupabaseServiceClient,
  event: TextWebhookRecord,
  status: "processed" | "ignored" | "failed",
  errorMessage?: string,
) {
  const result = await supabase
    .from("text_webhook_events")
    .update({
      error_message: errorMessage ?? null,
      processed_at: new Date().toISOString(),
      status,
    })
    .eq("provider", event.provider)
    .eq("provider_event_id", event.eventId);

  if (result.error) {
    throw result.error;
  }
}

export async function updateMessageDeliveryFromWebhook(
  supabase: SupabaseServiceClient,
  delivery: TextDeliveryEvent | null,
) {
  if (!delivery) {
    return;
  }

  const result = await supabase
    .from("text_messages")
    .update({
      delivery_status: delivery.deliveryStatus,
      raw_payload: delivery.raw as Json,
    })
    .eq("provider", delivery.provider)
    .eq("provider_message_id", delivery.messageId)
    .eq("direction", "outbound");

  if (result.error) {
    throw result.error;
  }
}
