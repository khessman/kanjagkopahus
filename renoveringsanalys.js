/* Renoveringsanalysen som återanvändbar komponent.
   husanalys.html monterar den som hel sida, kalkylatorns kort 9 i kompakt läge.
   Kräver renoveringsanalys.css, pdf.js och Stripe på värdsidan.

   Renoveringsanalys.mount({
     host:        element eller id att rendera i,
     compact:     true = komponenten ligger redan i ett kort,
     returnFlow:  false = visa ingen "Använd & tillbaka" (samma sida),
     hamtaLank:   funktion som returnerar en annonslänk att förifylla,
     onTotal:     funktion som får {lo, hi, mid, any} varje gång summan ändras
   }); */
window.Renoveringsanalys = (function(){
  "use strict";

  var MARKUP = `  <div class="card">
    <h2>1 · Ladda upp dokument</h2>
    <div class="betanote" id="returnHint" style="display:none">
      Du kom hit från <b id="returnHintFrom">guiden</b>. Kör en ny analys nedan, eller öppna en sparad analys längre ner - klicka sedan <b>"Använd &amp; tillbaka"</b> i resultatet för att ta med renoveringssumman dit du var.
    </div>
    <p class="sub">PDF, text eller HTML. Minst ett dokument krävs - fler ger bättre analys. Filerna läses i din webbläsare.<span id="priceNote" style="display:none"> <b>Första analysen är gratis</b>, därefter 5 kr per objekt.</span></p>

    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:8px">
      <div style="flex:1;min-width:200px">
        <label for="booliDocUrl" style="font-size:12.5px;font-weight:600;color:var(--ink-soft);display:block;margin-bottom:5px">Booli- eller Hemnet-länk <span style="font-weight:400">- hämta dokument automatiskt från mäklaren (best-effort)</span></label>
        <input type="url" id="booliDocUrl" placeholder="https://www.booli.se/... eller https://www.hemnet.se/..." style="font-family:inherit;font-size:15px;padding:11px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--fill);color:var(--ink);width:100%">
      </div>
      <button class="go" type="button" id="booliDocBtn" style="padding:11px 20px;font-size:14px">Hämta dokument</button>
    </div>
    <div class="status" id="booliDocStatus" style="margin-bottom:14px;min-height:1.2em"></div>

    <div class="drop" data-key="besiktning">
      <div class="meta"><div class="nm">Besiktningsprotokoll</div><div class="st">Ingen fil vald</div></div>
      <button class="pick" type="button">Välj fil</button>
      <input type="file" accept=".pdf,.txt,.md,.csv,.html,.htm,application/pdf,text/plain,text/html,text/markdown,text/csv" hidden>
    </div>

    <div class="drop" data-key="energirapport">
      <div class="meta"><div class="nm">Energirapport</div><div class="st">Ingen fil vald</div></div>
      <button class="pick" type="button">Välj fil</button>
      <input type="file" accept=".pdf,.txt,.md,.csv,.html,.htm,application/pdf,text/plain,text/html,text/markdown,text/csv" hidden>
    </div>

    <div class="drop" data-key="energideklaration">
      <div class="meta"><div class="nm">Energideklaration</div><div class="st">Ingen fil vald</div></div>
      <button class="pick" type="button">Välj fil</button>
      <input type="file" accept=".pdf,.txt,.md,.csv,.html,.htm,application/pdf,text/plain,text/html,text/markdown,text/csv" hidden>
    </div>

    <div class="drop" data-key="fragelista">
      <div class="meta"><div class="nm">Frågelista</div><div class="st">Ingen fil vald</div></div>
      <button class="pick" type="button">Välj fil</button>
      <input type="file" accept=".pdf,.txt,.md,.csv,.html,.htm,application/pdf,text/plain,text/html,text/markdown,text/csv" hidden>
    </div>

    <div class="actions">
      <button class="go" id="goBtn" disabled>Analysera</button>
      <button class="go" type="button" id="manualBtn">Fyll i själv</button>
      <span class="status" id="status"></span>
    </div>
  </div>

  <div class="card" id="manualCard" style="display:none">
    <h2>Fyll i själv</h2>
    <p class="sub">Bygg listan manuellt gratis. Välj åtgärd så fylls en grov schablon i, eller välj "Annat" och skriv eget pris. Priset per rad kan du alltid ändra i resultatet nedan. Summan sparas i din webbläsare.</p>
    <div class="actions" style="margin-top:0">
      <select id="manualCat" style="font-family:inherit;font-size:14px;padding:11px 12px;border-radius:10px;border:1.5px solid var(--line);background:var(--fill);color:var(--ink);flex:1;min-width:180px"></select>
      <button class="go" type="button" id="manualAdd" style="padding:11px 20px;font-size:14px">Lägg till</button>
    </div>
    <div id="manualList" style="margin-top:14px;display:flex;flex-direction:column;gap:8px"></div>
  </div>

  <div class="card" id="paywall" style="display:none">
    <h2>Lås upp analysen – 5 kr</h2>
    <p class="sub">Din gratisanalys är använd. Betala 5 kr för att analysera det här objektet (kort, Apple Pay eller Google Pay). Ett köp = en analys. Resultatet sparas i din webbläsare.</p>
    <div id="checkout"></div>
    <div class="actions"><button class="pick" type="button" id="cancelPay">Avbryt</button></div>
  </div>

  <div class="card" id="result">
    <h2>2 · Resultat</h2>
    <div id="returnBox" style="display:none;margin:0 0 16px">
      <button class="go returnGo" type="button" style="padding:12px 20px;font-size:14.5px;width:100%">Använd &amp; tillbaka →</button>
    </div>
    <p class="sub" style="margin:-6px 0 14px">Har du en offert? Skriv in ditt eget pris på raden - annars används en grov schablon. Summan uppdateras direkt och sparas i din webbläsare.</p>
    <div class="kallor" id="kallor"></div>
    <div class="facts" id="facts"></div>
    <table class="at">
      <thead><tr>
        <th>Åtgärd</th>
        <th class="hidesm">Brådska</th>
        <th class="hidesm">Källa</th>
        <th class="r">Kostnad (din/schablon)</th>
      </tr></thead>
      <tbody id="atgarder"></tbody>
    </table>
    <div class="sumbar">
      <span class="k">Summa åtgärder (grovt intervall)</span>
      <span class="v" id="summa">-</span>
    </div>
    <div class="disc" id="friskrivning"></div>
  </div>

  <div class="card" id="history" style="display:none">
    <h2>Dina sparade analyser</h2>
    <p class="sub" id="returnHintHistory" style="display:none">Öppna en sparad analys nedan för att använda den - knappen "Använd &amp; tillbaka" dyker upp i resultatet ovan.</p>
    <p class="sub">Sparas bara i den här webbläsaren – ingen inloggning behövs. Obs: rensar du webbläsardata (cookies/historik) försvinner de. Vill du behålla en analys, spara den separat.</p>
    <div id="historyList"></div>
  </div>
`;

  function mount(opts){
    var OPTS = opts || {};
    var host = typeof OPTS.host === "string" ? document.getElementById(OPTS.host) : OPTS.host;
    if (!host) return null;
    host.classList.add("rva");
    if (OPTS.compact) host.classList.add("compact");
    host.innerHTML = MARKUP;
    // I kompakt läge sitter komponenten redan i ett numrerat kort - då blir
    // "1 ·" och "2 ·" i rubrikerna bara förvirrande.
    if (OPTS.compact) host.querySelectorAll("h2").forEach(function(h){
      h.textContent = h.textContent.replace(/^\d+\s*·\s*/, "");
    });


    // === Konfiguration ======================================================
    // Peka på din backend (Cloudflare Worker).
    // Lokalt (wrangler dev): http://localhost:8787 - annars den deployade Workern.
    var API_URL = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
        ? "http://localhost:8787"
        : "https://kjkh-analys.kalle-hessman.workers.dev";

    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    var files = {};                 // key -> File
    var statusEl = document.getElementById("status");
    var goBtn = document.getElementById("goBtn");

    // === Filval =============================================================
    host.querySelectorAll(".drop").forEach(function(drop){
      var key = drop.dataset.key;
      var input = drop.querySelector("input[type=file]");
      drop.querySelector(".pick").addEventListener("click", function(){ input.click(); });
      input.addEventListener("change", function(){
        var f = input.files[0];
        var st = drop.querySelector(".st");
        if (f && f.size > 12 * 1024 * 1024) {
          st.textContent = "Filen är för stor (max 12 MB).";
          input.value = ""; return;
        }
        if (f) {
          files[key] = f;
          drop.classList.add("filled");
          st.textContent = f.name + " (" + Math.round(f.size/1024) + " kB)";
          drop.querySelector(".pick").textContent = "Byt";
        } else {
          delete files[key];
          drop.classList.remove("filled");
          st.textContent = "Ingen fil vald";
        }
        goBtn.disabled = Object.keys(files).length === 0;
      });
    });

    // === Auto-hämta dokument från mäklaren via Booli-/Hemnet-länk (best-effort) ==
    // Anropar booli-parsern: /docs hittar mäklarlänk + PDF:er, /docfetch proxar
    // varje PDF (med CORS) så pdf.js kan läsa den. Faller något -> ladda upp själv.
    var PARSER_BASE = "https://kjkh-booliparser.kalle-hessman.workers.dev";
    var DOC_KEY = { besiktning:"besiktning", energideklaration:"energideklaration", fragelista:"fragelista" };
    function setFileForKey(key, file){
      var drop = document.querySelector('.drop[data-key="'+key+'"]');
      if(!drop) return;
      files[key] = file;
      drop.classList.add("filled");
      drop.querySelector(".st").textContent = file.name + " (" + Math.round(file.size/1024) + " kB)";
      drop.querySelector(".pick").textContent = "Byt";
      goBtn.disabled = Object.keys(files).length === 0;
    }
    var booliDocBtn = document.getElementById("booliDocBtn");
    if (booliDocBtn) booliDocBtn.addEventListener("click", async function(){
      var url = document.getElementById("booliDocUrl").value.trim();
      var st = document.getElementById("booliDocStatus");
      if(!url){ st.textContent = "Klistra in en Booli- eller Hemnet-länk först."; return; }
      booliDocBtn.disabled = true;
      st.textContent = "Söker dokument hos mäklaren…";
      try{
        var r = await fetch(PARSER_BASE + "/docs?url=" + encodeURIComponent(url));
        var d = await r.json();
        if(!r.ok){ throw new Error(d.detail || r.statusText); }
        var docs = (d.dokument || []).filter(function(x){ return DOC_KEY[x.typ]; });
        if(!docs.length){ st.textContent = (d.notes && d.notes[0]) || "Hittade inga dokument. Ladda upp själv nedan."; return; }
        var fick = [], fel = [];
        for (var i=0;i<docs.length;i++){
          var doc = docs[i], key = DOC_KEY[doc.typ];
          if(files[key]) continue;                        // redan ifyllt (t.ex. uppladdat)
          st.textContent = "Hämtar " + doc.typ + "…";
          try{
            var pr = await fetch(PARSER_BASE + "/docfetch?url=" + encodeURIComponent(doc.url));
            if(!pr.ok) throw new Error("nås ej");
            var blob = await pr.blob();
            if(blob.size > 12*1024*1024) throw new Error("för stor");
            // Länken kan peka på en generisk artikelsida hos mäklaren istället för
            // en riktig PDF (samma nyckelord matchar båda) - upptäck det HÄR, innan
            // pdf.js kraschar längre fram med ett obegripligt "Invalid PDF structure".
            if(!/pdf/i.test(blob.type)) throw new Error("inte en PDF");
            setFileForKey(key, new File([blob], doc.typ + ".pdf", { type: blob.type || "application/pdf" }));
            fick.push(doc.typ);
          }catch(e){ fel.push(doc.typ); }
        }
        st.textContent = (fick.length ? "Hämtade: " + fick.join(", ") + ". " : "") +
          (fel.length ? "Kunde inte hämta: " + fel.join(", ") + " - ladda upp dem själv nedan." : "Klart - klicka Analysera.");
      }catch(e){
        st.textContent = "Kunde inte hämta dokument: " + e.message + ". Ladda upp själv nedan.";
      }finally{
        booliDocBtn.disabled = false;
      }
    });

    // === Fil -> text (PDF, text, HTML) ======================================
    async function fileToText(file){
      var name = (file.name || "").toLowerCase();
      var type = file.type || "";
      if (type === "application/pdf" || name.endsWith(".pdf")){
        return await pdfToText(file);
      }
      var raw = await file.text();
      if (type === "text/html" || name.endsWith(".html") || name.endsWith(".htm")){
        return htmlToText(raw);
      }
      return raw.replace(/\s+\n/g, "\n").trim();   // .txt, .md, .csv m.fl.
    }

    async function pdfToText(file){
      var buf = await file.arrayBuffer();
      var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      var out = [];
      for (var p = 1; p <= pdf.numPages; p++){
        var page = await pdf.getPage(p);
        var content = await page.getTextContent();
        out.push(content.items.map(function(i){ return i.str; }).join(" "));
      }
      return out.join("\n").replace(/\s+\n/g, "\n").trim();
    }

    // Säker HTML->text: DOMParser skapar ett INERT dokument (inga script körs,
    // inga onerror/onload triggas – vi rör aldrig live-DOM). Vi tar bort kod-
    // element och läser bara den synliga texten.
    function htmlToText(html){
      try {
        var doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("script,style,noscript,template,iframe,object,embed").forEach(function(el){ el.remove(); });
        var t = (doc.body || doc.documentElement || {}).textContent || "";
        return t.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
      } catch (e) {
        // Fallback: grov tag-strippning om DOMParser inte finns.
        return html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ").trim();
      }
    }

    // === Cache i webbläsaren (localStorage) =================================
    // Samma dokument => visa sparat resultat direkt, utan nytt AI-anrop.
    var DOCKEYS = ["besiktning", "energirapport", "energideklaration", "fragelista"];

    async function docsHash(payload){
      var canonical = DOCKEYS.map(function(k){ return payload[k] || ""; }).join(" ");
      var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      return [].map.call(new Uint8Array(buf), function(b){
        return b.toString(16).padStart(2, "0");
      }).join("");
    }
    function cacheGet(hash){
      try { var v = localStorage.getItem("kjkh:" + hash); return v ? JSON.parse(v) : null; }
      catch (e) { return null; }
    }
    function cacheSet(hash, data){
      try { localStorage.setItem("kjkh:" + hash, JSON.stringify(data)); } catch (e) { /* full kvot – strunt i det */ }
    }

    // === Historik: index över sparade analyser ==============================
    function indexGet(){
      try { return JSON.parse(localStorage.getItem("kjkh:index") || "[]"); } catch (e) { return []; }
    }
    function indexSet(list){ try { localStorage.setItem("kjkh:index", JSON.stringify(list.slice(0, 50))); } catch (e) {} }
    function indexAdd(hash, data){
      var prev = indexGet().filter(function(e){ return e.hash !== hash; });
      var s = data.summering || {};
      var o = data.objekt || {};
      prev.unshift({
        hash: hash,
        ts: Date.now(),
        count: (data.atgarder || []).length,
        lo: s.total_lag_sek,
        hi: s.total_hog_sek,
        namn: (o.adress && o.adress !== "n/a") ? o.adress : "",   // föreslå gatuadress om AI gav den
      });
      indexSet(prev);
    }
    function indexRename(hash, namn){
      var list = indexGet(); var e = list.filter(function(x){ return x.hash === hash; })[0];
      if (e){ e.namn = namn; indexSet(list); }
    }
    function indexRemove(hash){
      indexSet(indexGet().filter(function(e){ return e.hash !== hash; }));
      try { localStorage.removeItem("kjkh:" + hash); } catch (e) {}   // ta bort själva analysen ur cachen
      renderHistory();
    }
    function openSaved(hash){
      var saved = cacheGet(hash);
      if (saved){
        render(saved, hash);
        setStatus("Visar sparad analys. Summan är bryggad till startsidan och kalkylatorn.", false, false);
        document.getElementById("result").scrollIntoView({ behavior:"smooth", block:"start" });
      }
    }
    function renderHistory(){
      var list = indexGet();
      var card = document.getElementById("history");
      var box = document.getElementById("historyList");
      if (!list.length){ card.style.display = "none"; return; }
      card.style.display = "block";
      box.innerHTML = list.map(function(e){
        var when = new Date(e.ts).toLocaleDateString("sv-SE", { year:"numeric", month:"short", day:"numeric" });
        var kostnad = (typeof e.lo === "number" && typeof e.hi === "number")
          ? new Intl.NumberFormat("sv-SE").format(e.lo) + "–" + new Intl.NumberFormat("sv-SE").format(e.hi) + " kr"
          : "kostnad n/a";
        var namn = (e.namn || "").replace(/"/g, "&quot;");
        return '<div class="histrow" data-hash="' + e.hash + '">' +
          '<div class="hmeta">' +
            '<input class="hnamn" value="' + namn + '" placeholder="Namnge (t.ex. gatuadress)">' +
            '<div class="hs">' + e.count + ' åtgärder · ' + kostnad + ' · ' + when + '</div>' +
          '</div>' +
          '<div class="hbtns"><button class="hopen" type="button">Öppna →</button>' +
          '<button class="hdel" type="button" title="Ta bort">×</button></div></div>';
      }).join("");
      box.querySelectorAll(".histrow").forEach(function(row){
        var hash = row.dataset.hash;
        row.querySelector(".hopen").addEventListener("click", function(){ openSaved(hash); });
        row.querySelector(".hdel").addEventListener("click", function(){
          if (confirm("Ta bort den här sparade analysen?")) indexRemove(hash);
        });
        var inp = row.querySelector(".hnamn");
        inp.addEventListener("change", function(){ indexRename(hash, inp.value.trim()); });
      });
    }

    // === Gratis-först + betalning ===========================================
    var STRIPE_PK = "pk_live_51U5UfJLk9GS9w3CI2oqsiyQOsxgRBfJBmMhVR8dyblAiYKusp2e6H8OH701jb0IDOxGVdO7j2hZ9tR9qhbSzlAOK00apwDJYOc";
    var stripe = window.Stripe ? Stripe(STRIPE_PK) : null;
    var PRICE_KR = 5;
    var SUPPORT_EMAIL = "kalle.hessman@gmail.com";  // dit kunder mejlar för refund
    var _checkout = null;
    // Skarpt läge: betalning på för alla (gratis första, sen 5 kr).
    var PAY_ENABLED = true;

    // Ägar-läge: alltid gratis (för dig som äger sidan), aldrig någon betalvägg.
    // Aktivera EN gång per enhet med länken  husanalys.html?owner=DITT_KODORD
    // Stäng av med  ?owner=off . Byt kodordet nedan till något bara du vet.
    var OWNER_CODE = "snokhus-7412";
    (function(){
      var q = new URLSearchParams(location.search).get("owner");
      try {
        if (q === OWNER_CODE) localStorage.setItem("kjkh:owner", "1");
        else if (q === "off") localStorage.removeItem("kjkh:owner");
      } catch (e) {}
    })();
    function ownerMode(){ try { return localStorage.getItem("kjkh:owner") === "1"; } catch (e) { return false; } }

    function freeUsed(){ try { return localStorage.getItem("kjkh:freeUsed") === "1"; } catch (e) { return false; } }
    function setFreeUsed(){ try { localStorage.setItem("kjkh:freeUsed", "1"); } catch (e) {} }

    // Betald men ännu inte slutförd analys: sparas så en betalning aldrig går
    // förlorad om själva analysen kraschar. Rensas först när analysen lyckats.
    // (Ett fack i taget – räcker gott: kunden gör om samma objekt, inte ett nytt.)
    function getPending(){ try { return JSON.parse(localStorage.getItem("kjkh:pendingPaid") || "null"); } catch (e) { return null; } }
    function setPending(p){ try { localStorage.setItem("kjkh:pendingPaid", JSON.stringify(p)); } catch (e) {} }
    function clearPending(){ try { localStorage.removeItem("kjkh:pendingPaid"); } catch (e) {} }

    // Betald analys misslyckades: räkna upp försök, behåll betalningen, och ge
    // en refund-väg om felet håller i sig. Ingen ny debitering sker.
    function failPaid(e){
      var p = getPending() || {};
      p.fails = (p.fails || 0) + 1;
      setPending(p);
      if (p.fails >= 2){
        setStatus("Du har betalat men analysen gick inte att slutföra (" + e.message +
          "). Ingen ny betalning behövs. Kvarstår felet – mejla " + SUPPORT_EMAIL +
          " med referens " + (p.session_id || "") + " så återbetalar vi.", true, false);
      } else {
        setStatus("Betalt, men analysen misslyckades: " + e.message +
          " Klicka Analysera igen – din betalning är kvar, ingen ny debitering.", true, false);
      }
    }

    // === Analysera ==========================================================
    goBtn.addEventListener("click", async function(){
      goBtn.disabled = true;
      setStatus("Läser dokument…", false, true);
      try {
        var payload = {};
        for (var key in files){
          payload[key] = await fileToText(files[key]);
        }
        var hash = await docsHash(payload);

        // Redan analyserat exakt detta underlag? Visa sparat (alltid gratis).
        var saved = cacheGet(hash);
        if (saved){
          render(saved, hash);
          setStatus("Visar sparat resultat (samma dokument analyserades tidigare).", false, false);
          return;
        }

        // Finns en betald men ej slutförd analys för exakt detta objekt?
        // Kör om med SAMMA session – ingen ny betalning.
        var pending = getPending();
        if (pending && pending.session_id && pending.hash === hash){
          try {
            await runAnalysis(payload, hash, pending.session_id);
            setStatus("Klart – din tidigare betalda analys slutfördes.", false, false);
          } catch (e){
            failPaid(e);
          }
          return;
        }

        if (!PAY_ENABLED || ownerMode()){
          await runAnalysis(payload, hash, null);        // avstängd betalning ELLER ägar-läge – gratis
          setStatus("Klart.", false, false);
        } else if (!freeUsed()){
          await runAnalysis(payload, hash, null);        // gratis första
          setFreeUsed();
          setStatus("Klart – detta var din gratisanalys. Nästa objekt kostar " + PRICE_KR + " kr.", false, false);
        } else {
          await startPayment(payload, hash);             // betalvägg
        }
      } catch (err) {
        setStatus("Kunde inte analysera: " + err.message, true, false);
      } finally {
        goBtn.disabled = Object.keys(files).length === 0;
      }
    });

    // Kör analysen mot Workern (paidSession = null för gratis) och sparar den.
    async function runAnalysis(payload, hash, paidSession){
      setStatus("Analyserar…", false, true);
      var body = {};
      for (var k in payload){ body[k] = payload[k]; }
      if (paidSession){ body.paid_session = paidSession; }
      var res = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      var data = await res.json();
      if (!res.ok) throw new Error((data.error || ("HTTP " + res.status)) + (data.detalj ? " (" + data.detalj + ")" : ""));
      cacheSet(hash, data);
      indexAdd(hash, data);
      var _p = getPending();
      if (_p && _p.hash === hash) clearPending();   // betalningen är kvitterad
      renderHistory();
      render(data, hash);
    }

    // Öppnar Stripes inbäddade betalning; kör betald analys när betalningen är klar.
    async function startPayment(payload, hash){
      if (!stripe){ setStatus("Betalning kunde inte laddas. Ladda om sidan.", true, false); return; }
      setStatus("Öppnar betalning…", false, true);
      var r = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create-checkout" })
      });
      var s = await r.json();
      if (!r.ok || !s.client_secret){ throw new Error(s.error || "Kunde inte starta betalning."); }

      showPaywall();
      _checkout = await stripe.initEmbeddedCheckout({
        clientSecret: s.client_secret,
        onComplete: async function(){
          hidePaywall();
          // Kvittera betalningen lokalt FÖRST – så den överlever även om analysen
          // kraschar eller sidan laddas om innan resultatet kommit.
          setPending({ session_id: s.session_id, hash: hash, fails: 0 });
          try {
            await runAnalysis(payload, hash, s.session_id);
            setStatus("Betalt och klart.", false, false);
          } catch (e){
            failPaid(e);
          }
        }
      });
      _checkout.mount("#checkout");
      setStatus("", false, false);
    }

    function showPaywall(){
      var pw = document.getElementById("paywall");
      pw.style.display = "block";
      pw.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function hidePaywall(){
      document.getElementById("paywall").style.display = "none";
      if (_checkout){ try { _checkout.destroy(); } catch (e) {} _checkout = null; }
    }
    document.getElementById("cancelPay").addEventListener("click", function(){
      hidePaywall();
      setStatus("Betalning avbruten.", false, false);
    });

    function setStatus(text, isErr, busy){
      statusEl.className = "status" + (isErr ? " err" : "");
      statusEl.innerHTML = (busy ? '<span class="spin"></span>' : "") + text;
    }

    // === Rendering ==========================================================
    function kr(n){
      if (n === "n/a" || n == null) return "n/a";
      return new Intl.NumberFormat("sv-SE").format(n) + " kr";
    }
    function esc(s){
      return String(s == null ? "" : s).replace(/[&<>]/g, function(c){
        return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];
      });
    }

    var KALLOR = { besiktning:"Besiktning", energirapport:"Energirapport",
                   energideklaration:"Energideklaration", fragelista:"Frågelista" };
    var BRADSKA = { akut:"Akut", inom_nagra_ar:"Inom några år", pa_sikt:"På sikt" };

    // === Egna priser: override av schablon per åtgärd, sparas i localStorage ===
    var _atg = [], _hash = "";
    function ovKey(){ return "kjkh:ov:" + _hash; }
    function loadOv(){ try{ return JSON.parse(localStorage.getItem(ovKey())||"{}"); }catch(e){ return {}; } }
    function recalcTotal(){
      var lo=0, hi=0, any=false, ov={};
      host.querySelectorAll("#atgarder .kostinp").forEach(function(inp){
        var i=+inp.dataset.i, a=_atg[i]||{}, v=inp.value.trim();
        var sLo=(a.kostnad_lag_sek==="n/a")?null:a.kostnad_lag_sek;
        var sHi=(a.kostnad_hog_sek==="n/a")?null:a.kostnad_hog_sek;
        if(v!==""){ var n=parseFloat(v.replace(/\s/g,"").replace(",","."))||0; lo+=n; hi+=n; any=true; ov[i]=n; }
        else if(sLo!=null && sHi!=null){ lo+=sLo; hi+=sHi; any=true; }
      });
      document.getElementById("summa").textContent = any ? (kr(lo)+" – "+kr(hi)) : "n/a";
      try{ localStorage.setItem(ovKey(), JSON.stringify(ov)); }catch(e){}
      // Brygga till värderingskalkylen (Del 2): renoveringstotalen
      var mid = Math.round((lo+hi)/2);
      try{ localStorage.setItem("kjkh:renovtotal", JSON.stringify({lo:lo, hi:hi, mid:mid, ts:Date.now()})); }catch(e){}
      if (OPTS.onTotal) OPTS.onTotal({ lo:lo, hi:hi, mid:mid, any:any });
    }

    function render(d, hash){
      if (hash) _hash = hash;
      _atg = d.atgarder || [];
      // Källor
      var kEl = document.getElementById("kallor");
      kEl.innerHTML = Object.keys(KALLOR).map(function(k){
        var on = d.kallor && d.kallor[k];
        return '<span class="kpill'+(on?" on":"")+'">'+KALLOR[k]+'</span>';
      }).join("");

      // Objektfakta
      var o = d.objekt || {};
      var facts = [["Typ",o.typ],["Byggår",o.byggar],["Boarea",o.boarea_kvm==="n/a"?"n/a":o.boarea_kvm+" m²"],["Energiklass",o.energiklass]];
      document.getElementById("facts").innerHTML = facts.map(function(f){
        return '<div class="f"><div class="fl">'+f[0]+'</div><div class="fv">'+esc(f[1])+'</div></div>';
      }).join("");

      // Åtgärder
      var _ov = loadOv();
      var rows = _atg.map(function(a, i){
        var br = a.bradska && BRADSKA[a.bradska] ? a.bradska : "na";
        var brLbl = BRADSKA[a.bradska] || "n/a";
        var kalla = KALLOR[a.kalla] || "n/a";
        var na = (a.kostnad_lag_sek==="n/a"||a.kostnad_hog_sek==="n/a");
        var schab = na ? "n/a" : (kr(a.kostnad_lag_sek)+" – "+kr(a.kostnad_hog_sek));
        var ovVal = (_ov[i]!=null) ? _ov[i] : "";
        return '<tr>'+
          '<td><div class="rub">'+esc(a.rubrik)+'</div>'+
            (a.beskrivning?'<div class="desc">'+esc(a.beskrivning)+'</div>':'')+'</td>'+
          '<td class="hidesm"><span class="tag '+br+'">'+brLbl+'</span></td>'+
          '<td class="hidesm">'+kalla+'<div class="sak">säkerhet: '+esc(a.sakerhet||"n/a")+'</div></td>'+
          '<td class="r"><input class="kostinp'+(ovVal!==""?" egen":"")+'" type="number" inputmode="numeric" data-i="'+i+'" value="'+ovVal+'" placeholder="'+(na?"":a.kostnad_lag_sek)+'">'+
            '<div class="schab">schablon: '+schab+'</div></td>'+
        '</tr>';
      }).join("");
      document.getElementById("atgarder").innerHTML = rows ||
        '<tr><td colspan="4" style="color:var(--ink-soft)">Inga åtgärder kunde utläsas ur underlaget.</td></tr>';
      host.querySelectorAll("#atgarder .kostinp").forEach(function(inp){
        inp.addEventListener("input", function(){ inp.classList.toggle("egen", inp.value.trim()!==""); recalcTotal(); });
      });
      recalcTotal();

      document.getElementById("friskrivning").textContent = d.friskrivning || "";
      document.getElementById("result").style.display = "block";
      document.getElementById("result").scrollIntoView({ behavior:"smooth", block:"start" });
    }

    // === "Fyll i själv"-läge: bygg åtgärdslistan manuellt =====
    // Fallback-lista om /prices inte kan hämtas (samma schabloner som Workern).
    var PRICES_FALLBACK = [
      {id:"dranering",namn:"Dränering",lag:150000,hog:200000},
      {id:"fuktsanering_kallare",namn:"Fuktsanering källare",lag:25000,hog:70000},
      {id:"tak_omlaggning",namn:"Takomläggning",lag:70000,hog:150000},
      {id:"tak_rengoring",namn:"Takrengöring",lag:2000,hog:10000},
      {id:"elcentral",namn:"Elcentral (byte)",lag:10000,hog:22000},
      {id:"el_omdragning",namn:"Omdragning av el",lag:35000,hog:90000},
      {id:"tillaggsisolering_vind",namn:"Tilläggsisolering vind",lag:15000,hog:40000},
      {id:"fonsterbyte",namn:"Fönsterbyte",lag:40000,hog:100000},
      {id:"fasadmalning",namn:"Fasadmålning",lag:30000,hog:70000},
      {id:"fasad_omputs",namn:"Omputsning fasad",lag:70000,hog:160000},
      {id:"stambyte",namn:"Stambyte",lag:120000,hog:300000},
      {id:"badrum",namn:"Renovering badrum",lag:70000,hog:150000},
      {id:"kok",namn:"Renovering kök",lag:70000,hog:170000},
      {id:"varmepump_luftvatten",namn:"Värmepump (luft/vatten)",lag:80000,hog:150000},
      {id:"varmepump_luftluft",namn:"Värmepump (luft/luft)",lag:12000,hog:28000},
      {id:"ventilation_ftx",namn:"Ventilation (FTX)",lag:70000,hog:140000},
      {id:"avlopp_relining",namn:"Relining avlopp",lag:35000,hog:80000},
      {id:"ytterdorr",namn:"Ytterdörr (byte)",lag:10000,hog:25000},
      {id:"radon",namn:"Radonåtgärd",lag:15000,hog:50000},
      {id:"annat",namn:"Annat (eget pris)",lag:"n/a",hog:"n/a"}
    ];
    var _prices = null, _manual = [], _pricesLoaded = false;

    function fillCatSelect(list){
      var sel = document.getElementById("manualCat");
      sel.innerHTML = list.map(function(p){ return '<option value="'+p.id+'">'+esc(p.namn)+'</option>'; }).join("");
    }
    function loadPrices(cb){
      if (_prices){ cb(_prices); return; }
      fetch(API_URL, { method:"POST", headers:{"content-type":"application/json"},
          body: JSON.stringify({ action:"prices" }) })
        .then(function(r){ return r.json(); })
        .then(function(d){ _prices = (d && d.kategorier && d.kategorier.length) ? d.kategorier : PRICES_FALLBACK; cb(_prices); })
        .catch(function(){ _prices = PRICES_FALLBACK; cb(_prices); });
    }
    function priceById(id){ return (_prices||PRICES_FALLBACK).filter(function(p){ return p.id===id; })[0]; }

    // Bygger ett AI-likt svarsobjekt av de manuella raderna och återanvänder render().
    function renderManual(){
      var atg = _manual.map(function(m){
        return { rubrik:m.namn, beskrivning:"", kategori:m.id, bradska:"na",
                 kostnad_lag_sek:m.lag, kostnad_hog_sek:m.hog, sakerhet:"n/a", kalla:"na" };
      });
      render({ objekt:{typ:"n/a",byggar:"n/a",boarea_kvm:"n/a",energiklass:"n/a"},
               kallor:{}, atgarder:atg,
               friskrivning:"Manuellt ifylld lista. Schablonerna är grova - hämta gärna offert för säkrare siffror." },
             "manual");
      // Chips med möjlighet att ta bort rader
      var ml = document.getElementById("manualList");
      ml.innerHTML = _manual.map(function(m,i){
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--paper-2);border:1px solid var(--line);border-radius:9px;padding:8px 12px">'+
          '<span style="font-size:14px">'+esc(m.namn)+'</span>'+
          '<button class="pick" type="button" data-rm="'+i+'" style="padding:5px 10px;font-size:12px">Ta bort</button></div>';
      }).join("");
      ml.querySelectorAll("[data-rm]").forEach(function(b){
        b.addEventListener("click", function(){ _manual.splice(+b.dataset.rm,1); renderManual(); });
      });
    }

    document.getElementById("manualBtn").addEventListener("click", function(){
      var card = document.getElementById("manualCard");
      card.style.display = "block";
      if (!_pricesLoaded){ _pricesLoaded = true; loadPrices(fillCatSelect); }
      card.scrollIntoView({ behavior:"smooth", block:"start" });
    });
    document.getElementById("manualAdd").addEventListener("click", function(){
      var id = document.getElementById("manualCat").value;
      var p = priceById(id); if (!p) return;
      _manual.push({ id:p.id, namn:p.namn, lag:p.lag, hog:p.hog });
      renderManual();
    });

    // === Retur till guiden/objektanalysen (kom man hit därifrån?) ===========
    // Guiden/Objektanalysen sätter kjkh:renovReturn innan de skickar hit. Då
    // visar vi en tydlig "Använd & tillbaka"-knapp som tar med renoveringssumman
    // (den bryggas redan via kjkh:renovtotal när en analys renderas/öppnas).
    if (OPTS.returnFlow !== false) (function(){
      var ret;
      try { ret = JSON.parse(localStorage.getItem("kjkh:renovReturn") || "null"); } catch(e){ ret = null; }
      // Giltig i 6 timmar, annars strunta i den.
      if (ret && ret.url && (Date.now() - (ret.ts||0) < 6*3600*1000)) {
        var back = document.getElementById("backLink");
        document.getElementById("returnHint").style.display = "block";
        document.getElementById("returnHintFrom").textContent = ret.label || "analysen";
        document.getElementById("returnHintHistory").style.display = "block";
        document.getElementById("returnBox").style.display = "block";
        function goBack(){
          try { localStorage.removeItem("kjkh:renovReturn"); } catch(e){}
          location.href = ret.url;
        }
        host.querySelectorAll(".returnGo").forEach(function(b){
          b.textContent = "Använd & tillbaka till " + (ret.label || "analysen") + " →";
          b.addEventListener("click", goBack);
        });
        // "Till startsidan" avbryter returläget.
        if (back) back.addEventListener("click", function(){ try { localStorage.removeItem("kjkh:renovReturn"); } catch(e){} });
      }
    })();

    // Förifyll annonslänken om användaren redan klistrat in en i guiden.
    (function(){
      var field = document.getElementById("booliDocUrl");
      if (field.value.trim()) return;
      // Värdsidan kan peka ut en länk användaren redan klistrat in (kalkylatorn).
      var fran = OPTS.hamtaLank ? (OPTS.hamtaLank() || "") : "";
      if (fran.trim()){ field.value = fran.trim(); return; }
      try {
        var w = JSON.parse(localStorage.getItem("kjkh:wizard") || "{}");
        if (w.o_url) field.value = w.o_url;
      } catch(e){}
    })();

    // Visa tidigare sparade analyser direkt vid sidladdning.
    renderHistory();
    if (PAY_ENABLED){ document.getElementById("priceNote").style.display = "inline"; }
    return { host: host };
  }

  return { mount: mount };
})();
