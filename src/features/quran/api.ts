import { supabase } from '../../lib/supabase'
import type { Tables, TablesInsert } from '../../lib/database.types'
import { ProgressEditRefusedError } from '../../lib/progressEdit'
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

/** The columns an edit may change; the grant in migration 025 is the same list. */
export type QuranEdit = Pick<TablesInsert<'quran_progress'>, 'surah_num' | 'ayah_from' | 'ayah_to' | 'quality' | 'tajweed_notes'>

export async function updateQuranProgress(id: string, patch: QuranEdit): Promise<QuranProgress> {
  // Picked column by column so nothing but content can ever be sent.
  const { surah_num, ayah_from, ayah_to, quality, tajweed_notes } = patch
  const { data, error } = await supabase
    .from('quran_progress')
    .update({ surah_num, ayah_from, ayah_to, quality, tajweed_notes })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ProgressEditRefusedError()
  return data
}
