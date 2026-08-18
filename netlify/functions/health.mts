// Foundation-scope placeholder confirming the Functions pipeline (bundling,
// deploy, routing) works end-to-end. The 8 real functions from the TAD/
// OpenAPI spec (notify-absence, publish-report, etc.) land with the
// milestones that own them.
//
// No `config.path` export: Netlify Functions v2 already serves this at
// the default `/.netlify/functions/health` without one, and declaring it
// explicitly here — even matching that exact default — breaks routing in
// local `netlify dev` (v27.1.1): it starts treating the function as
// custom-path-only, then fails to match its own declared path, returning
// 404 for every request. Found while building invite-user.mts, which had
// the identical symptom for the identical reason.
export default async () => {
  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'content-type': 'application/json' },
  })
}
