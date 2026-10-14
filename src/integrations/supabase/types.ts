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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agent_operator_messages: {
        Row: {
          consumed: boolean
          content: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          consumed?: boolean
          content: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          consumed?: boolean
          content?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: []
      }
      agent_playbooks: {
        Row: {
          content: string
          created_at: string
          id: string
          task_count: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          task_count: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          task_count?: number
        }
        Relationships: []
      }
      agent_policy_weights: {
        Row: {
          ngram: string
          observations: number
          updated_at: string
          weight: number
        }
        Insert: {
          ngram: string
          observations?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          ngram?: string
          observations?: number
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      agent_reflections: {
        Row: {
          component: string
          corrective_action: string
          created_at: string
          failed_action: string
          failure_point: string
          id: string
          objective: string
          patch: string
          pivot_action: string
          root_cause: string
          task_id: string
        }
        Insert: {
          component: string
          corrective_action?: string
          created_at?: string
          failed_action?: string
          failure_point: string
          id?: string
          objective: string
          patch: string
          pivot_action: string
          root_cause: string
          task_id: string
        }
        Update: {
          component?: string
          corrective_action?: string
          created_at?: string
          failed_action?: string
          failure_point?: string
          id?: string
          objective?: string
          patch?: string
          pivot_action?: string
          root_cause?: string
          task_id?: string
        }
        Relationships: []
      }
      agent_skills: {
        Row: {
          baseline_rate: number | null
          candidate_rate: number | null
          created_at: string
          dsl: string
          failures: number
          id: string
          name: string
          status: string
          successes: number
          terms: string
          vector: number[]
        }
        Insert: {
          baseline_rate?: number | null
          candidate_rate?: number | null
          created_at?: string
          dsl: string
          failures?: number
          id?: string
          name: string
          status?: string
          successes?: number
          terms?: string
          vector?: number[]
        }
        Update: {
          baseline_rate?: number | null
          candidate_rate?: number | null
          created_at?: string
          dsl?: string
          failures?: number
          id?: string
          name?: string
          status?: string
          successes?: number
          terms?: string
          vector?: number[]
        }
        Relationships: []
      }
      agent_tasks: {
        Row: {
          created_at: string
          id: string
          objective: string
          outcome: string
          steps: number
          verified: boolean
        }
        Insert: {
          created_at?: string
          id: string
          objective: string
          outcome: string
          steps?: number
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          objective?: string
          outcome?: string
          steps?: number
          verified?: boolean
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          messages?: Json
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_job_events: {
        Row: {
          created_at: string
          id: number
          job_id: string
          payload: Json
        }
        Insert: {
          created_at?: string
          id?: never
          job_id: string
          payload: Json
        }
        Update: {
          created_at?: string
          id?: never
          job_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "chat_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "chat_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_jobs: {
        Row: {
          conversation_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          history: Json
          id: string
          lease_expires_at: string | null
          response_content: string
          response_reasoning: string
          started_at: string | null
          status: string
          stop_requested: boolean
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          history: Json
          id: string
          lease_expires_at?: string | null
          response_content?: string
          response_reasoning?: string
          started_at?: string | null
          status?: string
          stop_requested?: boolean
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          history?: Json
          id?: string
          lease_expires_at?: string | null
          response_content?: string
          response_reasoning?: string
          started_at?: string | null
          status?: string
          stop_requested?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      kick_chat_worker: {
        Args: { _base_url: string; _job_id: string }
        Returns: number
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
