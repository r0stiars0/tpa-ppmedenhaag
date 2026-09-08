/**
 * TPA PPME Den Haag — "Daftar Ulang" enrolment bridge (TAD ADR-043, PRD FR-010)
 * ===========================================================================
 *
 * A container-bound Apps Script on the Google Form's response spreadsheet.
 * On every submission it POSTs the row to the `enrol-from-form` Netlify
 * Function, which creates the parent account + the student + the guardian
 * link and sends the branded invitation e-mail. The outcome is written back
 * into two columns on the sheet ("Enrolment status" / "Enrolment error").
 *
 * This file is the source of truth; it is installed by hand (see
 * apps-script/README.md). Nothing deploys it automatically.
 *
 * ── Configuration (Project Settings ▸ Script properties) ──────────────────
 *   ENROL_ENDPOINT_URL   https://tpa.ppmedenhaag.nl/.netlify/functions/enrol-from-form
 *   ENROL_FORM_SECRET    the same value set as ENROL_FORM_SECRET in Netlify
 *
 * ── Question titles ──────────────────────────────────────────────────────
 * The payload is built from `e.namedValues`, which is keyed by the exact
 * question title. RENAMING A FORM QUESTION BREAKS THIS FILE — keep the
 * constants below in step with the form (PRD FR-010: a question must not
 * be renamed after go-live).
 */

var Q = {
  TIMESTAMP: 'Timestamp',
  EMAIL: 'Email Address', // the verified respondent — parent identity
  STUDENT_NAME: 'Nama siswa',
  DOB: 'Tanggal lahir',
  STUDENT_EMAIL: 'Email siswa (jika ada)',
  PARENT_NAME: 'Nama Orang Tua',
  LOCALE: 'Bahasa / Taal',
  RELATION: 'Hubungan dengan siswa',
  CONSENT: 'Saya telah membaca kebijakan privasi',
  // The form's payment question is deliberately NOT forwarded — payment/fee
  // management is out of scope (PRD Scope Boundaries). ING handles the money.
}

var STATUS_HEADER = 'Enrolment status'
var ERROR_HEADER = 'Enrolment error'

/**
 * Installable trigger target — set it up as Form submit, not the simple
 * `onFormSubmit`: `UrlFetchApp` needs the script's authorised scope, which
 * a simple trigger does not carry.
 */
function onFormSubmitInstallable(e) {
  var values = e && e.namedValues ? e.namedValues : {}
  var outcome = postEnrolment(buildPayload(values))
  writeBack_(e && e.range ? e.range.getRow() : null, outcome)
}

/** Menu for re-processing rows after a fix or a transient outage. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Enrolment')
    .addItem('Re-process selected rows', 'reprocessSelectedRows')
    .addToUi()
}

function reprocessSelectedRows() {
  var sheet = SpreadsheetApp.getActiveSheet()
  var ranges = sheet.getActiveRangeList() ? sheet.getActiveRangeList().getRanges() : [sheet.getActiveRange()]
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
  var processed = 0

  ranges.forEach(function (range) {
    for (var row = range.getRow(); row < range.getRow() + range.getNumRows(); row++) {
      if (row === 1) continue // header
      var rowValues = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0]
      var named = {}
      for (var c = 0; c < header.length; c++) {
        if (header[c]) named[header[c]] = [rowValues[c]]
      }
      writeBack_(row, postEnrolment(buildPayload(named)))
      processed++
    }
  })

  SpreadsheetApp.getUi().alert('Re-processed ' + processed + ' row(s).')
}

// ── internals ──────────────────────────────────────────────────────────────

function first_(v) {
  if (Array.isArray(v)) return v.length ? String(v[0]) : ''
  return v == null ? '' : String(v)
}

function toISODate_(raw) {
  var s = first_(raw).trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  var d = new Date(s)
  if (isNaN(d.getTime())) return s // let the server reject it and log it
  var mm = ('0' + (d.getMonth() + 1)).slice(-2)
  var dd = ('0' + d.getDate()).slice(-2)
  return d.getFullYear() + '-' + mm + '-' + dd
}

function buildPayload(named) {
  return {
    submitted_at: first_(named[Q.TIMESTAMP]) || new Date().toISOString(),
    verified_email: first_(named[Q.EMAIL]).trim(),
    parent_name: first_(named[Q.PARENT_NAME]).trim(),
    student_name: first_(named[Q.STUDENT_NAME]).trim(),
    date_of_birth: toISODate_(named[Q.DOB]),
    locale: first_(named[Q.LOCALE]).trim(),
    relation: first_(named[Q.RELATION]).trim(),
    student_email: first_(named[Q.STUDENT_EMAIL]).trim(),
    consent: first_(named[Q.CONSENT]).trim(),
  }
}

function postEnrolment(payload) {
  var props = PropertiesService.getScriptProperties()
  var url = props.getProperty('ENROL_ENDPOINT_URL')
  var secret = props.getProperty('ENROL_FORM_SECRET')
  if (!url || !secret) {
    return { status: 'error', error: 'Script properties ENROL_ENDPOINT_URL / ENROL_FORM_SECRET are not set' }
  }

  var res
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Webhook-Secret': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    })
  } catch (err) {
    return { status: 'error', error: 'Request failed: ' + err }
  }

  var code = res.getResponseCode()
  var body = {}
  try {
    body = JSON.parse(res.getContentText() || '{}')
  } catch (err) {
    body = {}
  }

  if (code >= 200 && code < 300) {
    return { status: body.status || 'enrolled', error: body.status === 'needs_attention' ? (body.error || 'needs attention') : '' }
  }
  return { status: 'error', error: (body.error || res.getContentText() || 'HTTP ' + code) }
}

/** Writes the outcome into the STATUS/ERROR columns, adding them if absent. */
function writeBack_(row, outcome) {
  if (!row) return
  var sheet = SpreadsheetApp.getActiveSheet()
  var lastCol = sheet.getLastColumn()
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0]

  var statusCol = header.indexOf(STATUS_HEADER) + 1
  var errorCol = header.indexOf(ERROR_HEADER) + 1
  if (statusCol === 0) {
    statusCol = lastCol + 1
    sheet.getRange(1, statusCol).setValue(STATUS_HEADER)
  }
  if (errorCol === 0) {
    errorCol = Math.max(statusCol, lastCol) + 1
    sheet.getRange(1, errorCol).setValue(ERROR_HEADER)
  }

  sheet.getRange(row, statusCol).setValue(outcome.status || '')
  sheet.getRange(row, errorCol).setValue(outcome.error || '')
}
