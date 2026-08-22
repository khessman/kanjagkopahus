/* Annonser och affiliatelänkar - all konfiguration på ett ställe.
   ==========================================================================
   Inget visas förrän du fyllt i ett id eller en länk nedan. Tomma värden
   betyder "dold", så sidorna ser rena ut tills du har något att visa.

   1) ADSENSE.slots
      Skapa en annonsenhet per placering i AdSense (Annonser -> Efter
      annonsenhet -> Displayannonser, responsiv). Kopiera data-ad-slot,
      det tiosiffriga talet, och klistra in mot rätt nyckel här.
      Nyckeln är det som står i data-annonsplats på sidan.

   2) AFFILIATE
      Klistra in din spårningslänk per kategori. Sidorna länkar till rätt
      kategori via id (ctx_link) eller data-affiliate.

   Allt märks som annons i gränssnittet - det är ett krav, inte en detalj. */

window.KJKH_ANNONS = {
  adsenseClient: "ca-pub-5066963191735028",

  slots: {
    guide_topp:   "",   // efter ingressen på en guidesida
    guide_botten: "",   // före lästips och friskrivning
    kalk_fot:     "",   // kalkylatorn, längst ner
    kalk_ranta:   "",   // kalkylatorn, kort 2
    kalk_varme:   "",   // kalkylatorn, kort 3
    kalk_pendling:""    // kalkylatorn, kort 7
  },

  affiliate: {
    besiktning:   "",   // besiktningsföretag
    flytt:        "",   // flyttfirma och flyttstäd
    el:           "",   // elavtalsjämförelse
    bolan:        "",   // bolåne- och räntejämförelse
    forsakring:   "",   // hemförsäkring
    varmepump:    "",   // värmepumpsinstallation
    solceller:    "",   // solcellsinstallation
    pellets:      "",
    ved:          ""
  }
};

(function(){
  "use strict";
  var K = window.KJKH_ANNONS;

  // --- AdSense: fyll varje .adzone som har en ifylld slot -----------------
  function adsIn(root){
    (root || document).querySelectorAll(".adzone[data-annonsplats]").forEach(function(zone){
      if (zone.dataset.klar) return;
      var slot = K.slots[zone.dataset.annonsplats];
      if (!slot) return;
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", K.adsenseClient);
      ins.setAttribute("data-ad-slot", slot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      zone.appendChild(ins);
      zone.style.display = "block";
      zone.dataset.klar = "1";
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch(e){}
    });
  }

  // --- Affiliate: koppla länkar som pekar ut en kategori -------------------
  function affiliateIn(root){
    (root || document).querySelectorAll("[data-affiliate]").forEach(function(a){
      var url = K.affiliate[a.dataset.affiliate];
      if (!url) return;
      a.href = url;
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "sponsored noopener");
      var box = a.closest(".ctxad");
      if (box) box.style.display = "flex";
      a.style.display = "";
    });
  }

  function kor(){ adsIn(document); affiliateIn(document); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", kor);
  else kor();

  // Sidor som bygger innehåll i efterhand kan kalla på den igen.
  K.uppdatera = kor;
})();
