"""Excel (Tab "Kennwerte", vertikal) -> normalisierter JSON-Container.

Aufruf:  python tools/import_excel.py
Erzeugt: data/werkstoffdb.json  (kanonische Daten)
         data/werkstoffdb.js    (Spiegel fuer file:// - kein fetch noetig)
"""
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / 'basis_excel' / 'Metall-Werkstoffe .xlsx'
OUT_JSON = ROOT / 'data' / 'werkstoffdb.json'
OUT_JS = ROOT / 'data' / 'werkstoffdb.js'

# Eigenschaften mit Zahlenwert: Excel-Label -> (id, Einheit)
EIGENSCHAFTEN = {
    'Wärmeleitfähigkeit': ('waermeleitfaehigkeit', 'W/(m·K)'),
    'Spezifische Wärme': ('spezifische_waerme', 'J/(g·°C)'),
    'Wärmeausdehnungskoeffizient': ('waermeausdehnung', 'µm/(m·°C)'),
    'Elastizitätsmodul': ('e_modul', 'GPa'),
    'Poissonsche Zahl': ('poisson', ''),
    'Schubmodul': ('schubmodul', 'MPa'),
    'Dichte': ('dichte', 'g/cm³'),
    'Streckspannung': ('streckspannung', 'MPa'),
    'Zugfestigkeit': ('zugfestigkeit', 'MPa'),
}
EIGENSCHAFT_NAMEN = {k: k for k in EIGENSCHAFTEN}

# Textfelder je Werkstoff: Excel-Label (erstes Vorkommen) -> JSON-Feld
TEXTFELDER = {
    'Beschreibung': 'beschreibung',
    'Werkstoff-Nummer': 'werkstoffNummer',
    'Werkstoff-Kurzname': 'kurzname',
    'veraltete Werkstoff-Angaben': 'veraltet',
    'Bemerkung': 'bemerkung',
    'Angabe auf Zeichnung': 'zeichnungsangabe',
    'Norm': 'norm',
    'Datenblatt / Quellen': 'quellen',
    'Verhalten': 'verhalten',
}


def clean(v):
    if v is None:
        return ''
    return str(v).replace('\xa0', ' ').strip()


def parse_number(text, soll_einheit):
    """'5,690E+01 W/(m·K)' -> 56.9 ; GPa/MPa werden auf die Soll-Einheit umgerechnet."""
    if isinstance(text, (int, float)):
        return float(text)
    m = re.match(r'^\s*([-+]?\d[\d.,]*(?:[eE][-+]?\d+)?)\s*(.*)$', clean(text))
    if not m:
        return None
    wert = float(m.group(1).replace(',', '.'))
    einheit = m.group(2).strip().replace('Mpa', 'MPa').replace('Gpa', 'GPa')
    if soll_einheit == 'MPa' and einheit == 'GPa':
        wert *= 1000
    elif soll_einheit == 'GPa' and einheit == 'MPa':
        wert /= 1000
    elif einheit and soll_einheit and einheit.replace(' ', '') != soll_einheit.replace(' ', ''):
        # Einheiten mit Sonderzeichen tolerant vergleichen (Excel hat teils Leerzeichen)
        if re.sub(r'\W', '', einheit) != re.sub(r'\W', '', soll_einheit):
            print(f'  WARNUNG Einheit {einheit!r} != {soll_einheit!r} bei {text!r}', file=sys.stderr)
    return round(wert, 6)


def parse_farbe(text):
    nums = re.findall(r'\d+', clean(text))
    if len(nums) < 3:
        return ''
    r, g, b = (min(255, int(n)) for n in nums[-3:])
    return f'#{r:02x}{g:02x}{b:02x}'


def parse_int(v):
    nums = re.findall(r'\d+', clean(v))
    return int(nums[0]) if nums else None


