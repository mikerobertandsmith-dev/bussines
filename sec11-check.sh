#!/usr/bin/env bash
# §11 security checks — no secret values are printed.
set -a; . ./.env.local; set +a

if [ -z "$SUPABASE_PROJECT_REF" ]; then echo "NO_PROJECT_REF"; exit 1; fi
echo "project ref: $SUPABASE_PROJECT_REF"

echo ""
echo "=== 11.1 unauthenticated calls to every gateway function ==="
for f in serp-scan serp-competitors keyword-ideas social-scan web-contacts-scan reviews-sync \
         review-reply ai-draft publish-ad social-accounts provider-webhook integrations-status; do
  code=$(curl -s -o /tmp/r.txt -w '%{http_code}' -X POST \
    "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/$f" \
    -H 'Content-Type: application/json' -d '{}')
  printf "%-22s %s  %s\n" "$f" "$code" "$(head -c 60 /tmp/r.txt)"
done
rm -f /tmp/r.txt

echo ""
echo "=== 11.2 preview mode without a token ==="
curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/web-contacts-scan" \
  -H "Content-Type: application/json" -d '{"url":"https://example.com"}' -w '\nhttp=%{http_code}\n'

echo ""
echo "=== 11.5 run ledger operator-only (anon key) ==="
K="$VITE_SUPABASE_ANON_KEY"
curl -s "https://$SUPABASE_PROJECT_REF.supabase.co/rest/v1/contacts_discovery_runs?select=id,user_id" \
  -H "apikey: $K" -w ' <- select\n'
curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/rest/v1/contacts_discovery_runs" \
  -H "apikey: $K" -H "Content-Type: application/json" \
  -d '{"user_id":"attacker","mode":"preview"}' -w ' <- insert\n'

echo ""
echo "=== 11.6 tenant tables unreadable with anon key ==="
for t in competitors competitor_social businesses clients api_usage_log; do
  printf "%-20s %s\n" "$t" "$(curl -s "https://$SUPABASE_PROJECT_REF.supabase.co/rest/v1/$t?select=id" -H "apikey: $K")"
done
