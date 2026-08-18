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
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      assignment_status: {
        Row: {
          assignment_id: string
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["assignment_status_enum"]
          student_id: string
          updated_at: string
        }
        Insert: {
          assignment_id: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status_enum"]
          student_id: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["assignment_status_enum"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_status_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_status_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          class_id: string
          created_at: string
          description: string | null
          due_date: string
          id: string
          title: string
          tutor_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          description?: string | null
          due_date: string
          id?: string
          title: string
          tutor_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          title?: string
          tutor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          session_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          session_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          created_at: string
          id: string
          name: string
          schedule: string | null
          tutor_ids: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          schedule?: string | null
          tutor_ids?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          schedule?: string | null
          tutor_ids?: string[]
        }
        Relationships: []
      }
      murajaah_assignments: {
        Row: {
          active: boolean
          ayah_from: number
          ayah_to: number
          created_at: string
          frequency: Database["public"]["Enums"]["murajaah_frequency"]
          id: string
          student_id: string
          surah_num: number
          tutor_id: string
        }
        Insert: {
          active?: boolean
          ayah_from: number
          ayah_to: number
          created_at?: string
          frequency?: Database["public"]["Enums"]["murajaah_frequency"]
          id?: string
          student_id: string
          surah_num: number
          tutor_id: string
        }
        Update: {
          active?: boolean
          ayah_from?: number
          ayah_to?: number
          created_at?: string
          frequency?: Database["public"]["Enums"]["murajaah_frequency"]
          id?: string
          student_id?: string
          surah_num?: number
          tutor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "murajaah_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "murajaah_assignments_surah_num_fkey"
            columns: ["surah_num"]
            isOneToOne: false
            referencedRelation: "surahs"
            referencedColumns: ["surah_num"]
          },
          {
            foreignKeyName: "murajaah_assignments_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      murajaah_log: {
        Row: {
          assignment_id: string
          confirmed_by: string
          created_at: string
          date: string
          id: string
          quality: Database["public"]["Enums"]["murajaah_quality"]
        }
        Insert: {
          assignment_id: string
          confirmed_by: string
          created_at?: string
          date?: string
          id?: string
          quality: Database["public"]["Enums"]["murajaah_quality"]
        }
        Update: {
          assignment_id?: string
          confirmed_by?: string
          created_at?: string
          date?: string
          id?: string
          quality?: Database["public"]["Enums"]["murajaah_quality"]
        }
        Relationships: [
          {
            foreignKeyName: "murajaah_log_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "murajaah_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "murajaah_log_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          context: Json
          created_at: string
          event: Database["public"]["Enums"]["notification_event"]
          event_date: string
          id: string
          read_at: string | null
          student_id: string
          user_id: string
        }
        Insert: {
          context?: Json
          created_at?: string
          event: Database["public"]["Enums"]["notification_event"]
          event_date: string
          id?: string
          read_at?: string | null
          student_id: string
          user_id: string
        }
        Update: {
          context?: Json
          created_at?: string
          event?: Database["public"]["Enums"]["notification_event"]
          event_date?: string
          id?: string
          read_at?: string | null
          student_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      quran_progress: {
        Row: {
          ayah_from: number
          ayah_to: number
          client_ref: string | null
          id: string
          quality: Database["public"]["Enums"]["quran_quality"]
          recorded_at: string
          student_id: string
          surah_num: number
          tajweed_notes: string | null
          tutor_id: string
        }
        Insert: {
          ayah_from: number
          ayah_to: number
          client_ref?: string | null
          id?: string
          quality: Database["public"]["Enums"]["quran_quality"]
          recorded_at?: string
          student_id: string
          surah_num: number
          tajweed_notes?: string | null
          tutor_id: string
        }
        Update: {
          ayah_from?: number
          ayah_to?: number
          client_ref?: string | null
          id?: string
          quality?: Database["public"]["Enums"]["quran_quality"]
          recorded_at?: string
          student_id?: string
          surah_num?: number
          tajweed_notes?: string | null
          tutor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quran_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quran_progress_surah_num_fkey"
            columns: ["surah_num"]
            isOneToOne: false
            referencedRelation: "surahs"
            referencedColumns: ["surah_num"]
          },
          {
            foreignKeyName: "quran_progress_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          class_id: string
          created_at: string
          date: string
          id: string
          tutor_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          date: string
          id?: string
          tutor_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          date?: string
          id?: string
          tutor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          class_id: string | null
          created_at: string
          current_ayah: number | null
          current_jilid: number | null
          current_surah: number | null
          date_of_birth: string
          enrollment_date: string
          full_name: string
          id: string
          parent_id: string
          user_id: string | null
        }
        Insert: {
          class_id?: string | null
          created_at?: string
          current_ayah?: number | null
          current_jilid?: number | null
          current_surah?: number | null
          date_of_birth: string
          enrollment_date?: string
          full_name: string
          id?: string
          parent_id: string
          user_id?: string | null
        }
        Update: {
          class_id?: string | null
          created_at?: string
          current_ayah?: number | null
          current_jilid?: number | null
          current_surah?: number | null
          date_of_birth?: string
          enrollment_date?: string
          full_name?: string
          id?: string
          parent_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_current_jilid_fkey"
            columns: ["current_jilid"]
            isOneToOne: false
            referencedRelation: "yanbua_jilid"
            referencedColumns: ["jilid"]
          },
          {
            foreignKeyName: "students_current_surah_fkey"
            columns: ["current_surah"]
            isOneToOne: false
            referencedRelation: "surahs"
            referencedColumns: ["surah_num"]
          },
          {
            foreignKeyName: "students_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      surahs: {
        Row: {
          ayah_count: number
          name_arabic: string
          surah_num: number
          transliteration: string
        }
        Insert: {
          ayah_count: number
          name_arabic: string
          surah_num: number
          transliteration: string
        }
        Update: {
          ayah_count?: number
          name_arabic?: string
          surah_num?: number
          transliteration?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          locale: Database["public"]["Enums"]["locale"]
          push_sub: Json | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          locale?: Database["public"]["Enums"]["locale"]
          push_sub?: Json | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          locale?: Database["public"]["Enums"]["locale"]
          push_sub?: Json | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      yanbua_jilid: {
        Row: {
          jilid: number
          label_id: string
          label_nl: string
          page_count: number
        }
        Insert: {
          jilid: number
          label_id: string
          label_nl: string
          page_count: number
        }
        Update: {
          jilid?: number
          label_id?: string
          label_nl?: string
          page_count?: number
        }
        Relationships: []
      }
      yanbua_progress: {
        Row: {
          client_ref: string | null
          id: string
          jilid: number
          mastery: Database["public"]["Enums"]["yanbuah_mastery"]
          notes: string | null
          page: number
          recorded_at: string
          student_id: string
          tutor_id: string
        }
        Insert: {
          client_ref?: string | null
          id?: string
          jilid: number
          mastery: Database["public"]["Enums"]["yanbuah_mastery"]
          notes?: string | null
          page: number
          recorded_at?: string
          student_id: string
          tutor_id: string
        }
        Update: {
          client_ref?: string | null
          id?: string
          jilid?: number
          mastery?: Database["public"]["Enums"]["yanbuah_mastery"]
          notes?: string | null
          page?: number
          recorded_at?: string
          student_id?: string
          tutor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "yanbua_progress_jilid_fkey"
            columns: ["jilid"]
            isOneToOne: false
            referencedRelation: "yanbua_jilid"
            referencedColumns: ["jilid"]
          },
          {
            foreignKeyName: "yanbua_progress_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yanbua_progress_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      year_end_reports: {
        Row: {
          academic_year: string
          attendance_absent: number
          attendance_late: number
          attendance_present: number
          attendance_rate: number
          created_at: string
          generated_at: string
          id: string
          murajaah_grade: Database["public"]["Enums"]["report_grade"] | null
          murajaah_notes: string | null
          narrative: string | null
          overall_grade: Database["public"]["Enums"]["report_grade"] | null
          pdf_path: string | null
          published_at: string | null
          quran_grade: Database["public"]["Enums"]["report_grade"] | null
          quran_notes: string | null
          status: Database["public"]["Enums"]["report_status"]
          student_id: string
          tutor_id: string
          updated_at: string
          yanbua_grade: Database["public"]["Enums"]["report_grade"] | null
          yanbua_notes: string | null
        }
        Insert: {
          academic_year: string
          attendance_absent?: number
          attendance_late?: number
          attendance_present?: number
          attendance_rate?: number
          created_at?: string
          generated_at?: string
          id?: string
          murajaah_grade?: Database["public"]["Enums"]["report_grade"] | null
          murajaah_notes?: string | null
          narrative?: string | null
          overall_grade?: Database["public"]["Enums"]["report_grade"] | null
          pdf_path?: string | null
          published_at?: string | null
          quran_grade?: Database["public"]["Enums"]["report_grade"] | null
          quran_notes?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          student_id: string
          tutor_id: string
          updated_at?: string
          yanbua_grade?: Database["public"]["Enums"]["report_grade"] | null
          yanbua_notes?: string | null
        }
        Update: {
          academic_year?: string
          attendance_absent?: number
          attendance_late?: number
          attendance_present?: number
          attendance_rate?: number
          created_at?: string
          generated_at?: string
          id?: string
          murajaah_grade?: Database["public"]["Enums"]["report_grade"] | null
          murajaah_notes?: string | null
          narrative?: string | null
          overall_grade?: Database["public"]["Enums"]["report_grade"] | null
          pdf_path?: string | null
          published_at?: string | null
          quran_grade?: Database["public"]["Enums"]["report_grade"] | null
          quran_notes?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          student_id?: string
          tutor_id?: string
          updated_at?: string
          yanbua_grade?: Database["public"]["Enums"]["report_grade"] | null
          yanbua_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "year_end_reports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "year_end_reports_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fn_current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      fn_is_admin: { Args: never; Returns: boolean }
      fn_my_children: { Args: never; Returns: string[] }
      fn_my_class_students: { Args: never; Returns: string[] }
      fn_my_classes: { Args: never; Returns: string[] }
      fn_my_student_id: { Args: never; Returns: string }
      fn_pending_registrations: {
        Args: never
        Returns: { id: string; email: string; created_at: string }[]
      }
    }
    Enums: {
      assignment_status_enum: "pending" | "completed" | "incomplete" | "partial"
      attendance_status: "present" | "absent" | "late"
      locale: "id" | "nl"
      murajaah_frequency: "daily" | "3x_week" | "weekly"
      murajaah_quality: "hafal_lancar" | "hafal_kurang_lancar" | "belum_hafal"
      notification_event:
        | "absence"
        | "newAssignment"
        | "assignmentDueTomorrow"
        | "jilidMilestone"
        | "surahMemorized"
        | "murajaahReminder"
        | "reportReady"
        | "weeklyDigest"
      quran_quality:
        | "mumtaz"
        | "jayyid_jiddan"
        | "jayyid"
        | "maqbul"
        | "perlu_perbaikan"
      report_grade:
        | "mumtaz"
        | "jayyid_jiddan"
        | "jayyid"
        | "maqbul"
        | "perlu_bimbingan"
      report_status: "draft" | "published"
      user_role: "admin" | "tutor" | "parent" | "student"
      yanbuah_mastery: "lancar" | "kurang_lancar" | "ulang"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      assignment_status_enum: ["pending", "completed", "incomplete", "partial"],
      attendance_status: ["present", "absent", "late"],
      locale: ["id", "nl"],
      murajaah_frequency: ["daily", "3x_week", "weekly"],
      murajaah_quality: ["hafal_lancar", "hafal_kurang_lancar", "belum_hafal"],
      quran_quality: [
        "mumtaz",
        "jayyid_jiddan",
        "jayyid",
        "maqbul",
        "perlu_perbaikan",
      ],
      report_grade: [
        "mumtaz",
        "jayyid_jiddan",
        "jayyid",
        "maqbul",
        "perlu_bimbingan",
      ],
      report_status: ["draft", "published"],
      user_role: ["admin", "tutor", "parent", "student"],
      yanbuah_mastery: ["lancar", "kurang_lancar", "ulang"],
    },
  },
} as const
