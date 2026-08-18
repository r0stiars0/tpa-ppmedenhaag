import { supabase } from '../../lib/supabase'
import type { Tables, TablesInsert } from '../../lib/database.types'
import type { SurahRef } from '../../lib/quran'

export type QuranProgress = Tables<'quran_progress'>

export async function fetchSurahs(): Promise<SurahRef[]> {
  const { data, error } = await supabase
    .from('surahs')
    .select('surah_num, name_arabic, transliteration, ayah_count')
    .order('surah_num')
  if (error) throw error
  return data ?? []
}

export async function fetchQuranHistory(studentId: string): Promise<QuranProgress[]> {
  const { data, error } = await supabase
    .from('quran_progress')
    .select('*')
    .eq('student_id', studentId)
    .order('recorded_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function insertQuranProgress(
  row: TablesInsert<'quran_progress'>,
): Promise<QuranProgress> {
  const { data, error } = await supabase.from('quran_progress').insert(row).select().single()
  if (error) throw error
  return data
}
