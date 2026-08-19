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
  };

  // Månadskostnad för räntan efter ränteavdrag.
  function ranteManad(lan, rantaDec) {
    var arsranta = lan * rantaDec;
    var avdrag = Math.min(arsranta, C.AVDRAG_TAK) * C.RANTEAVDRAG +
                 Math.max(0, arsranta - C.AVDRAG_TAK) * C.RANTEAVDRAG2;
    return (arsranta - avdrag) / 12;
  }

  // Reglagets spann utifrån utgångspris + ev. Boolis värdering.
  function priser(utg, vard) {
    var hog = Math.max(utg, vard, 1);
    var min = Math.round(utg * 0.8 / 25000) * 25000;
    var max = Math.round(hog * 1.6 / 25000) * 25000;
    if (min < 0) min = 0;
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
    // Amorteringskrav: >70 % => 2 %, 50–70 % => 1 %, <=50 % => 0 %; + skuldkvot >4,5 => +1 %.
    var amortBas = belaning > 0.70 ? C.AMORT_HOG : (belaning > 0.50 ? C.AMORT_MELLAN : 0);
    var amort = amortBas + (skuldkvot > C.SKULD_GRANS ? C.AMORT_SKULD : 0);
    var amortMan = lan * amort / 12;
    var boendeMan    = ranteManad(lan, ranta)  + amortMan + dMan;
    var boendeStress = ranteManad(lan, stress) + amortMan + dMan;
    var kvarAttLeva = netto - boendeStress;

    var hardFail = kontanterTillg < kontantbehov;
    var ratio = netto > 0 ? boendeStress / netto : 1;
    var band;
    if (hardFail || ratio > C.BAND_TIGHT) band = "nej";
    else if (ratio > C.BAND_JA) band = "tight";
    else band = "ja";

    return {
      B: B, kontantAndel: kontantAndel, belaning: belaning,
      kiKrav: kiKrav, lagfart: lagfart, pantbrevKost: pantbrevKost, nyaPantbrev: nyaPantbrev,
      kontantbehov: kontantbehov, kontanterTillg: kontanterTillg, buffer: kontanterTillg - kontantbehov,
      lan: lan, skuldkvot: skuldkvot, amort: amort, amortMan: amortMan,
      boendeMan: boendeMan, boendeStress: boendeStress, kvarAttLeva: kvarAttLeva,
      band: band, hardFail: hardFail, ranta: ranta, stress: stress,
    };
  }

  global.KJKH_AFF = { C: C, ranteManad: ranteManad, priser: priser, bedom: bedom };
})(typeof window !== "undefined" ? window : this);
