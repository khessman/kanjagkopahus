// Delad affordability-motor för Objektanalys (objektanalys.html) och
// Lätt läge (start.html). Ren logik, inget DOM - ÄNDRA REGLERNA HÄR, inte i
// sidorna, så de aldrig kan driva isär.
//
// Svenska regler som modelleras:
//  - Bolånetak: max 85 % belåning => minst 15 % kontantinsats.
//  - Amorteringskrav: >70 % belåning => 2 %/år; + skuldkvot >4,5x => +1 %/år.
//  - Köpkostnader vid tillträde: lagfart 1,5 % + 825 kr, pantbrev 2 % på NYA
//    pantbrev (lån − befintliga pantbrev) + 375 kr.
//  - Ränteavdrag: 30 % upp till 100 000 kr ränta/år, 21 % däröver.
//  - Renovering äter av kontanterna (inte lånet).
(function (global) {
  "use strict";

  var C = {
    DEF_KONTANT: 0.15,      // förvald kontantinsats (andel av priset)
    KONTANT_MIN: 0.10,      // lägsta tillåtna kontantinsats (bolånetak from 2026: 90 %)
    AMORT_HOG: 0.02,        // belåningsgrad > 70 % => 2 %/år
    AMORT_MELLAN: 0.01,     // belåningsgrad 50–70 % => 1 %/år
    AMORT_SKULD: 0.01,      // + lån > 4,5x bruttoårsinkomst => +1 %/år
    SKULD_GRANS: 4.5,
    RANTEAVDRAG: 0.30,      // upp till AVDRAG_TAK ränta/år
    RANTEAVDRAG2: 0.21,     // däröver
    AVDRAG_TAK: 100000,
    BAND_JA: 0.40,          // boendekostnad (stress) / nettoinkomst
    BAND_TIGHT: 0.55,
    DEF_RANTA: 4.5,
    DEF_STRESS: 7.0,
    LAGFART_PCT: 0.015,     // stämpelskatt lagfart + fast avgift
    LAGFART_FAST: 825,
    PANTBREV_PCT: 0.02,     // stämpelskatt nya pantbrev + fast avgift
    PANTBREV_FAST: 375,
    BUFFER_KNAPP: 0.15,     // kontantbuffert efter renov. < 15 % av kontantbehov => "tight"

    // Prisantaganden för driftkostnad, samma defaults som kalkylator.html (2026, elområde SE3).
    EL_PRIS: 1.60, SCOP_LV: 3.2, SCOP_BV: 3.5, SCOP_LL: 3.0,
    PELLETS_PRIS: 5000, PELLETS_E: 4800, PELLETS_V: 85,
    VED_PRIS: 2000, VED_E: 1900, VED_V: 80,
    FJARR_PRIS: 1.00,
    VA_PRIS: 45, VA_LPD: 140,
    TRASH_GRUND: 2400,
    KARL: { 140: 1200, 190: 1700, 240: 2300, 370: 3600 },
    MATAVF: { sorterar: 0, hemkompost: 0, osorterat: 1500 },
    FAST_PCT: 0.0075, FAST_TAK: 10425,
    RESE_SCHABLON: 25, RESE_TROSK: 11000, RESE_SKATT: 30,

    // Grov snittskatt för att uppskatta nettoinkomst från bruttoinkomst.
    // Ingen hänsyn till jobbskatteavdrag/grundavdrag - bara kommunalskatt + statlig skatt över brytpunkten.
    KOMMUNALSKATT: 0.32,
    STATLIG_SKATT: 0.20,
    STATLIG_GRANS_AR: 600000,
  };

  // Grov nettouppskattning: bruttoManad = hushållets totala bruttoinkomst/mån, personer = antal inkomsttagare
  // (delas jämnt mellan dem, eftersom statlig skatt är progressiv per person, inte per hushåll).
  function nettoSchablon(bruttoManad, personer) {
    personer = personer || 1;
    var perPersonAr = (bruttoManad / personer) * 12;
    var skatt = perPersonAr * C.KOMMUNALSKATT + Math.max(0, perPersonAr - C.STATLIG_GRANS_AR) * C.STATLIG_SKATT;
    var nettoPersonMan = (perPersonAr - skatt) / 12;
    return nettoPersonMan * personer;
  }

  // Ränteavdrag: 30 % upp till tröskeln (100 000 kr/person), 21 % däröver.
  function rantavdrag(arsranta, nLantagare) {
    var trosk = C.AVDRAG_TAK * (nLantagare || 2);
    var low = Math.min(arsranta, trosk), high = Math.max(0, arsranta - trosk);
    return low * C.RANTEAVDRAG + high * C.RANTEAVDRAG2;
  }

  // Månadskostnad för räntan efter ränteavdrag.
  function ranteManad(lan, rantaDec, nLantagare) {
    var arsranta = lan * rantaDec;
    var avdrag = rantavdrag(arsranta, nLantagare);
    return (arsranta - avdrag) / 12;
  }

  // Amorteringskrav utifrån belåningsgrad (>70 % => 2 %, 50-70 % => 1 %, annars 0).
  function amortRate(ltv) {
    if (ltv > 0.70) return C.AMORT_HOG;
    if (ltv > 0.50) return C.AMORT_MELLAN;
    return 0;
  }

  // Uppvärmningskostnad kr/år för att täcka 'kwh' kWh värmebehov med given form.
  function heatingYrFor(form, kwh) {
    if (kwh <= 0) return 0;
    var el = C.EL_PRIS;
    switch (form) {
      case "luftvatten": return kwh / C.SCOP_LV * el;
      case "bergvarme":  return kwh / C.SCOP_BV * el;
      case "luftluft":   return kwh / C.SCOP_LL * el;
      case "elpanna":    return kwh * el;
      case "pellets":    return (kwh / (C.PELLETS_V / 100)) / C.PELLETS_E * C.PELLETS_PRIS;
      case "ved":        return (kwh / (C.VED_V / 100)) / C.VED_E * C.VED_PRIS;
      case "fjarrvarme": return kwh * C.FJARR_PRIS;
      default: return 0;
    }
  }

  // Vatten & avlopp: { persons, lpd, fast, price, garden, tubL, tubN, extra } => { m3, kr } (per år).
  function waterYr(p) {
    p = p || {};
    var hush = (p.persons || 0) * (p.lpd || C.VA_LPD) * 365 / 1000;
    var tub = (p.tubL || 0) * (p.tubN || 0) / 1000;
    var m3 = hush + (p.garden || 0) + tub + (p.extra || 0);
    return { m3: m3, kr: (p.fast || 0) + m3 * (p.price != null ? p.price : C.VA_PRIS) };
  }

  // Sophämtning kr/år: { grund, karl, freq, mat, just }.
  function trashYr(p) {
    p = p || {};
    var karl = C.KARL[p.karl] || 0;
    var freq = p.freq != null ? p.freq : 1;
    var mat = C.MATAVF[p.mat] || 0;
    return (p.grund != null ? p.grund : C.TRASH_GRUND) + karl * freq + mat + (p.just || 0);
  }

  function fastighetsavgift(taxvarde) {
    return Math.min((taxvarde || 0) * C.FAST_PCT, C.FAST_TAK);
  }

  // Pendlingskostnad: { kmEnkel, minEnkel, days, cons, price, schablon, trosk, skatt }.
  function commute(p) {
    p = p || {};
    var days = p.days != null ? p.days : 21;
    var kmMan = (p.kmEnkel || 0) * 2 * days;
    var fuelMan = kmMan * ((p.cons || 0) / 100) * (p.price || 0);
    var hMan = (p.minEnkel || 0) * 2 * days / 60;
    var milYr = kmMan * 12 / 10;
    var schablonYr = milYr * (p.schablon != null ? p.schablon : C.RESE_SCHABLON);
    var trosk = p.trosk != null ? p.trosk : C.RESE_TROSK;
    var skatt = p.skatt != null ? p.skatt : C.RESE_SKATT;
    var avdrag = Math.max(0, schablonYr - trosk);
    var taxBenMan = avdrag * (skatt / 100) / 12;
    // Reseavdraget är en årlig skatteåterbäring, inte en sänkt månadsutgift - räkna inte in den i kostnaden,
    // bara den faktiska drivmedelskostnaden. taxBenMan returneras som ren info.
    return { kmMan: kmMan, fuelMan: fuelMan, hMan: hMan, taxBenMan: taxBenMan, netMan: fuelMan };
  }

  // Reglagets spann utifrån utgångspris + ev. Boolis värdering. mult = övre gräns som multipel av högsta pris (default 1,6).
  function priser(utg, vard, mult) {
    var hog = Math.max(utg, vard, 1);
    var min = 0;
    var max = Math.round(hog * (mult || 1.6) / 25000) * 25000;
    if (max <= min) max = min + 1000000;
    return { utg: utg, vard: vard, min: min, max: max };
  }

  // Kärnan. input = {
  //   B, brutto, netto, spar,      // kr (ränta/stress som decimal, 0.045)
  //   ranta, stress,
  //   renov, pantBefintlig, driftMan,  // kr; driftMan = driftkostnad per mån
  //   kontantAndel                 // andel kontantinsats (0.15). Utelämnad => DEF_KONTANT
  // }
  function bedom(i) {
    var B = i.B, netto = i.netto, spar = i.spar;
    var ranta = i.ranta, stress = i.stress;
    var renov = i.renov || 0, pantBefintlig = i.pantBefintlig || 0, dMan = i.driftMan || 0;

    var kontantAndel = (i.kontantAndel && i.kontantAndel > 0) ? i.kontantAndel : C.DEF_KONTANT;
    if (kontantAndel < C.KONTANT_MIN) kontantAndel = C.KONTANT_MIN;   // bolånetaket
    if (kontantAndel > 1) kontantAndel = 1;

    var kiKrav = kontantAndel * B;
    var lan = (1 - kontantAndel) * B;
    var belaning = 1 - kontantAndel;                    // = lån / pris
    var lagfart = C.LAGFART_PCT * B + C.LAGFART_FAST;
    var nyaPantbrev = Math.max(0, lan - pantBefintlig);
    var pantbrevKost = nyaPantbrev > 0 ? C.PANTBREV_PCT * nyaPantbrev + C.PANTBREV_FAST : 0;
    var kontantbehov = kiKrav + lagfart + pantbrevKost; // kontanter vid tillträde
    var kontanterTillg = spar - renov;                  // renovering äter av kontanterna

    var bruttoAr = i.brutto * 12;
    var skuldkvot = bruttoAr > 0 ? lan / bruttoAr : 99;
    var nLantagare = i.nLantagare || 2;
    // Amorteringskrav: >70 % => 2 %, 50–70 % => 1 %, <=50 % => 0 %; + skuldkvot >4,5 => +1 %.
    // Egen nivå (amortOverride) ersätter hela beräkningen, inkl. skuldkvot-tillägget.
    var amort;
    if (i.amortOverride != null) { amort = i.amortOverride; }
    else { amort = amortRate(belaning) + (skuldkvot > C.SKULD_GRANS ? C.AMORT_SKULD : 0); }
    var amortMan = lan * amort / 12;
    var boendeMan    = ranteManad(lan, ranta, nLantagare)  + amortMan + dMan;
    var boendeStress = ranteManad(lan, stress, nLantagare) + amortMan + dMan;
    var kvarAttLeva = netto - boendeStress;

    var hardFail = kontanterTillg < kontantbehov;
    var ratio = netto > 0 ? boendeStress / netto : 1;
    var bufferAndel = kontantbehov > 0 ? (kontanterTillg - kontantbehov) / kontantbehov : 1;
    var band;
    if (hardFail || ratio > C.BAND_TIGHT) band = "nej";
    else if (ratio > C.BAND_JA || bufferAndel < C.BUFFER_KNAPP) band = "tight";
    else band = "ja";

    return {
      B: B, kontantAndel: kontantAndel, belaning: belaning,
      kiKrav: kiKrav, lagfart: lagfart, pantbrevKost: pantbrevKost, nyaPantbrev: nyaPantbrev,
      kontantbehov: kontantbehov, kontanterTillg: kontanterTillg, buffer: kontanterTillg - kontantbehov,
      bufferAndel: bufferAndel,
      lan: lan, skuldkvot: skuldkvot, amort: amort, amortMan: amortMan, nLantagare: nLantagare,
      boendeMan: boendeMan, boendeStress: boendeStress, kvarAttLeva: kvarAttLeva,
      band: band, hardFail: hardFail, ranta: ranta, stress: stress,
    };
  }

  global.KJKH_AFF = {
    C: C, ranteManad: ranteManad, rantavdrag: rantavdrag, amortRate: amortRate,
    heatingYrFor: heatingYrFor, waterYr: waterYr, trashYr: trashYr,
    fastighetsavgift: fastighetsavgift, commute: commute, nettoSchablon: nettoSchablon,
    priser: priser, bedom: bedom,
  };
})(typeof window !== "undefined" ? window : this);
