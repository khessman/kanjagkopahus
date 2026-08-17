# kjkh-analys — backend (Cloudflare Worker)

Tar emot dokumenttext (besiktning, energirapport, energideklaration, frågelista)
och returnerar en strikt JSON-analys. Kör i **MOCK-läge** tills du lägger in en
AI-nyckel — då svarar den med exempeldata och kräver inget konto.

## Testa lokalt (inget konto behövs)

```bash
cd backend
npm install -g wrangler        # engångs
npx wrangler dev               # startar på http://localhost:8787
```

I ett annat fönster:

```bash
curl -s -X POST http://localhost:8787 \
  -H 'content-type: application/json' \
  -d '{"besiktning":"Fukt i källare noterad. Dränering äldre än 30 år."}' | jq
```

Du får tillbaka ett färdigformaterat mock-svar.

## Aktivera skarp AI (senare, när du har konto)

1. Skaffa nyckel hos din leverantör (koden är skriven mot Anthropic).
2. Lägg in den som hemlighet (checkas aldrig in i git):
   ```bash
   npx wrangler secret put AI_API_KEY
   ```
3. Sätt `MOCK = "false"` i `wrangler.toml`.
4. `npx wrangler deploy`

## Koppla till din subdomän

Efter deploy: i Cloudflare-dashboarden → Workers → Triggers → Custom Domain,
lägg `api.kanjagkopahus.se`. Frontend anropar den URL:en.

## Var är gränserna?

- Gratisnivå: 100 000 anrop/dygn. Räcker med marginal.
- PDF → text görs på **klientsidan** (t.ex. pdf.js) innan anropet. Workern tar
  emot färdig text, aldrig filer.
