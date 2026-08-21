// Deterministisk renoverings-livslängdsmotor för annonsguiden (experiment/annonsguide).
// Rent regelbaserad, ingen AI - ÄNDRA TABELLERNA HÄR, inte i sidorna.
//
// Modell: varje husdel har en typisk livslängd i år (branschsnitt, grovt). Bas-året för
// "senast utfört" är antingen ett svar användaren gett (senast[nyckel]) eller husets
// byggår om inget annat är känt. Kostnadsband återanvänder samma kronintervall som
// backend/src/prompt.js PRICE_TABLE, för att inte ha två olika sanningar om samma åtgärd.
(function (global) {
  "use strict";

  var C = {
    SNART_AR: 5,   // återstående livslängd <= detta => "snart" (inom några år)
    // { ar: typisk livslängd i år, lo/hi: kostnadsband kr, delas med backend PRICE_TABLE }
    LIVSLANGD: {
      kok:     { ar: 22, lo: 70000,  hi: 170000, namn: "Kök" },
      badrum:  { ar: 22, lo: 70000,  hi: 150000, namn: "Badrum" },
      tak:     { ar: 35, lo: 70000,  hi: 150000, namn: "Tak" },
      fasad:   { ar: 25, lo: 30000,  hi: 160000, namn: "Fasad" },
      fonster: { ar: 35, lo: 40000,  hi: 100000, namn: "Fönster" },
      elvvs:   { ar: 45, lo: 35000,  hi: 300000, namn: "El/VVS-stammar" },
      varme:   { ar: 18, lo: 12000,  hi: 150000, namn: "Värmesystem" },
    },
  };

  // Status för en enskild husdel. byggar = husets byggår, senastAr = ev. känt/angivet
  // renoveringsår för just denna del (annars antas byggår). nu = aktuellt år (testbart).
  function statusFor(key, byggar, senastAr, nu) {
    var def = C.LIVSLANGD[key];
    if (!def) return null;
    nu = nu || new Date().getFullYear();
    var bas = senastAr || byggar;
    var alder = bas ? Math.max(0, nu - bas) : null;
    var kvar = alder == null ? null : def.ar - alder;
    var urgency = kvar == null ? "okand" : (kvar <= 0 ? "akut" : (kvar <= C.SNART_AR ? "snart" : "sikt"));
    return { key: key, namn: def.namn, alder: alder, kvar: kvar, urgency: urgency, lo: def.lo, hi: def.hi };
  }

  // Behöver vi fråga användaren om senast renoverat för denna del? Bara om husets byggår
  // (utan extra info) redan pekar mot "snart"/"akut" - annars är den säkert långt kvar.
  function needsQuestion(key, byggar, nu) {
    if (!byggar) return true; // byggår helt okänt - kan inte avgöra, fråga
    var s = statusFor(key, byggar, null, nu);
    return s.urgency !== "sikt";
  }

  // Kärnan: input = { byggar, senast: { kok, badrum, tak, fasad, fonster, elvvs, varme } (år, valfria) }
  function bedomRenov(input, nu) {
    input = input || {};
    var senast = input.senast || {};
    var items = Object.keys(C.LIVSLANGD).map(function (key) {
      return statusFor(key, input.byggar, senast[key], nu);
    });
    var aktuella = items.filter(function (it) { return it.urgency === "akut" || it.urgency === "snart" || it.urgency === "okand"; });
    var lo = aktuella.reduce(function (s, it) { return s + it.lo; }, 0);
    var hi = aktuella.reduce(function (s, it) { return s + it.hi; }, 0);
    var mid = Math.round((lo + hi) / 2);
    return { items: items, aktuella: aktuella, lo: lo, hi: hi, mid: mid };
  }

  global.KJKH_RENOV = {
    C: C, statusFor: statusFor, needsQuestion: needsQuestion, bedomRenov: bedomRenov,
  };
})(typeof window !== "undefined" ? window : this);
