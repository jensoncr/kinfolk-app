import "server-only";
import { chunks } from "@/lib/shared/arrays";
import type { ListingRecommendationCard, SupabaseServiceClient } from "@/lib/text-agent/store-types";
import type { Json } from "@/lib/supabase/types";

export async function persistListingRecommendationCards(
  supabase: SupabaseServiceClient,
  {
    cards,
    idempotencyScope,
    requestedByRunId,
    threadId,
    userId,
  }: {
    cards: ListingRecommendationCard[];
    idempotencyScope: string;
    requestedByRunId: string;
    threadId: string;
    userId: string;
  },
) {
  const recommendations: Array<{
    card: ListingRecommendationCard;
    id: string;
    rank: number;
  }> = [];
  const upserts = await Promise.all(
    cards.map(async (card, index) => {
      const rank = index + 1;
      const idempotencyKey = `kinfolk:${requestedByRunId}:${idempotencyScope}:${card.id}`;
      const upsert = await supabase
        .from("text_listing_recommendations")
        .upsert(
          {
            card_snapshot: card as unknown as Json,
            fit_score: Math.round(card.fitScore),
            listing_id: card.id,
            outbound_idempotency_key: idempotencyKey,
            rank,
            status: "sent",
            thread_id: threadId,
            user_id: userId,
          },
          { onConflict: "user_id,thread_id,listing_id,outbound_idempotency_key" },
        )
        .select("id")
        .single();

      if (upsert.error) {
        throw upsert.error;
      }

      return { card, id: upsert.data.id, rank };
    }),
  );

  recommendations.push(...upserts);

  return recommendations;
}

export async function fetchListingPhotoRows(
  supabase: SupabaseServiceClient,
  listingIds: string[],
) {
  const chunkRows = await Promise.all(
    chunks(listingIds, 100).map(async (listingIdChunk) => {
      const result = await supabase
        .from("apartment_listing_photos")
        .select("listing_id,url,position")
        .in("listing_id", listingIdChunk)
        .order("position", { ascending: true });

      if (result.error) {
        throw result.error;
      }

      return result.data ?? [];
    }),
  );

  return chunkRows.flat();
}

export async function fetchSentListingRecommendationRows(
  supabase: SupabaseServiceClient,
  {
    listingIds,
    userId,
  }: {
    listingIds: string[];
    userId: string;
  },
) {
  const chunkRows = await Promise.all(
    chunks(listingIds, 100).map(async (listingIdChunk) => {
      const result = await supabase
        .from("text_listing_recommendations")
        .select("listing_id,reaction_type")
        .eq("user_id", userId)
        .in("listing_id", listingIdChunk);

      if (result.error) {
        throw result.error;
      }

      return result.data ?? [];
    }),
  );

  return chunkRows.flat();
}
