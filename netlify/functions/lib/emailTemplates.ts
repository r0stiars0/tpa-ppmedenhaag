import type { Database } from '../../../src/lib/database.types'

type UserRole = Database['public']['Enums']['user_role']
type Locale = Database['public']['Enums']['locale']

/**
 * Email copy, keyed by **role, then locale**.
 *
 * This file is meant to be edited. It is the one place the wording of an
 * email lives — deliberately not inline in a Function, because the
 * people most likely to want to change a sentence here are not the
 * people editing `invite-user.mts`. Event-specific templates (absence,
 * milestone, report-ready, reminder) will follow the same shape.
 *
 * ── Role first, then locale, and why both ───────────────────────────
 * Recipient locale comes from `users.locale` and the role from
 * `users.role`. Role matters because the invitation is a genuinely
 * different message four times over: a parent is invited to follow their
 * child, a 16+ student to follow their own progress, a tutor to record a
 * class's work, an admin to run the platform. Translating one sentence
 * into four contexts would produce copy that fits none of them.
 *
 * ── Why a role key is right *here* and wrong for an event ────────────
 * ADR-022 took the role out of deciding who receives a notification,
 * because a role cannot express a relationship to a child. That reasoning
 * does not reach this file, and the reason is the moment it runs:
 * `invite-user` sends this letter as the `public.users` row is created,
 * when the person holds **no relationships at all**. No student row can
 * name them as `parent_id` yet — that row would not have had a user to
 * point at — and linking one is a separate admin action afterwards. So
 * `users.role` here is not a stand-in for a relationship; it is the
 * admin's statement of *why* this person is being invited, which is what
 * the letter is about. A tutor-parent is invited once, in whichever
 * capacity brought them in, and their notifications are decided later by
 * their relationships.
 *
 * **The rule for the templates that follow.** Event-specific email
 * (absence, milestone, report-ready, reminder) is addressed to a person
 * *about a child*, which is exactly the question ADR-022 answers. Those
 * templates must be selected the way the push payload is — from the
 * child's row through `notifyStudents`, in the recipient's locale — and
 * **not** from `users.role`. Keying them by role would reintroduce the
 * ADR-022 bug in a second channel: a tutor whose own child is absent
 * would receive the tutor letter, or nothing at all.
 *
 * ── Register ────────────────────────────────────────────────────────
 * The Indonesian copy follows the conventions PPME's own
 * correspondence uses: the full greeting, the *Bapak/Ibu* honorific, a
 * humble institutional voice ("kami") and a formal closing. The Dutch is
 * its counterpart rather than a literal translation — a word-for-word
 * rendering of Indonesian formality reads stilted in Dutch, so it keeps
 * the courtesy and drops the constructions Dutch has no use for. The
 * Islamic greeting is kept in both, because it is the community's
 * greeting rather than a language's.
 *
 * ── Substitution ────────────────────────────────────────────────────
 * `{{placeholder}}`, filled by `render()` below, which HTML-escapes
 * every value. A name is user-supplied data going into an HTML
 * document; without escaping, a full name containing `<` would break
 * the mail, and worse could inject markup into someone else's inbox.
 */
export interface EmailTemplate {
  subject: string
  html: string
  text: string
}

export type TemplateVars = Record<string, string>

/** The app itself. `{{app_url}}` is filled from this at send time. */
export const APP_URL = 'https://ppme-tpa.netlify.app'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Fills `{{placeholder}}`s. Values are escaped for the HTML and subject
 * parts; the plain-text part gets them raw, since escaping there would
 * put literal `&amp;` in front of a reader.
 */
export function render(template: EmailTemplate, vars: TemplateVars): EmailTemplate {
  const fill = (input: string, escape: boolean) =>
    input.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
      const value = vars[key]
      if (value === undefined) return match
      return escape ? escapeHtml(value) : value
    })

  return {
    subject: fill(template.subject, false),
    html: fill(template.html, true),
    text: fill(template.text, false),
  }
}

