# WerkstoffDB Offline

Offline-Werkstoffdatenbank, läuft per Doppelklick auf [index.html](index.html) (kein Webserver nötig).

## Daten

- Quelle: `basis_excel/Metall-Werkstoffe .xlsx`, Tab "Kennwerte" (vertikal).
- Import: `python tools/import_excel.py` erzeugt `data/werkstoffdb.json` (kanonisch) und `data/werkstoffdb.js` (Spiegel zum Laden unter file://).
- Normalisierter Container: `kategorien`, `typen`, `eigenschaften` (Definition + Einheit), `werkstoffe`, `werte` (Werkstoff × Eigenschaft), `revisionen` (Historie mit Diff).

## Bedienung

- Tabelle mit Filtern (Suche, Kategorie, Typ, Dichte, Zugfestigkeit), Sortierung per Spaltenkopf.
- Klick auf eine Zeile öffnet das Popup. Speichern erhöht die Revision, setzt das Datum und protokolliert die Änderungen.
- Speichern: Arbeitskopie immer im Browser (localStorage). Mit "Datenordner verbinden" (Chrome/Edge) auf `data/` werden beide Dateien direkt geschrieben. Sonst: "JSON exportieren".

- Spalten der Tabelle sind über "Spalten" wählbar (alle Kennwerte aus den Stammdaten, Auswahl wird im Browser gemerkt).
- "Stammdaten": Kategorien, Typen und Kennwert-Definitionen bearbeiten.
- PDF: Button "PDF (n)" druckt die gefilterte Liste, im Popup nur den einen Werkstoff. Im Druckdialog "Als PDF speichern" wählen. Vorlage: `<template id="tpl-materialblatt">` in index.html, Layout in css/print.css. Jeder Werkstoff beginnt auf einer neuen Seite.