def main():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb['Kennwerte']
    heute = date.today().isoformat()

    # Zeilenindex: Label -> Zeilen (Labels wie Name/Beschreibung kommen je Block mehrfach vor)
    zeilen = {}
    for r in range(1, ws.max_row + 1):
        label = clean(ws.cell(r, 1).value)
        if label:
            zeilen.setdefault(label, []).append(r)

    z_kat = zeilen['Kategorie'][0]
    z_name = zeilen['Name'][0]
    z_typ = zeilen['Typ'][0]
    z_kw = zeilen['Schlüsselwörter'][0]

    kategorien, typen, werkstoffe, werte, revisionen = {}, {}, [], [], []

    for c in range(2, ws.max_column + 1):
        name = clean(ws.cell(z_name, c).value)
        if not name:
            continue
        nr = len(werkstoffe) + 1
        wid = f'W-{nr:03d}'

        # Kategorie: Spalte 45 (AL EN AW 6063) hat in der Excel keinen Eintrag -> aus Name ableiten
        kat = clean(ws.cell(z_kat, c).value) or name.split(' ')[0]
        kategorien.setdefault(kat, {'id': kat, 'name': kat})

        typ = clean(ws.cell(z_typ, c).value)
        typ_id = re.sub(r'\W+', '_', typ.lower()).strip('_') or 'unbekannt'
        typen.setdefault(typ_id, {'id': typ_id, 'name': typ or 'unbekannt'})

        w = {
            'id': wid,
            'kategorieId': kat,
            'typId': typ_id,
            'name': name,
            'schluesselwoerter': [k.strip() for k in clean(ws.cell(z_kw, c).value).split(',') if k.strip()],
        }
        for label, feld in TEXTFELDER.items():
            if label in zeilen:
                # Beschreibung/Schluesselwoerter: nur Identity-Block (erstes Vorkommen)
                w[feld] = clean(ws.cell(zeilen[label][0], c).value)
        w['farbe'] = parse_farbe(ws.cell(zeilen['Farbe'][0], c).value)
        w['bildFade'] = parse_int(ws.cell(zeilen['Bild-Fade'][0], c).value)
        w['glanz'] = parse_int(ws.cell(zeilen['Glanz'][0], c).value)
        w['revision'] = 1
        w['revisionsdatum'] = heute
        werkstoffe.append(w)

        for label, (eid, einheit) in EIGENSCHAFTEN.items():
            wert = parse_number(ws.cell(zeilen[label][0], c).value, einheit)
            if wert is not None:
                werte.append({'werkstoffId': wid, 'eigenschaftId': eid, 'wert': wert})

        revisionen.append({
            'werkstoffId': wid, 'revision': 1, 'datum': heute,
            'kommentar': 'Erstimport aus Metall-Werkstoffe.xlsx (Kennwerte)', 'aenderungen': [],
        })

    db = {
        'meta': {
            'schema': 1,
            'quelle': XLSX.name,
            'erzeugt': datetime.now().isoformat(timespec='seconds'),
            'stand': datetime.now().isoformat(timespec='seconds'),
        },
        'kategorien': list(kategorien.values()),
        'typen': list(typen.values()),
        'eigenschaften': [
            {'id': eid, 'name': label, 'einheit': einheit, 'reihenfolge': i + 1}
            for i, (label, (eid, einheit)) in enumerate(EIGENSCHAFTEN.items())
        ],
        'werkstoffe': werkstoffe,
        'werte': werte,
        'revisionen': revisionen,
    }

    OUT_JSON.parent.mkdir(exist_ok=True)
    text = json.dumps(db, ensure_ascii=False, indent=1)
    OUT_JSON.write_text(text, encoding='utf-8')
    OUT_JS.write_text('window.WDB_DATA = ' + text + ';\n', encoding='utf-8')
    print(f'{len(werkstoffe)} Werkstoffe, {len(werte)} Werte, {len(kategorien)} Kategorien, {len(typen)} Typen')


if __name__ == '__main__':
    main()