/**
 * One shell for every email, so a template only ever writes its own
 * words. Inline styles because email clients discard `<style>` blocks,
 * and a table-free single column because that is what survives Gmail,
 * Outlook and Apple Mail alike.
 *
 * The logo is a hosted PNG (`{{app_url}}/logo-white.png`, the same file
 * `public/logo-white.png` builds to), not embedded as a data URI: Gmail
 * strips `data:` image sources outright, so an inlined logo would never
 * render even for readers who allow images. The `alt` text is the
 * wordmark, so a reader who blocks remote images — the default in most
 * clients — still sees the name instead of a blank box.
 */
function layout(bodyHtml: string, ctaLabel: string, installNote: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8f9fa;">
    <div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:'Open Sans',Arial,sans-serif;color:#333333;line-height:1.6;">
      <div style="background:#0d50a0;color:#ffffff;padding:16px 20px;border-radius:8px 8px 0 0;">
        <img src="{{app_url}}/logo-white.png" width="160" height="83" alt="TPA PPME Den Haag" style="display:block;border:0;max-width:160px;height:auto;">
      </div>
      <div style="background:#ffffff;padding:20px;border-radius:0 0 8px 8px;">
        ${bodyHtml}
        <p style="text-align:center;margin:28px 0 8px;">
          <a href="{{app_url}}" style="background:#0d50a0;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;font-weight:bold;">${ctaLabel}</a>
        </p>
        <p style="font-size:12px;color:#666666;text-align:center;margin-top:4px;">{{app_url}}</p>
      </div>
      <p style="font-size:12px;color:#666666;text-align:center;margin-top:16px;">
        ${installNote}
      </p>
      <p style="font-size:12px;color:#666666;text-align:center;margin-top:8px;">
        PPME Den Haag &middot; Taman Pendidikan Al-Qur'an
      </p>
    </div>
  </body>
</html>`
}

/**
 * A one-line nudge to install the PWA, matching the reasoning behind the
 * "Add to Home Screen" gate already shown in the notification settings
 * page (`NotificationSettingsPage.tsx`, `iosInstallTitle`/`iosInstallBody`
 * in the locale files) — iOS Web Push only works once installed, and this
 * is the first message a new account sees, so it is the earliest place to
 * say so.
 */
const INSTALL_NOTE: Record<Locale, string> = {
  id: 'Tips: tambahkan aplikasi ini ke Layar Utama ponsel Anda (menu Bagikan di Safari untuk iPhone/iPad, atau menu browser di Android) agar mudah diakses dan dapat menerima notifikasi.',
  nl: 'Tip: voeg deze app toe aan het beginscherm van je telefoon (deelmenu in Safari op iPhone/iPad, of het browsermenu op Android) voor snelle toegang en meldingen.',
}

/**
 * The invitation / onboarding email — the first thing a new account
 * receives.
 *
 * No invite token or magic link: access is Google OAuth against the
 * address an admin already registered, so the link is simply the app.
 * This is also why `invite-user.mts` sends only this one email —
 * GoTrue's own invite mail carried a link nothing here consumes, and
 * ADR-026 dropped it.
 */
export const INVITATION: Record<UserRole, Record<Locale, EmailTemplate>> = {
  parent: {
    id: {
      subject: 'Undangan: aplikasi TPA PPME Den Haag untuk {{full_name}}',
      html: layout(
        `<p>Assalamu'alaikum warahmatullahi wabarakatuh,</p>
         <p>Yang terhormat Bapak/Ibu <strong>{{full_name}}</strong>,</p>
         <p>Dengan hormat, kami dari TPA PPME Den Haag mengundang Bapak/Ibu untuk
            menggunakan aplikasi TPA. Melalui aplikasi ini Bapak/Ibu dapat memantau
            kehadiran, tugas, serta perkembangan hafalan dan bacaan putra/putri
            Bapak/Ibu selama mengikuti kegiatan di TPA.</p>
         <p>Silakan masuk menggunakan akun Google dengan alamat email ini
            (<strong>{{email}}</strong>), yang telah kami daftarkan.</p>`,
        'Buka aplikasi TPA',
        INSTALL_NOTE.id,
      ),
      text: `Assalamu'alaikum warahmatullahi wabarakatuh,

Yang terhormat Bapak/Ibu {{full_name}},

Dengan hormat, kami dari TPA PPME Den Haag mengundang Bapak/Ibu untuk menggunakan
aplikasi TPA. Melalui aplikasi ini Bapak/Ibu dapat memantau kehadiran, tugas, serta
perkembangan hafalan dan bacaan putra/putri Bapak/Ibu selama mengikuti kegiatan di TPA.

Silakan masuk menggunakan akun Google dengan alamat email ini ({{email}}),
yang telah kami daftarkan.

Buka aplikasi: {{app_url}}

Wassalamu'alaikum warahmatullahi wabarakatuh,
Pengurus TPA PPME Den Haag`,
    },
    nl: {
      subject: 'Uitnodiging: TPA PPME Den Haag-app voor {{full_name}}',
      html: layout(
        `<p>Assalamu'alaikum warahmatullahi wabarakatuh,</p>
         <p>Beste <strong>{{full_name}}</strong>,</p>
         <p>Graag nodigen wij u namens TPA PPME Den Haag uit om de TPA-app te
            gebruiken. In de app kunt u de aanwezigheid, opdrachten en de voortgang
            in memorisatie en recitatie van uw kind volgen.</p>
         <p>U kunt inloggen met uw Google-account op dit e-mailadres
            (<strong>{{email}}</strong>), dat wij al voor u hebben geregistreerd.</p>`,
        'Open de TPA-app',
        INSTALL_NOTE.nl,
      ),
      text: `Assalamu'alaikum warahmatullahi wabarakatuh,

Beste {{full_name}},

Graag nodigen wij u namens TPA PPME Den Haag uit om de TPA-app te gebruiken. In de
app kunt u de aanwezigheid, opdrachten en de voortgang in memorisatie en recitatie
van uw kind volgen.

U kunt inloggen met uw Google-account op dit e-mailadres ({{email}}), dat wij al
voor u hebben geregistreerd.

Open de app: {{app_url}}

Met vriendelijke groet,
Bestuur TPA PPME Den Haag`,
    },
  },

  student: {
    id: {
      subject: 'Undangan: aplikasi TPA PPME Den Haag',
      html: layout(
        `<p>Assalamu'alaikum warahmatullahi wabarakatuh,</p>
         <p>Ananda <strong>{{full_name}}</strong>,</p>
         <p>Kami dari TPA PPME Den Haag mengundang Ananda untuk menggunakan aplikasi
            TPA. Melalui aplikasi ini Ananda dapat melihat sendiri kehadiran, tugas,
            serta perkembangan hafalan dan bacaan Ananda di TPA.</p>
         <p>Silakan masuk menggunakan akun Google dengan alamat email ini
            (<strong>{{email}}</strong>).</p>`,
        'Buka aplikasi TPA',
        INSTALL_NOTE.id,
      ),
      text: `Assalamu'alaikum warahmatullahi wabarakatuh,

Ananda {{full_name}},

Kami dari TPA PPME Den Haag mengundang Ananda untuk menggunakan aplikasi TPA.
Melalui aplikasi ini Ananda dapat melihat sendiri kehadiran, tugas, serta
perkembangan hafalan dan bacaan Ananda di TPA.

Silakan masuk menggunakan akun Google dengan alamat email ini ({{email}}).

Buka aplikasi: {{app_url}}

Wassalamu'alaikum warahmatullahi wabarakatuh,
Pengurus TPA PPME Den Haag`,
    },
    nl: {
      subject: 'Uitnodiging: TPA PPME Den Haag-app',
      html: layout(
        `<p>Assalamu'alaikum warahmatullahi wabarakatuh,</p>
         <p>Beste <strong>{{full_name}}</strong>,</p>
         <p>Namens TPA PPME Den Haag nodigen wij je uit om de TPA-app te gebruiken.
            In de app kun je zelf je aanwezigheid, opdrachten en je voortgang in
            memorisatie en recitatie volgen.</p>
         <p>Je kunt inloggen met je Google-account op dit e-mailadres
            (<strong>{{email}}</strong>).</p>`,
        'Open de TPA-app',
        INSTALL_NOTE.nl,
      ),
      text: `Assalamu'alaikum warahmatullahi wabarakatuh,

Beste {{full_name}},

Namens TPA PPME Den Haag nodigen wij je uit om de TPA-app te gebruiken. In de app
kun je zelf je aanwezigheid, opdrachten en je voortgang in memorisatie en recitatie
volgen.

Je kunt inloggen met je Google-account op dit e-mailadres ({{email}}).

Open de app: {{app_url}}

Met vriendelijke groet,
Bestuur TPA PPME Den Haag`,
    },
  },

  tutor: {
    id: {
      subject: 'Undangan: aplikasi TPA PPME Den Haag untuk Ustadz/Ustadzah',
      html: layout(
        `<p>Assalamu'alaikum warahmatullahi wabarakatuh,</p>
         <p>Yang terhormat <strong>{{full_name}}</strong>,</p>
         <p>Dengan hormat, kami dari TPA PPME Den Haag mengundang Ustadz/Ustadzah
            untuk menggunakan aplikasi TPA. Melalui aplikasi ini Ustadz/Ustadzah
            dapat mencatat kehadiran santri, memberikan tugas, serta merekam
            perkembangan Yanbu'a, Al-Qur'an, dan murajaah untuk kelas yang diampu.</p>
         <p>Silakan masuk menggunakan akun Google dengan alamat email ini
            (<strong>{{email}}</strong>), yang telah kami daftarkan.</p>`,
        'Buka aplikasi TPA',
        INSTALL_NOTE.id,
      ),
      text: `Assalamu'alaikum warahmatullahi wabarakatuh,

Yang terhormat {{full_name}},

Dengan hormat, kami dari TPA PPME Den Haag mengundang Ustadz/Ustadzah untuk
menggunakan aplikasi TPA. Melalui aplikasi ini Ustadz/Ustadzah dapat mencatat
kehadiran santri, memberikan tugas, serta merekam perkembangan Yanbu'a, Al-Qur'an,
dan murajaah untuk kelas yang diampu.

Silakan masuk menggunakan akun Google dengan alamat email ini ({{email}}),
yang telah kami daftarkan.

Buka aplikasi: {{app_url}}

Wassalamu'alaikum warahmatullahi wabarakatuh,
Pengurus TPA PPME Den Haag`,
    },
    nl: {
      subject: 'Uitnodiging: TPA PPME Den Haag-app voor docenten',
      html: layout(
        `<p>Assalamu'alaikum warahmatullahi wabarakatuh,</p>
         <p>Beste <strong>{{full_name}}</strong>,</p>
         <p>Namens TPA PPME Den Haag nodigen wij u uit om de TPA-app te gebruiken.
            In de app kunt u de aanwezigheid van leerlingen registreren, opdrachten
            klaarzetten en de voortgang in Yanbu'a, Al-Qur'an en murajaah bijhouden
            voor de klassen die u begeleidt.</p>
         <p>U kunt inloggen met uw Google-account op dit e-mailadres
            (<strong>{{email}}</strong>), dat wij al voor u hebben geregistreerd.</p>`,
        'Open de TPA-app',
        INSTALL_NOTE.nl,
      ),
      text: `Assalamu'alaikum warahmatullahi wabarakatuh,

Beste {{full_name}},

Namens TPA PPME Den Haag nodigen wij u uit om de TPA-app te gebruiken. In de app
kunt u de aanwezigheid van leerlingen registreren, opdrachten klaarzetten en de
voortgang in Yanbu'a, Al-Qur'an en murajaah bijhouden voor de klassen die u
begeleidt.

U kunt inloggen met uw Google-account op dit e-mailadres ({{email}}), dat wij al
voor u hebben geregistreerd.

Open de app: {{app_url}}

Met vriendelijke groet,
Bestuur TPA PPME Den Haag`,
    },
  },

  admin: {
    id: {
      subject: 'Undangan: aplikasi TPA PPME Den Haag (pengurus)',
      html: layout(
        `<p>Assalamu'alaikum warahmatullahi wabarakatuh,</p>
         <p>Yang terhormat <strong>{{full_name}}</strong>,</p>
         <p>Dengan hormat, kami dari TPA PPME Den Haag mengundang Bapak/Ibu untuk
            menggunakan aplikasi TPA sebagai pengurus. Melalui aplikasi ini
            Bapak/Ibu dapat mengelola pendaftaran, kelas, dan data santri, serta
            mengakses seluruh catatan kegiatan TPA.</p>
         <p>Silakan masuk menggunakan akun Google dengan alamat email ini
            (<strong>{{email}}</strong>), yang telah kami daftarkan.</p>`,
        'Buka aplikasi TPA',
        INSTALL_NOTE.id,
      ),
      text: `Assalamu'alaikum warahmatullahi wabarakatuh,

Yang terhormat {{full_name}},

Dengan hormat, kami dari TPA PPME Den Haag mengundang Bapak/Ibu untuk menggunakan
aplikasi TPA sebagai pengurus. Melalui aplikasi ini Bapak/Ibu dapat mengelola
pendaftaran, kelas, dan data santri, serta mengakses seluruh catatan kegiatan TPA.

Silakan masuk menggunakan akun Google dengan alamat email ini ({{email}}),
yang telah kami daftarkan.

Buka aplikasi: {{app_url}}

Wassalamu'alaikum warahmatullahi wabarakatuh,
Pengurus TPA PPME Den Haag`,
    },
    nl: {
      subject: 'Uitnodiging: TPA PPME Den Haag-app (beheer)',
      html: layout(
        `<p>Assalamu'alaikum warahmatullahi wabarakatuh,</p>
         <p>Beste <strong>{{full_name}}</strong>,</p>
         <p>Namens TPA PPME Den Haag nodigen wij u uit om de TPA-app als beheerder
            te gebruiken. In de app kunt u registraties, klassen en leerlinggegevens
            beheren en heeft u toegang tot alle vastgelegde TPA-activiteiten.</p>
         <p>U kunt inloggen met uw Google-account op dit e-mailadres
            (<strong>{{email}}</strong>), dat wij al voor u hebben geregistreerd.</p>`,
        'Open de TPA-app',
        INSTALL_NOTE.nl,
      ),
      text: `Assalamu'alaikum warahmatullahi wabarakatuh,

Beste {{full_name}},

Namens TPA PPME Den Haag nodigen wij u uit om de TPA-app als beheerder te
gebruiken. In de app kunt u registraties, klassen en leerlinggegevens beheren en
heeft u toegang tot alle vastgelegde TPA-activiteiten.

U kunt inloggen met uw Google-account op dit e-mailadres ({{email}}), dat wij al
voor u hebben geregistreerd.

Open de app: {{app_url}}

Met vriendelijke groet,
Bestuur TPA PPME Den Haag`,
    },
  },
}

/**
 * The invitation email for one recipient, ready to send.
 *
 * Locale falls back to `id` rather than throwing: a missing or unknown
 * locale should send a slightly-wrong-language email, never no email.
 */
export function invitationEmail(args: {
  role: UserRole
  locale: Locale | null | undefined
  fullName: string
  email: string
}): EmailTemplate {
  const locale: Locale = args.locale === 'nl' ? 'nl' : 'id'
  return render(INVITATION[args.role][locale], {
    full_name: args.fullName,
    email: args.email,
    app_url: APP_URL,
  })
}
