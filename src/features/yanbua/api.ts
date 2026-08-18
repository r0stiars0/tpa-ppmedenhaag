import { supabase } from '../../lib/supabase'
import type { Tables, TablesInsert } from '../../lib/database.types'
import type { JilidRef } from '../../lib/yanbua'

export type YanbuaProgress = Tables<'yanbua_progress'>

export async function fetchYanbuaJilidRef(): Promise<JilidRef[]> {
  const { data, error } = await supabase
    .from('yanbua_jilid')
    .select('jilid, page_count')
    .order('jilid')
  if (error) throw error
  return data ?? []
}

export async function fetchYanbuaHistory(studentId: string): Promise<YanbuaProgress[]> {
  const { data, error } = await supabase
    .from('yanbua_progress')
    .select('*')
    .eq('student_id', studentId)
    .order('recorded_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function insertYanbuaProgress(
  row: TablesInsert<'yanbua_progress'>,
): Promise<YanbuaProgress> {
  const { data, error } = await supabase.from('yanbua_progress').insert(row).select().single()
  if (error) throw error
  return data
}
