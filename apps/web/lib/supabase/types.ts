export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_action_log: {
        Row: {
          agent_identifier: string
          approval_state: string
          called_at: string
          id: string
          input_hash: string | null
          result_summary: string | null
          tool_called: string
          user_id: string
        }
        Insert: {
          agent_identifier: string
          approval_state?: string
          called_at?: string
          id?: string
          input_hash?: string | null
          result_summary?: string | null
          tool_called: string
          user_id: string
        }
        Update: {
          agent_identifier?: string
          approval_state?: string
          called_at?: string
          id?: string
          input_hash?: string | null
          result_summary?: string | null
          tool_called?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_action_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_context_documents: {
        Row: {
          body: string
          content_hash: string
          created_at: string
          embedding: string | null
          embedding_model: string | null
          entity_id: string
          entity_type: string
          group_id: string | null
          id: string
          listing_id: string | null
          metadata: Json
          owner_user_id: string | null
          refreshed_at: string
          search_vector: unknown
          source_updated_at: string | null
          source_version: string
          status: string
          subject_user_id: string | null
          summary: string
          thread_id: string | null
          title: string
          unit_id: string | null
          updated_at: string
          visibility_scope: string
        }
        Insert: {
          body?: string
          content_hash: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          entity_id: string
          entity_type: string
          group_id?: string | null
          id?: string
          listing_id?: string | null
          metadata?: Json
          owner_user_id?: string | null
          refreshed_at?: string
          search_vector?: unknown
          source_updated_at?: string | null
          source_version?: string
          status?: string
          subject_user_id?: string | null
          summary?: string
          thread_id?: string | null
          title?: string
          unit_id?: string | null
          updated_at?: string
          visibility_scope?: string
        }
        Update: {
          body?: string
          content_hash?: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          entity_id?: string
          entity_type?: string
          group_id?: string | null
          id?: string
          listing_id?: string | null
          metadata?: Json
          owner_user_id?: string | null
          refreshed_at?: string
          search_vector?: unknown
          source_updated_at?: string | null
          source_version?: string
          status?: string
          subject_user_id?: string | null
          summary?: string
          thread_id?: string | null
          title?: string
          unit_id?: string | null
          updated_at?: string
          visibility_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_context_documents_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "apartment_roommate_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_documents_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_documents_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_documents_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_documents_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "text_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_documents_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "apartment_listing_units"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_context_evidence: {
        Row: {
          claim_key: string
          claim_text: string
          confidence: number
          created_at: string
          document_id: string
          evidence_excerpt: string | null
          external_id: string | null
          external_source: string | null
          extracted_at: string
          group_id: string | null
          id: string
          is_user_confirmed: boolean
          listing_id: string | null
          matching_eligible: boolean
          metadata: Json
          observed_at: string | null
          provider_payload_hash: string | null
          sensitivity_level: string
          source_column: string | null
          source_fact_ids: string[]
          source_import_id: string | null
          source_json_path: string | null
          source_pk: string | null
          source_table: string | null
          source_url: string | null
          text_message_id: string | null
          thread_id: string | null
          unit_id: string | null
        }
        Insert: {
          claim_key: string
          claim_text: string
          confidence?: number
          created_at?: string
          document_id: string
          evidence_excerpt?: string | null
          external_id?: string | null
          external_source?: string | null
          extracted_at?: string
          group_id?: string | null
          id?: string
          is_user_confirmed?: boolean
          listing_id?: string | null
          matching_eligible?: boolean
          metadata?: Json
          observed_at?: string | null
          provider_payload_hash?: string | null
          sensitivity_level?: string
          source_column?: string | null
          source_fact_ids?: string[]
          source_import_id?: string | null
          source_json_path?: string | null
          source_pk?: string | null
          source_table?: string | null
          source_url?: string | null
          text_message_id?: string | null
          thread_id?: string | null
          unit_id?: string | null
        }
        Update: {
          claim_key?: string
          claim_text?: string
          confidence?: number
          created_at?: string
          document_id?: string
          evidence_excerpt?: string | null
          external_id?: string | null
          external_source?: string | null
          extracted_at?: string
          group_id?: string | null
          id?: string
          is_user_confirmed?: boolean
          listing_id?: string | null
          matching_eligible?: boolean
          metadata?: Json
          observed_at?: string | null
          provider_payload_hash?: string | null
          sensitivity_level?: string
          source_column?: string | null
          source_fact_ids?: string[]
          source_import_id?: string | null
          source_json_path?: string | null
          source_pk?: string | null
          source_table?: string | null
          source_url?: string | null
          text_message_id?: string | null
          thread_id?: string | null
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_context_evidence_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "agent_context_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_evidence_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "apartment_roommate_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_evidence_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_evidence_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "profile_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_evidence_text_message_id_fkey"
            columns: ["text_message_id"]
            isOneToOne: false
            referencedRelation: "text_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_evidence_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "text_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_context_evidence_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "apartment_listing_units"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_delegation_consents: {
        Row: {
          agent_identifier: string
          created_at: string
          expires_at: string | null
          granted_at: string
          granted_scopes: string[]
          id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          agent_identifier: string
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          granted_scopes?: string[]
          id?: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          agent_identifier?: string
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          granted_scopes?: string[]
          id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_delegation_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      apartment_listing_ingestion_runs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          listings_marked_inactive: number
          listings_seen: number
          listings_upserted: number
          market: string
          metadata: Json
          pages_fetched: number
          provider: string
          requested_at: string
          source_url: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          listings_marked_inactive?: number
          listings_seen?: number
          listings_upserted?: number
          market: string
          metadata?: Json
          pages_fetched?: number
          provider: string
          requested_at?: string
          source_url?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          listings_marked_inactive?: number
          listings_seen?: number
          listings_upserted?: number
          market?: string
          metadata?: Json
          pages_fetched?: number
          provider?: string
          requested_at?: string
          source_url?: string | null
          status?: string
        }
        Relationships: []
      }
      apartment_listing_matches: {
        Row: {
          created_at: string
          effective_per_person_rent: number
          evidence: Json
          fit_score: number
          id: string
          listing_id: string
          per_person_rent: number
          profile_id: string | null
          recommended_household_size: number
          split_breakdown: Json
          split_strategy: string
          status: string
          tradeoffs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          effective_per_person_rent: number
          evidence?: Json
          fit_score?: number
          id?: string
          listing_id: string
          per_person_rent: number
          profile_id?: string | null
          recommended_household_size?: number
          split_breakdown?: Json
          split_strategy?: string
          status?: string
          tradeoffs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          effective_per_person_rent?: number
          evidence?: Json
          fit_score?: number
          id?: string
          listing_id?: string
          per_person_rent?: number
          profile_id?: string | null
          recommended_household_size?: number
          split_breakdown?: Json
          split_strategy?: string
          status?: string
          tradeoffs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apartment_listing_matches_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apartment_listing_matches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "matching_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apartment_listing_matches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      apartment_listing_photos: {
        Row: {
          alt: string | null
          created_at: string
          height: number | null
          id: string
          listing_id: string
          position: number
          provider_payload: Json
          provider_photo_id: string | null
          url: string
          width: number | null
        }
        Insert: {
          alt?: string | null
          created_at?: string
          height?: number | null
          id?: string
          listing_id: string
          position?: number
          provider_payload?: Json
          provider_photo_id?: string | null
          url: string
          width?: number | null
        }
        Update: {
          alt?: string | null
          created_at?: string
          height?: number | null
          id?: string
          listing_id?: string
          position?: number
          provider_payload?: Json
          provider_photo_id?: string | null
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "apartment_listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      apartment_listing_units: {
        Row: {
          amenities: string[]
          available_at: string | null
          bathrooms: number | null
          bedrooms: number | null
          concession_lease_months: number
          concession_months: number
          concession_note: string | null
          created_at: string
          deposit: number | null
          effective_monthly_rent: number | null
          first_seen_at: string
          id: string
          inactive_at: string | null
          last_seen_at: string
          listing_id: string
          monthly_rent: number | null
          provider_payload: Json
          provider_payload_hash: string | null
          provider_unit_id: string
          square_feet: number | null
          unit_name: string | null
          unit_status: string
          updated_at: string
        }
        Insert: {
          amenities?: string[]
          available_at?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          concession_lease_months?: number
          concession_months?: number
          concession_note?: string | null
          created_at?: string
          deposit?: number | null
          effective_monthly_rent?: number | null
          first_seen_at?: string
          id?: string
          inactive_at?: string | null
          last_seen_at?: string
          listing_id: string
          monthly_rent?: number | null
          provider_payload?: Json
          provider_payload_hash?: string | null
          provider_unit_id: string
          square_feet?: number | null
          unit_name?: string | null
          unit_status?: string
          updated_at?: string
        }
        Update: {
          amenities?: string[]
          available_at?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          concession_lease_months?: number
          concession_months?: number
          concession_note?: string | null
          created_at?: string
          deposit?: number | null
          effective_monthly_rent?: number | null
          first_seen_at?: string
          id?: string
          inactive_at?: string | null
          last_seen_at?: string
          listing_id?: string
          monthly_rent?: number | null
          provider_payload?: Json
          provider_payload_hash?: string | null
          provider_unit_id?: string
          square_feet?: number | null
          unit_name?: string | null
          unit_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "apartment_listing_units_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      apartment_listings: {
        Row: {
          address_line: string
          amenities: string[]
          available_at: string | null
          bathrooms: number | null
          bathrooms_max: number | null
          bathrooms_min: number | null
          bedrooms: number | null
          bedrooms_max: number | null
          bedrooms_min: number | null
          city: string
          concession_lease_months: number
          concession_months: number
          concession_note: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          description: string | null
          detail_enriched_at: string | null
          detail_enrichment_error: string | null
          detail_enrichment_status: string
          effective_monthly_rent: number | null
          external_id: string
          external_source: string
          first_seen_at: string
          id: string
          inactive_at: string | null
          ingestion_run_id: string | null
          last_seen_at: string
          latitude: number | null
          lease_terms: string[] | null
          listing_status: string
          longitude: number | null
          monthly_rent: number | null
          neighborhood: string | null
          no_fee: boolean
          poi_enriched_at: string | null
          poi_summary: Json | null
          postal_code: string | null
          property_type: string
          provider_detail_payload: Json
          provider_detail_payload_hash: string | null
          provider_market: string
          provider_payload: Json
          provider_payload_hash: string | null
          rent_max: number | null
          rent_min: number | null
          scraped_at: string
          source_updated_at: string | null
          source_url: string | null
          square_feet: number | null
          state: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          address_line: string
          amenities?: string[]
          available_at?: string | null
          bathrooms?: number | null
          bathrooms_max?: number | null
          bathrooms_min?: number | null
          bedrooms?: number | null
          bedrooms_max?: number | null
          bedrooms_min?: number | null
          city: string
          concession_lease_months?: number
          concession_months?: number
          concession_note?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          detail_enriched_at?: string | null
          detail_enrichment_error?: string | null
          detail_enrichment_status?: string
          effective_monthly_rent?: number | null
          external_id: string
          external_source: string
          first_seen_at?: string
          id?: string
          inactive_at?: string | null
          ingestion_run_id?: string | null
          last_seen_at?: string
          latitude?: number | null
          lease_terms?: string[] | null
          listing_status?: string
          longitude?: number | null
          monthly_rent?: number | null
          neighborhood?: string | null
          no_fee?: boolean
          poi_enriched_at?: string | null
          poi_summary?: Json | null
          postal_code?: string | null
          property_type?: string
          provider_detail_payload?: Json
          provider_detail_payload_hash?: string | null
          provider_market?: string
          provider_payload?: Json
          provider_payload_hash?: string | null
          rent_max?: number | null
          rent_min?: number | null
          scraped_at?: string
          source_updated_at?: string | null
          source_url?: string | null
          square_feet?: number | null
          state: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          address_line?: string
          amenities?: string[]
          available_at?: string | null
          bathrooms?: number | null
          bathrooms_max?: number | null
          bathrooms_min?: number | null
          bedrooms?: number | null
          bedrooms_max?: number | null
          bedrooms_min?: number | null
          city?: string
          concession_lease_months?: number
          concession_months?: number
          concession_note?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          detail_enriched_at?: string | null
          detail_enrichment_error?: string | null
          detail_enrichment_status?: string
          effective_monthly_rent?: number | null
          external_id?: string
          external_source?: string
          first_seen_at?: string
          id?: string
          inactive_at?: string | null
          ingestion_run_id?: string | null
          last_seen_at?: string
          latitude?: number | null
          lease_terms?: string[] | null
          listing_status?: string
          longitude?: number | null
          monthly_rent?: number | null
          neighborhood?: string | null
          no_fee?: boolean
          poi_enriched_at?: string | null
          poi_summary?: Json | null
          postal_code?: string | null
          property_type?: string
          provider_detail_payload?: Json
          provider_detail_payload_hash?: string | null
          provider_market?: string
          provider_payload?: Json
          provider_payload_hash?: string | null
          rent_max?: number | null
          rent_min?: number | null
          scraped_at?: string
          source_updated_at?: string | null
          source_url?: string | null
          square_feet?: number | null
          state?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      apartment_roommate_group_memberships: {
        Row: {
          approved_at: string | null
          created_at: string
          group_id: string
          id: string
          left_at: string | null
          requested_at: string
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          group_id: string
          id?: string
          left_at?: string | null
          requested_at?: string
          role?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          group_id?: string
          id?: string
          left_at?: string | null
          requested_at?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apartment_roommate_group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "apartment_roommate_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apartment_roommate_group_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      apartment_roommate_groups: {
        Row: {
          bedrooms: number | null
          created_at: string
          created_by_user_id: string | null
          floor_plan_key: string
          floor_plan_name: string
          id: string
          listing_id: string
          match_summary: string | null
          max_size: number
          monthly_rent: number | null
          preferences: Json
          seed_key: string | null
          source: string
          status: string
          target_unit_name: string | null
          updated_at: string
        }
        Insert: {
          bedrooms?: number | null
          created_at?: string
          created_by_user_id?: string | null
          floor_plan_key: string
          floor_plan_name: string
          id?: string
          listing_id: string
          match_summary?: string | null
          max_size: number
          monthly_rent?: number | null
          preferences?: Json
          seed_key?: string | null
          source?: string
          status?: string
          target_unit_name?: string | null
          updated_at?: string
        }
        Update: {
          bedrooms?: number | null
          created_at?: string
          created_by_user_id?: string | null
          floor_plan_key?: string
          floor_plan_name?: string
          id?: string
          listing_id?: string
          match_summary?: string | null
          max_size?: number
          monthly_rent?: number | null
          preferences?: Json
          seed_key?: string | null
          source?: string
          status?: string
          target_unit_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "apartment_roommate_groups_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apartment_roommate_groups_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          agent_run_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          metadata: Json
          room_id: string
          sender_user_id: string | null
          sent_via: string
          source_text_message_id: string | null
        }
        Insert: {
          agent_run_id?: string | null
          body: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          metadata?: Json
          room_id: string
          sender_user_id?: string | null
          sent_via?: string
          source_text_message_id?: string | null
        }
        Update: {
          agent_run_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          metadata?: Json
          room_id?: string
          sender_user_id?: string | null
          sent_via?: string
          source_text_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "text_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_source_text_message_id_fkey"
            columns: ["source_text_message_id"]
            isOneToOne: false
            referencedRelation: "text_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_room_members: {
        Row: {
          created_at: string
          history_visible_from: string
          id: string
          joined_at: string
          last_notified_message_id: string | null
          last_read_at: string | null
          last_text_notified_at: string | null
          left_at: string | null
          role: string
          room_id: string
          status: string
          text_notifications_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          history_visible_from?: string
          id?: string
          joined_at?: string
          last_notified_message_id?: string | null
          last_read_at?: string | null
          last_text_notified_at?: string | null
          left_at?: string | null
          role?: string
          room_id: string
          status?: string
          text_notifications_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          history_visible_from?: string
          id?: string
          joined_at?: string
          last_notified_message_id?: string | null
          last_read_at?: string | null
          last_text_notified_at?: string | null
          left_at?: string | null
          role?: string
          room_id?: string
          status?: string
          text_notifications_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_room_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_rooms: {
        Row: {
          apartment_group_id: string | null
          compatibility_edge_id: string | null
          created_at: string
          id: string
          listing_id: string | null
          room_type: string
          status: string
          updated_at: string
        }
        Insert: {
          apartment_group_id?: string | null
          compatibility_edge_id?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          room_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          apartment_group_id?: string | null
          compatibility_edge_id?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          room_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_rooms_apartment_group_id_fkey"
            columns: ["apartment_group_id"]
            isOneToOne: false
            referencedRelation: "apartment_roommate_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_rooms_compatibility_edge_id_fkey"
            columns: ["compatibility_edge_id"]
            isOneToOne: false
            referencedRelation: "compatibility_edges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_rooms_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      compatibility_edges: {
        Row: {
          computed_at: string
          created_at: string
          evidence: Json
          id: string
          risks: Json
          score: number
          score_components: Json
          status: string
          updated_at: string
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          evidence?: Json
          id?: string
          risks?: Json
          score: number
          score_components?: Json
          status?: string
          updated_at?: string
          user_a_id: string
          user_b_id: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          evidence?: Json
          id?: string
          risks?: Json
          score?: number
          score_components?: Json
          status?: string
          updated_at?: string
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compatibility_edges_user_a_id_fkey"
            columns: ["user_a_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compatibility_edges_user_b_id_fkey"
            columns: ["user_b_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_import_batches: {
        Row: {
          consent_text: string
          contact_count: number
          created_at: string
          id: string
          imported_at: string
          selected_count: number
          source: string
          source_metadata: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          consent_text?: string
          contact_count?: number
          created_at?: string
          id?: string
          imported_at?: string
          selected_count?: number
          source?: string
          source_metadata?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          consent_text?: string
          contact_count?: number
          created_at?: string
          id?: string
          imported_at?: string
          selected_count?: number
          source?: string
          source_metadata?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_import_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      housing_preferences: {
        Row: {
          commute_notes: string | null
          created_at: string
          dealbreakers: string[]
          flexibility_notes: string | null
          id: string
          must_haves: string[]
          neighborhoods: string[]
          pets: string | null
          preference_embedding: string | null
          profile_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          commute_notes?: string | null
          created_at?: string
          dealbreakers?: string[]
          flexibility_notes?: string | null
          id?: string
          must_haves?: string[]
          neighborhoods?: string[]
          pets?: string | null
          preference_embedding?: string | null
          profile_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          commute_notes?: string | null
          created_at?: string
          dealbreakers?: string[]
          flexibility_notes?: string | null
          id?: string
          must_haves?: string[]
          neighborhoods?: string[]
          pets?: string | null
          preference_embedding?: string | null
          profile_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "housing_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "matching_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      kinfolk_social_edges: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          edge_type: string
          evidence: Json
          id: string
          source_contact_id: string | null
          status: string
          strength: number
          updated_at: string
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          edge_type?: string
          evidence?: Json
          id?: string
          source_contact_id?: string | null
          status?: string
          strength?: number
          updated_at?: string
          user_a_id: string
          user_b_id: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          edge_type?: string
          evidence?: Json
          id?: string
          source_contact_id?: string | null
          status?: string
          strength?: number
          updated_at?: string
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kinfolk_social_edges_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kinfolk_social_edges_source_contact_id_fkey"
            columns: ["source_contact_id"]
            isOneToOne: false
            referencedRelation: "user_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kinfolk_social_edges_user_a_id_fkey"
            columns: ["user_a_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kinfolk_social_edges_user_b_id_fkey"
            columns: ["user_b_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      kinfolk_user_photos: {
        Row: {
          content_type: string | null
          created_at: string
          height: number | null
          id: string
          is_primary: boolean
          position: number
          public_url: string
          storage_path: string
          updated_at: string
          user_id: string
          width: number | null
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          height?: number | null
          id?: string
          is_primary?: boolean
          position?: number
          public_url: string
          storage_path: string
          updated_at?: string
          user_id: string
          width?: number | null
        }
        Update: {
          content_type?: string | null
          created_at?: string
          height?: number | null
          id?: string
          is_primary?: boolean
          position?: number
          public_url?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kinfolk_user_photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      kinfolk_users: {
        Row: {
          about_text: string | null
          birth_year: number | null
          clerk_user_id: string | null
          created_at: string
          date_of_birth: string | null
          display_name: string
          education_degree: string | null
          education_major: string | null
          education_school: string | null
          education_school_domain: string | null
          education_school_logo_url: string | null
          education_summary: string | null
          education_year: string | null
          email: string | null
          hometown: string | null
          id: string
          interests: string[]
          launch_market: string
          linkedin_url: string | null
          occupation_company: string | null
          occupation_company_domain: string | null
          occupation_company_logo_url: string | null
          occupation_title: string | null
          phone_e164: string | null
          phone_verified_at: string | null
          updated_at: string
        }
        Insert: {
          about_text?: string | null
          birth_year?: number | null
          clerk_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name: string
          education_degree?: string | null
          education_major?: string | null
          education_school?: string | null
          education_school_domain?: string | null
          education_school_logo_url?: string | null
          education_summary?: string | null
          education_year?: string | null
          email?: string | null
          hometown?: string | null
          id?: string
          interests?: string[]
          launch_market?: string
          linkedin_url?: string | null
          occupation_company?: string | null
          occupation_company_domain?: string | null
          occupation_company_logo_url?: string | null
          occupation_title?: string | null
          phone_e164?: string | null
          phone_verified_at?: string | null
          updated_at?: string
        }
        Update: {
          about_text?: string | null
          birth_year?: number | null
          clerk_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name?: string
          education_degree?: string | null
          education_major?: string | null
          education_school?: string | null
          education_school_domain?: string | null
          education_school_logo_url?: string | null
          education_summary?: string | null
          education_year?: string | null
          email?: string | null
          hometown?: string | null
          id?: string
          interests?: string[]
          launch_market?: string
          linkedin_url?: string | null
          occupation_company?: string | null
          occupation_company_domain?: string | null
          occupation_company_logo_url?: string | null
          occupation_title?: string | null
          phone_e164?: string | null
          phone_verified_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      linkedin_enrichment_jobs: {
        Row: {
          attempt_count: number
          clerk_user_id: string
          completed_at: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          idempotency_key: string
          image_url: string | null
          last_error: string | null
          linkedin_url: string | null
          locked_at: string | null
          next_attempt_at: string
          provider_user_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          clerk_user_id: string
          completed_at?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          idempotency_key: string
          image_url?: string | null
          last_error?: string | null
          linkedin_url?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          provider_user_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          clerk_user_id?: string
          completed_at?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          idempotency_key?: string
          image_url?: string | null
          last_error?: string | null
          linkedin_url?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          provider_user_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_enrichment_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      living_plans: {
        Row: {
          created_at: string
          future_cities: string[]
          id: string
          intent_confirmed_at: string | null
          intent_note: string | null
          move_horizon: string | null
          preferred_areas: string[]
          relocation_flexibility: string | null
          silent_matcher_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          future_cities?: string[]
          id?: string
          intent_confirmed_at?: string | null
          intent_note?: string | null
          move_horizon?: string | null
          preferred_areas?: string[]
          relocation_flexibility?: string | null
          silent_matcher_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          future_cities?: string[]
          id?: string
          intent_confirmed_at?: string | null
          intent_note?: string | null
          move_horizon?: string | null
          preferred_areas?: string[]
          relocation_flexibility?: string | null
          silent_matcher_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "living_plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      match_feedback_events: {
        Row: {
          actor_user_id: string
          compatibility_edge_id: string | null
          created_at: string
          event_type: string
          free_text: string | null
          id: string
          match_id: string | null
          reason_codes: string[]
        }
        Insert: {
          actor_user_id: string
          compatibility_edge_id?: string | null
          created_at?: string
          event_type: string
          free_text?: string | null
          id?: string
          match_id?: string | null
          reason_codes?: string[]
        }
        Update: {
          actor_user_id?: string
          compatibility_edge_id?: string | null
          created_at?: string
          event_type?: string
          free_text?: string | null
          id?: string
          match_id?: string | null
          reason_codes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "match_feedback_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_feedback_events_compatibility_edge_id_fkey"
            columns: ["compatibility_edge_id"]
            isOneToOne: false
            referencedRelation: "compatibility_edges"
            referencedColumns: ["id"]
          },
        ]
      }
      match_queue_items: {
        Row: {
          candidate_type: string
          created_at: string
          evidence: Json
          expires_at: string | null
          fit_score: number
          id: string
          monthly_rent: number | null
          next_action: string | null
          profile_id: string | null
          status: string
          subtitle: string
          title: string
          tradeoffs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_type: string
          created_at?: string
          evidence?: Json
          expires_at?: string | null
          fit_score?: number
          id?: string
          monthly_rent?: number | null
          next_action?: string | null
          profile_id?: string | null
          status?: string
          subtitle: string
          title: string
          tradeoffs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_type?: string
          created_at?: string
          evidence?: Json
          expires_at?: string | null
          fit_score?: number
          id?: string
          monthly_rent?: number | null
          next_action?: string | null
          profile_id?: string | null
          status?: string
          subtitle?: string
          title?: string
          tradeoffs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_queue_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "matching_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_queue_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      match_notification_prefs: {
        Row: {
          apartment_matches_enabled: boolean
          created_at: string
          daily_send_cap: number
          group_ready_enabled: boolean
          profile_questions_enabled: boolean
          quiet_hours_end: number
          quiet_hours_start: number
          roommate_matches_enabled: boolean
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          apartment_matches_enabled?: boolean
          created_at?: string
          daily_send_cap?: number
          group_ready_enabled?: boolean
          profile_questions_enabled?: boolean
          quiet_hours_end?: number
          quiet_hours_start?: number
          roommate_matches_enabled?: boolean
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          apartment_matches_enabled?: boolean
          created_at?: string
          daily_send_cap?: number
          group_ready_enabled?: boolean
          profile_questions_enabled?: boolean
          quiet_hours_end?: number
          quiet_hours_start?: number
          roommate_matches_enabled?: boolean
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      match_notifications: {
        Row: {
          card_snapshot: Json | null
          created_at: string
          id: string
          kind: string
          outbound_idempotency_key: string
          outbound_message_id: string | null
          recipient_user_id: string
          status: string
          subject_id: string | null
          thread_id: string | null
          updated_at: string
        }
        Insert: {
          card_snapshot?: Json | null
          created_at?: string
          id?: string
          kind: string
          outbound_idempotency_key: string
          outbound_message_id?: string | null
          recipient_user_id: string
          status?: string
          subject_id?: string | null
          thread_id?: string | null
          updated_at?: string
        }
        Update: {
          card_snapshot?: Json | null
          created_at?: string
          id?: string
          kind?: string
          outbound_idempotency_key?: string
          outbound_message_id?: string | null
          recipient_user_id?: string
          status?: string
          subject_id?: string | null
          thread_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_notifications_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "text_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      matching_interviews: {
        Row: {
          channel: string
          completed_at: string | null
          consent_recorded_at: string | null
          created_at: string
          extraction_status: string
          id: string
          profile_id: string | null
          started_at: string | null
          status: string
          summary: string | null
          transcript_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string
          completed_at?: string | null
          consent_recorded_at?: string | null
          created_at?: string
          extraction_status?: string
          id?: string
          profile_id?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          transcript_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          completed_at?: string | null
          consent_recorded_at?: string | null
          created_at?: string
          extraction_status?: string
          id?: string
          profile_id?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          transcript_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matching_interviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "matching_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matching_interviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      matching_profiles: {
        Row: {
          budget_max: number | null
          budget_min: number | null
          completeness_score: number
          created_at: string
          household_size_max: number
          household_size_min: number
          id: string
          move_in_end: string | null
          move_in_start: string | null
          status: string
          target_markets: string[]
          updated_at: string
          user_id: string
          visibility_mode: string
        }
        Insert: {
          budget_max?: number | null
          budget_min?: number | null
          completeness_score?: number
          created_at?: string
          household_size_max?: number
          household_size_min?: number
          id?: string
          move_in_end?: string | null
          move_in_start?: string | null
          status?: string
          target_markets?: string[]
          updated_at?: string
          user_id: string
          visibility_mode?: string
        }
        Update: {
          budget_max?: number | null
          budget_min?: number | null
          completeness_score?: number
          created_at?: string
          household_size_max?: number
          household_size_min?: number
          id?: string
          move_in_end?: string | null
          move_in_start?: string | null
          status?: string
          target_markets?: string[]
          updated_at?: string
          user_id?: string
          visibility_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "matching_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      neighborhood_profiles: {
        Row: {
          bedroom_distribution: Json
          common_amenities: string[]
          created_at: string
          display_name: string
          id: string
          latitude: number | null
          listing_count: number
          longitude: number | null
          market: string
          median_rent: number | null
          name: string
          poi_enriched_at: string | null
          poi_summary: Json | null
          rent_max: number | null
          rent_min: number | null
          stats_computed_at: string | null
          updated_at: string
        }
        Insert: {
          bedroom_distribution?: Json
          common_amenities?: string[]
          created_at?: string
          display_name: string
          id?: string
          latitude?: number | null
          listing_count?: number
          longitude?: number | null
          market: string
          median_rent?: number | null
          name: string
          poi_enriched_at?: string | null
          poi_summary?: Json | null
          rent_max?: number | null
          rent_min?: number | null
          stats_computed_at?: string | null
          updated_at?: string
        }
        Update: {
          bedroom_distribution?: Json
          common_amenities?: string[]
          created_at?: string
          display_name?: string
          id?: string
          latitude?: number | null
          listing_count?: number
          longitude?: number | null
          market?: string
          median_rent?: number | null
          name?: string
          poi_enriched_at?: string | null
          poi_summary?: Json | null
          rent_max?: number | null
          rent_min?: number | null
          stats_computed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      phone_verification_challenges: {
        Row: {
          attempt_count: number
          code_hash: string
          code_hint: string
          created_at: string
          expires_at: string
          id: string
          phone_number_id: string | null
          provider: string
          updated_at: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          attempt_count?: number
          code_hash: string
          code_hint: string
          created_at?: string
          expires_at: string
          id?: string
          phone_number_id?: string | null
          provider?: string
          updated_at?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          attempt_count?: number
          code_hash?: string
          code_hint?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone_number_id?: string | null
          provider?: string
          updated_at?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_verification_challenges_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "user_phone_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_verification_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_profiles: {
        Row: {
          created_at: string
          education: Json
          enriched_at: string | null
          enrichment_status: string
          experiences: Json
          headline: string | null
          id: string
          last_enrichment_error: string | null
          linkedin_provider_user_id: string | null
          linkedin_url: string | null
          recent_interactions: string[]
          resume_status: string
          review_status: string
          salary_target: number | null
          source_confidence: number | null
          source_provider: string | null
          start_date: string
          startup_grind: string
          updated_at: string
          user_id: string
          work_mode: string
        }
        Insert: {
          created_at?: string
          education?: Json
          enriched_at?: string | null
          enrichment_status?: string
          experiences?: Json
          headline?: string | null
          id?: string
          last_enrichment_error?: string | null
          linkedin_provider_user_id?: string | null
          linkedin_url?: string | null
          recent_interactions?: string[]
          resume_status?: string
          review_status?: string
          salary_target?: number | null
          source_confidence?: number | null
          source_provider?: string | null
          start_date?: string
          startup_grind?: string
          updated_at?: string
          user_id: string
          work_mode?: string
        }
        Update: {
          created_at?: string
          education?: Json
          enriched_at?: string | null
          enrichment_status?: string
          experiences?: Json
          headline?: string | null
          id?: string
          last_enrichment_error?: string | null
          linkedin_provider_user_id?: string | null
          linkedin_url?: string | null
          recent_interactions?: string[]
          resume_status?: string
          review_status?: string
          salary_target?: number | null
          source_confidence?: number | null
          source_provider?: string | null
          start_date?: string
          startup_grind?: string
          updated_at?: string
          user_id?: string
          work_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_dimensions: {
        Row: {
          created_at: string
          data_type: string
          default_weight: number
          dimension_group: string
          key: string
          label: string
          matching_role: string
          sensitivity_level: string
        }
        Insert: {
          created_at?: string
          data_type?: string
          default_weight?: number
          dimension_group: string
          key: string
          label: string
          matching_role: string
          sensitivity_level?: string
        }
        Update: {
          created_at?: string
          data_type?: string
          default_weight?: number
          dimension_group?: string
          key?: string
          label?: string
          matching_role?: string
          sensitivity_level?: string
        }
        Relationships: []
      }
      profile_embeddings: {
        Row: {
          content_hash: string | null
          created_at: string
          dimension: string
          embedding: string | null
          embedding_model: string
          embedding_text: string
          fact_id: string | null
          id: string
          source_fact_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          dimension: string
          embedding?: string | null
          embedding_model: string
          embedding_text: string
          fact_id?: string | null
          id?: string
          source_fact_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          dimension?: string
          embedding?: string | null
          embedding_model?: string
          embedding_text?: string
          fact_id?: string | null
          id?: string
          source_fact_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_embeddings_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "profile_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_embeddings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_fact_conflicts: {
        Row: {
          conflict_type: string
          created_at: string
          fact_a_id: string | null
          fact_b_id: string | null
          id: string
          resolution_state: string
          resolved_fact_id: string | null
          source_import_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conflict_type: string
          created_at?: string
          fact_a_id?: string | null
          fact_b_id?: string | null
          id?: string
          resolution_state?: string
          resolved_fact_id?: string | null
          source_import_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conflict_type?: string
          created_at?: string
          fact_a_id?: string | null
          fact_b_id?: string | null
          id?: string
          resolution_state?: string
          resolved_fact_id?: string | null
          source_import_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_fact_conflicts_fact_a_id_fkey"
            columns: ["fact_a_id"]
            isOneToOne: false
            referencedRelation: "profile_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_fact_conflicts_fact_b_id_fkey"
            columns: ["fact_b_id"]
            isOneToOne: false
            referencedRelation: "profile_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_fact_conflicts_resolved_fact_id_fkey"
            columns: ["resolved_fact_id"]
            isOneToOne: false
            referencedRelation: "profile_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_fact_conflicts_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "profile_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_fact_conflicts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_facts: {
        Row: {
          assertion_type: string
          confidence: number
          created_at: string
          dimension: string
          evidence_excerpt: string | null
          fact_key: string
          id: string
          importance: number
          matching_eligible: boolean
          normalized_value: string
          observed_vs_self_reported: string | null
          recency_at: string | null
          recency_hint: string | null
          review_note: string | null
          sensitivity_level: string
          source_type: string | null
          source_import_id: string
          updated_at: string
          user_id: string
          user_review_state: string
          value_json: Json
        }
        Insert: {
          assertion_type?: string
          confidence?: number
          created_at?: string
          dimension: string
          evidence_excerpt?: string | null
          fact_key: string
          id?: string
          importance?: number
          matching_eligible?: boolean
          normalized_value: string
          observed_vs_self_reported?: string | null
          recency_at?: string | null
          recency_hint?: string | null
          review_note?: string | null
          sensitivity_level?: string
          source_type?: string | null
          source_import_id: string
          updated_at?: string
          user_id: string
          user_review_state?: string
          value_json: Json
        }
        Update: {
          assertion_type?: string
          confidence?: number
          created_at?: string
          dimension?: string
          evidence_excerpt?: string | null
          fact_key?: string
          id?: string
          importance?: number
          matching_eligible?: boolean
          normalized_value?: string
          observed_vs_self_reported?: string | null
          recency_at?: string | null
          recency_hint?: string | null
          review_note?: string | null
          sensitivity_level?: string
          source_type?: string | null
          source_import_id?: string
          updated_at?: string
          user_id?: string
          user_review_state?: string
          value_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "profile_facts_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "profile_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_facts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_imports: {
        Row: {
          consent_recorded_at: string | null
          created_at: string
          error_message: string | null
          id: string
          import_metadata: Json
          method: string
          payload_hash: string
          processed_at: string | null
          provider: string
          raw_payload: Json
          schema_version: string
          source_label: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          consent_recorded_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_metadata?: Json
          method: string
          payload_hash: string
          processed_at?: string | null
          provider: string
          raw_payload: Json
          schema_version?: string
          source_label?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          consent_recorded_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_metadata?: Json
          method?: string
          payload_hash?: string
          processed_at?: string | null
          provider?: string
          raw_payload?: Json
          schema_version?: string
          source_label?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_matching_refresh_jobs: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string
          requested_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          requested_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          requested_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_matching_refresh_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_source_snapshots: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          lookup_key_hash: string
          payload_version: string
          provider: string
          raw_payload: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          lookup_key_hash: string
          payload_version?: string
          provider: string
          raw_payload?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          lookup_key_hash?: string
          payload_version?: string
          provider?: string
          raw_payload?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_source_snapshots_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "linkedin_enrichment_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_source_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_update_proposals: {
        Row: {
          approved_at: string | null
          confirmation_token_hash: string | null
          created_at: string
          expires_at: string
          id: string
          patch_json: Json
          risk_level: string
          source_import_id: string | null
          status: string
          summary: string
          thread_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          confirmation_token_hash?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          patch_json: Json
          risk_level?: string
          source_import_id?: string | null
          status?: string
          summary: string
          thread_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          confirmation_token_hash?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          patch_json?: Json
          risk_level?: string
          source_import_id?: string | null
          status?: string
          summary?: string
          thread_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_update_proposals_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "profile_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_update_proposals_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "text_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_update_proposals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      roommate_contact_group_members: {
        Row: {
          contact_group_id: string
          contact_id: string
          created_at: string
          id: string
          matched_user_id: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          contact_group_id: string
          contact_id: string
          created_at?: string
          id?: string
          matched_user_id?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Update: {
          contact_group_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          matched_user_id?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roommate_contact_group_members_contact_group_id_fkey"
            columns: ["contact_group_id"]
            isOneToOne: false
            referencedRelation: "roommate_contact_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_contact_group_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "user_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_contact_group_members_matched_user_id_fkey"
            columns: ["matched_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      roommate_contact_groups: {
        Row: {
          apartment_group_id: string | null
          created_at: string
          id: string
          label: string
          listing_id: string | null
          owner_user_id: string
          share_token: string
          status: string
          target_household_size: number
          updated_at: string
        }
        Insert: {
          apartment_group_id?: string | null
          created_at?: string
          id?: string
          label: string
          listing_id?: string | null
          owner_user_id: string
          share_token: string
          status?: string
          target_household_size?: number
          updated_at?: string
        }
        Update: {
          apartment_group_id?: string | null
          created_at?: string
          id?: string
          label?: string
          listing_id?: string | null
          owner_user_id?: string
          share_token?: string
          status?: string
          target_household_size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roommate_contact_groups_apartment_group_id_fkey"
            columns: ["apartment_group_id"]
            isOneToOne: false
            referencedRelation: "apartment_roommate_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_contact_groups_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_contact_groups_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      roommate_contact_invites: {
        Row: {
          accepted_at: string | null
          accepted_phone_e164: string | null
          apartment_group_id: string | null
          channel: string
          contact_group_id: string
          contact_id: string | null
          created_at: string
          delivery_error: string | null
          destination_label: string | null
          destination_phone_e164: string | null
          id: string
          invite_token: string
          inviter_user_id: string
          listing_id: string | null
          message: string | null
          reply_code_expires_at: string | null
          reply_code_hash: string | null
          reply_code_hint: string | null
          revoked_at: string | null
          sent_at: string | null
          sms_delivery_status: string | null
          sms_provider: string | null
          sms_provider_chat_id: string | null
          sms_provider_message_id: string | null
          sms_service: string | null
          started_setup_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_phone_e164?: string | null
          apartment_group_id?: string | null
          channel?: string
          contact_group_id: string
          contact_id?: string | null
          created_at?: string
          delivery_error?: string | null
          destination_label?: string | null
          destination_phone_e164?: string | null
          id?: string
          invite_token: string
          inviter_user_id: string
          listing_id?: string | null
          message?: string | null
          reply_code_expires_at?: string | null
          reply_code_hash?: string | null
          reply_code_hint?: string | null
          revoked_at?: string | null
          sent_at?: string | null
          sms_delivery_status?: string | null
          sms_provider?: string | null
          sms_provider_chat_id?: string | null
          sms_provider_message_id?: string | null
          sms_service?: string | null
          started_setup_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_phone_e164?: string | null
          apartment_group_id?: string | null
          channel?: string
          contact_group_id?: string
          contact_id?: string | null
          created_at?: string
          delivery_error?: string | null
          destination_label?: string | null
          destination_phone_e164?: string | null
          id?: string
          invite_token?: string
          inviter_user_id?: string
          listing_id?: string | null
          message?: string | null
          reply_code_expires_at?: string | null
          reply_code_hash?: string | null
          reply_code_hint?: string | null
          revoked_at?: string | null
          sent_at?: string | null
          sms_delivery_status?: string | null
          sms_provider?: string | null
          sms_provider_chat_id?: string | null
          sms_provider_message_id?: string | null
          sms_service?: string | null
          started_setup_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roommate_contact_invites_apartment_group_id_fkey"
            columns: ["apartment_group_id"]
            isOneToOne: false
            referencedRelation: "apartment_roommate_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_contact_invites_contact_group_id_fkey"
            columns: ["contact_group_id"]
            isOneToOne: false
            referencedRelation: "roommate_contact_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_contact_invites_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "user_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_contact_invites_inviter_user_id_fkey"
            columns: ["inviter_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_contact_invites_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      roommate_preferences: {
        Row: {
          cleanliness: string | null
          conflict_style: string | null
          created_at: string
          dealbreakers: string[]
          hosting_expectations: string | null
          id: string
          lifestyle_notes: string | null
          preferred_age_max: number | null
          preferred_age_min: number | null
          preferred_age_strict: boolean
          profile_id: string | null
          sleep_schedule: string | null
          social_energy: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cleanliness?: string | null
          conflict_style?: string | null
          created_at?: string
          dealbreakers?: string[]
          hosting_expectations?: string | null
          id?: string
          lifestyle_notes?: string | null
          preferred_age_max?: number | null
          preferred_age_min?: number | null
          preferred_age_strict?: boolean
          profile_id?: string | null
          sleep_schedule?: string | null
          social_energy?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cleanliness?: string | null
          conflict_style?: string | null
          created_at?: string
          dealbreakers?: string[]
          hosting_expectations?: string | null
          id?: string
          lifestyle_notes?: string | null
          preferred_age_max?: number | null
          preferred_age_min?: number | null
          preferred_age_strict?: boolean
          profile_id?: string | null
          sleep_schedule?: string | null
          social_energy?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roommate_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "matching_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_places: {
        Row: {
          area_label: string | null
          created_at: string
          id: string
          kind: string
          listing_id: string | null
          note: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          area_label?: string | null
          created_at?: string
          id?: string
          kind: string
          listing_id?: string | null
          note?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          area_label?: string | null
          created_at?: string
          id?: string
          kind?: string
          listing_id?: string | null
          note?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_places_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_places_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      text_agent_eval_cases: {
        Row: {
          created_at: string
          expected_facts_json: Json
          expected_policy_outcome: string | null
          id: string
          input_text: string
          source: string
        }
        Insert: {
          created_at?: string
          expected_facts_json?: Json
          expected_policy_outcome?: string | null
          id?: string
          input_text: string
          source?: string
        }
        Update: {
          created_at?: string
          expected_facts_json?: Json
          expected_policy_outcome?: string | null
          id?: string
          input_text?: string
          source?: string
        }
        Relationships: []
      }
      text_agent_rate_limits: {
        Row: {
          bucket_key: string
          bucket_type: string
          cost_usd: number
          count: number
          created_at: string
          id: string
          last_hit_at: string
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          bucket_type: string
          cost_usd?: number
          count?: number
          created_at?: string
          id?: string
          last_hit_at?: string
          updated_at?: string
          window_start: string
        }
        Update: {
          bucket_key?: string
          bucket_type?: string
          cost_usd?: number
          count?: number
          created_at?: string
          id?: string
          last_hit_at?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      text_agent_runs: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          estimated_cost_usd: number | null
          extraction_result_json: Json | null
          id: string
          input_tokens: number | null
          intent: string
          latency_ms: number | null
          limit_bucket: string | null
          message_id: string | null
          model: string | null
          next_retry_at: string | null
          output_tokens: number | null
          policy_outcome: string | null
          provider: string | null
          queued_at: string | null
          result_summary: string | null
          run_status: string
          started_at: string | null
          thread_id: string | null
          trace_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number | null
          extraction_result_json?: Json | null
          id?: string
          input_tokens?: number | null
          intent: string
          latency_ms?: number | null
          limit_bucket?: string | null
          message_id?: string | null
          model?: string | null
          next_retry_at?: string | null
          output_tokens?: number | null
          policy_outcome?: string | null
          provider?: string | null
          queued_at?: string | null
          result_summary?: string | null
          run_status?: string
          started_at?: string | null
          thread_id?: string | null
          trace_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number | null
          extraction_result_json?: Json | null
          id?: string
          input_tokens?: number | null
          intent?: string
          latency_ms?: number | null
          limit_bucket?: string | null
          message_id?: string | null
          model?: string | null
          next_retry_at?: string | null
          output_tokens?: number | null
          policy_outcome?: string | null
          provider?: string | null
          queued_at?: string | null
          result_summary?: string | null
          run_status?: string
          started_at?: string | null
          thread_id?: string | null
          trace_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "text_agent_runs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "text_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_agent_runs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "text_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_agent_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      text_group_join_notifications: {
        Row: {
          card_snapshot: Json | null
          created_at: string
          feedback_value: number
          group_id: string
          id: string
          membership_id: string
          outbound_idempotency_key: string
          outbound_message_id: string | null
          reacted_at: string | null
          reaction_event_id: string | null
          reaction_type: string | null
          recipient_user_id: string
          requester_user_id: string
          status: string
          thread_id: string | null
          updated_at: string
        }
        Insert: {
          card_snapshot?: Json | null
          created_at?: string
          feedback_value?: number
          group_id: string
          id?: string
          membership_id: string
          outbound_idempotency_key: string
          outbound_message_id?: string | null
          reacted_at?: string | null
          reaction_event_id?: string | null
          reaction_type?: string | null
          recipient_user_id: string
          requester_user_id: string
          status?: string
          thread_id?: string | null
          updated_at?: string
        }
        Update: {
          card_snapshot?: Json | null
          created_at?: string
          feedback_value?: number
          group_id?: string
          id?: string
          membership_id?: string
          outbound_idempotency_key?: string
          outbound_message_id?: string | null
          reacted_at?: string | null
          reaction_event_id?: string | null
          reaction_type?: string | null
          recipient_user_id?: string
          requester_user_id?: string
          status?: string
          thread_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "text_group_join_notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "apartment_roommate_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_group_join_notifications_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "apartment_roommate_group_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_group_join_notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_group_join_notifications_requester_user_id_fkey"
            columns: ["requester_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_group_join_notifications_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "text_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      text_listing_recommendations: {
        Row: {
          card_snapshot: Json | null
          created_at: string
          feedback_value: number
          fit_score: number
          id: string
          listing_id: string
          outbound_idempotency_key: string
          outbound_message_id: string | null
          rank: number
          reacted_at: string | null
          reaction_event_id: string | null
          reaction_part_index: number | null
          reaction_type: string | null
          status: string
          thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          card_snapshot?: Json | null
          created_at?: string
          feedback_value?: number
          fit_score?: number
          id?: string
          listing_id: string
          outbound_idempotency_key: string
          outbound_message_id?: string | null
          rank?: number
          reacted_at?: string | null
          reaction_event_id?: string | null
          reaction_part_index?: number | null
          reaction_type?: string | null
          status?: string
          thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          card_snapshot?: Json | null
          created_at?: string
          feedback_value?: number
          fit_score?: number
          id?: string
          listing_id?: string
          outbound_idempotency_key?: string
          outbound_message_id?: string | null
          rank?: number
          reacted_at?: string | null
          reaction_event_id?: string | null
          reaction_part_index?: number | null
          reaction_type?: string | null
          status?: string
          thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "text_listing_recommendations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "apartment_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_listing_recommendations_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "text_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_listing_recommendations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      text_messages: {
        Row: {
          body: string
          created_at: string
          delivery_status: string | null
          direction: string
          from_phone_e164: string
          id: string
          media: Json
          outbound_idempotency_key: string | null
          phone_number_id: string | null
          provider: string
          provider_chat_id: string | null
          provider_event_id: string | null
          provider_message_id: string | null
          raw_payload: Json
          received_at: string
          service: string | null
          thread_id: string | null
          to_phone_e164: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          body?: string
          created_at?: string
          delivery_status?: string | null
          direction: string
          from_phone_e164: string
          id?: string
          media?: Json
          outbound_idempotency_key?: string | null
          phone_number_id?: string | null
          provider?: string
          provider_chat_id?: string | null
          provider_event_id?: string | null
          provider_message_id?: string | null
          raw_payload?: Json
          received_at?: string
          service?: string | null
          thread_id?: string | null
          to_phone_e164: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          delivery_status?: string | null
          direction?: string
          from_phone_e164?: string
          id?: string
          media?: Json
          outbound_idempotency_key?: string | null
          phone_number_id?: string | null
          provider?: string
          provider_chat_id?: string | null
          provider_event_id?: string | null
          provider_message_id?: string | null
          raw_payload?: Json
          received_at?: string
          service?: string | null
          thread_id?: string | null
          to_phone_e164?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "text_messages_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "user_phone_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "text_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      text_thread_summaries: {
        Row: {
          created_at: string
          id: string
          known_preferences_json: Json
          open_questions_json: Json
          summary_json: Json
          thread_id: string
          updated_at: string
          updated_from_message_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          known_preferences_json?: Json
          open_questions_json?: Json
          summary_json?: Json
          thread_id: string
          updated_at?: string
          updated_from_message_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          known_preferences_json?: Json
          open_questions_json?: Json
          summary_json?: Json
          thread_id?: string
          updated_at?: string
          updated_from_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "text_thread_summaries_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "text_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_thread_summaries_updated_from_message_id_fkey"
            columns: ["updated_from_message_id"]
            isOneToOne: false
            referencedRelation: "text_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_thread_summaries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      text_threads: {
        Row: {
          created_at: string
          from_phone_e164: string
          id: string
          last_message_at: string | null
          phone_number_id: string | null
          provider: string
          provider_chat_id: string | null
          status: string
          to_phone_e164: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          from_phone_e164: string
          id?: string
          last_message_at?: string | null
          phone_number_id?: string | null
          provider?: string
          provider_chat_id?: string | null
          status?: string
          to_phone_e164: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          from_phone_e164?: string
          id?: string
          last_message_at?: string | null
          phone_number_id?: string | null
          provider?: string
          provider_chat_id?: string | null
          status?: string
          to_phone_e164?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "text_threads_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "user_phone_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      text_webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          processed_at: string | null
          provider: string
          provider_event_id: string
          raw_payload: Json
          received_at: string
          status: string
          trace_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          processed_at?: string | null
          provider?: string
          provider_event_id: string
          raw_payload: Json
          received_at?: string
          status?: string
          trace_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          raw_payload?: Json
          received_at?: string
          status?: string
          trace_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_contacts: {
        Row: {
          contact_key: string
          created_at: string
          deleted_at: string | null
          display_name: string
          email_hashes: string[]
          emails: Json
          id: string
          import_batch_id: string | null
          last_invited_at: string | null
          matched_user_id: string | null
          owner_user_id: string
          phone_hashes: string[]
          phones: Json
          primary_email: string | null
          primary_phone_e164: string | null
          source: string
          trust_state: string
          updated_at: string
        }
        Insert: {
          contact_key: string
          created_at?: string
          deleted_at?: string | null
          display_name: string
          email_hashes?: string[]
          emails?: Json
          id?: string
          import_batch_id?: string | null
          last_invited_at?: string | null
          matched_user_id?: string | null
          owner_user_id: string
          phone_hashes?: string[]
          phones?: Json
          primary_email?: string | null
          primary_phone_e164?: string | null
          source?: string
          trust_state?: string
          updated_at?: string
        }
        Update: {
          contact_key?: string
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          email_hashes?: string[]
          emails?: Json
          id?: string
          import_batch_id?: string | null
          last_invited_at?: string | null
          matched_user_id?: string | null
          owner_user_id?: string
          phone_hashes?: string[]
          phones?: Json
          primary_email?: string | null
          primary_phone_e164?: string | null
          source?: string
          trust_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_contacts_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "contact_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contacts_matched_user_id_fkey"
            columns: ["matched_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contacts_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_phone_numbers: {
        Row: {
          consent_source: string | null
          created_at: string
          id: string
          last_opt_out_at: string | null
          phone_e164: string
          sms_consent_state: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          consent_source?: string | null
          created_at?: string
          id?: string
          last_opt_out_at?: string | null
          phone_e164: string
          sms_consent_state?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          consent_source?: string | null
          created_at?: string
          id?: string
          last_opt_out_at?: string | null
          phone_e164?: string
          sms_consent_state?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_phone_numbers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "kinfolk_users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_profile_matching_refresh_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string
          requested_at: string
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "profile_matching_refresh_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_profile_matching_refresh: {
        Args: { p_user_id: string }
        Returns: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string
          requested_at: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_matching_refresh_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      hit_text_agent_rate_limit: {
        Args: {
          p_bucket_key: string
          p_bucket_type: string
          p_limit: number
          p_window_start: string
        }
        Returns: {
          allowed: boolean
          bucket_count: number
        }[]
      }
      kinfolk_fnv1a_32: { Args: { input: string }; Returns: number }
      match_roommates_by_embedding: {
        Args: {
          p_embedding_model?: string
          p_match_count?: number
          p_min_cosine?: number
          p_query_embedding: string
          p_viewer_id: string
        }
        Returns: {
          cosine_similarity: number
          user_id: string
        }[]
      }
      merge_listing_provider_detail_payload: {
        Args: {
          p_key: string
          p_listing_id: string
          p_value: Json
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
