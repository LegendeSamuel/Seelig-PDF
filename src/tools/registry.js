import { mountOrganizeTool } from './organize-tools.js';
import { mountEditTool } from './edit-tools.js';
import { mountConvertTool } from './convert-tools.js';
import { mountSecurityTool } from './security-tools.js';

export const CATEGORIES = [
  { id: 'all', label: 'Alle Werkzeuge' },
  { id: 'organize', label: 'Organisieren' },
  { id: 'edit', label: 'Bearbeiten' },
  { id: 'convert', label: 'Konvertieren' },
  { id: 'security', label: 'Sicherheit & Optimieren' }
];

const CATEGORY_LABELS = {
  organize: 'Organisieren',
  edit: 'Bearbeiten',
  convert: 'Konvertieren',
  security: 'Sicherheit & Optimieren'
};

const RAW_TOOLS = [
  // Organisieren (9)
  { id: 'merge', category: 'organize', icon: 'merge', name: 'PDF zusammenfügen', description: 'Mehrere PDF-Dateien in frei wählbarer Reihenfolge zu einem Dokument verbinden.', mount: mountOrganizeTool },
  { id: 'split', category: 'organize', icon: 'split', name: 'PDF trennen', description: 'PDF in Einzelseiten, feste Pakete oder benutzerdefinierte Bereiche aufteilen.', mount: mountOrganizeTool },
  { id: 'organize', category: 'organize', icon: 'sort', name: 'Seiten sortieren & kombinieren', description: 'Seiten mehrerer PDFs per Vorschau umsortieren, drehen, duplizieren oder löschen.', mount: mountOrganizeTool },
  { id: 'delete-pages', category: 'organize', icon: 'trash', name: 'Seiten löschen', description: 'Einzelne Seiten oder Bereiche markieren und dauerhaft aus dem PDF entfernen.', mount: mountOrganizeTool },
  { id: 'extract-pages', category: 'organize', icon: 'export', name: 'Seiten extrahieren', description: 'Gewählte Seiten als neues Sammel-PDF oder einzeln als ZIP speichern.', mount: mountOrganizeTool },
  { id: 'rotate', category: 'organize', icon: 'rotate', name: 'Seiten drehen', description: 'Alle, gerade, ungerade oder markierte Seiten um 90°, 180° oder 270° drehen.', mount: mountOrganizeTool },
  { id: 'nup', category: 'organize', icon: 'grid', name: 'Seiten pro Blatt', description: '2, 4, 6 oder 9 PDF-Seiten übersichtlich auf einem A4-Druckbogen anordnen.', mount: mountOrganizeTool },
  { id: 'booklet', category: 'organize', icon: 'book', name: 'Broschüre erstellen', description: 'Seiten automatisch für beidseitige Sattelheftung zum Falten ausschießen.', mount: mountOrganizeTool },
  { id: 'split-half', category: 'organize', icon: 'scissors', name: 'Seiten halbieren / Poster', description: 'Doppelseiten mittig teilen oder Großformate in druckbare 2×2-Kacheln zerlegen.', mount: mountOrganizeTool },

  // Bearbeiten (10)
  { id: 'watermark', category: 'edit', icon: 'stamp', name: 'Wasserzeichen einfügen', description: 'Text oder Logo mit frei wählbarer Deckkraft, Drehung und Kachelung einbetten.', mount: mountEditTool },
  { id: 'page-numbers', category: 'edit', icon: 'hash', name: 'Seitenzahlen einfügen', description: 'Seiten flexibel oben oder unten mit eigenem Format nummerieren.', mount: mountEditTool },
  { id: 'overlay', category: 'edit', icon: 'layers', name: 'PDFs übereinanderlegen', description: 'Briefpapier im Hintergrund oder Stempel im Vordergrund mit einem PDF verbinden.', mount: mountEditTool },
  { id: 'crop', category: 'edit', icon: 'crop', name: 'PDF beschneiden', description: 'Ränder interaktiv in der Vorschau oder millimetergenau abschneiden.', mount: mountEditTool },
  { id: 'resize', category: 'edit', icon: 'resize', name: 'Seitengröße ändern', description: 'Seiten proportional auf DIN A4, A3, A5, Letter oder Wunschmaß skalieren.', mount: mountEditTool },
  { id: 'sign', category: 'edit', icon: 'pen', name: 'PDF unterschreiben', description: 'Unterschrift per Maus/Touch zeichnen oder als Bild direkt auf der Seite platzieren.', mount: mountEditTool },
  { id: 'annotate', category: 'edit', icon: 'edit', name: 'PDF bearbeiten & kommentieren', description: 'Texte, farbige Hervorhebungen und Rahmen direkt auf PDF-Seiten setzen.', mount: mountEditTool },
  { id: 'fill-form', category: 'edit', icon: 'form', name: 'Formular ausfüllen', description: 'Interaktive AcroForm-Felder auslesen, bearbeiten und optional fest einbrennen.', mount: mountEditTool },
  { id: 'bookmarks', category: 'edit', icon: 'bookmark', name: 'Lesezeichen verwalten', description: 'Kapitel und Sprungmarken im PDF-Inhaltsverzeichnis anlegen.', mount: mountEditTool },
  { id: 'metadata-edit', category: 'edit', icon: 'info', name: 'PDF-Infos & Metadaten', description: 'Struktur & Sicherheit prüfen sowie Titel, Autor und Stichwörter bearbeiten.', mount: mountEditTool },

  // Konvertieren (7)
  { id: 'images-to-pdf', category: 'convert', icon: 'image', name: 'Bilder in PDF', description: 'PNG, JPG, WebP, GIF und BMP EXIF-bereinigt zu einer PDF zusammenstellen.', mount: mountConvertTool },
  { id: 'pdf-to-images', category: 'convert', icon: 'image', name: 'PDF in Bilder', description: 'Seiten mit wählbarer DPI-Auflösung lokal als PNG oder JPG exportieren.', mount: mountConvertTool },
  { id: 'extract-images', category: 'convert', icon: 'export', name: 'Bilder extrahieren', description: 'Eingebettete Originalbilder aus PDF-Dokumenten als ZIP herunterladen.', mount: mountConvertTool },
  { id: 'extract-text', category: 'convert', icon: 'text', name: 'Text & Markdown extrahieren', description: 'Textinhalte sicher ohne Skript-Ausführung als .txt oder .md exportieren.', mount: mountConvertTool },
  { id: 'text-to-pdf', category: 'convert', icon: 'text', name: 'Text & Markdown zu PDF', description: 'Klartext oder Markdown-Notizen sauber formatiert als A4-PDF erzeugen.', mount: mountConvertTool },
  { id: 'image-convert', category: 'convert', icon: 'image', name: 'Bilder konvertieren & komprimieren', description: 'Bilder zwischen PNG, JPG und WebP wandeln und Metadaten automatisch strippen.', mount: mountConvertTool },
  { id: 'qr-code', category: 'convert', icon: 'qr', name: 'QR-Code generieren', description: 'Vektor-QR-Codes als SVG, PNG, A4-PDF oder direkt auf bestehende PDFs setzen.', mount: mountConvertTool },

  // Sicherheit & Optimieren (7)
  { id: 'compress', category: 'security', icon: 'compress', name: 'PDF komprimieren', description: 'Dateigröße verlustfrei oder per kontrollierter DPI-Rasterung deutlich reduzieren.', mount: mountSecurityTool },
  { id: 'protect', category: 'security', icon: 'lock', name: 'PDF verschlüsseln', description: 'Mit AES-256-Passwort schützen und Druck-/Kopierrechte festlegen.', mount: mountSecurityTool },
  { id: 'unlock', category: 'security', icon: 'unlock', name: 'Passwortschutz entfernen', description: 'Bekannten Passwortschutz autorisiert aus einer PDF-Datei entfernen.', mount: mountSecurityTool },
  { id: 'redact', category: 'security', icon: 'redact', name: 'PDF sicher schwärzen', description: 'Echte Pixel-Schwärzung: markierte Bereiche werden irreversibel entfernt.', mount: mountSecurityTool },
  { id: 'strip-metadata', category: 'security', icon: 'shield', name: 'Metadaten komplett entfernen', description: 'Autoren, Programme und versteckte XMP-Daten spurlos löschen.', mount: mountSecurityTool },
  { id: 'flatten', category: 'security', icon: 'sparkle', name: 'PDF glätten, rastern & färben', description: 'Formulare fixieren, komplett rastern, in Graustufen wandeln oder invertieren.', mount: mountSecurityTool },
  { id: 'compare', category: 'security', icon: 'diff', name: 'PDFs vergleichen', description: 'Zwei Versionen visuell Pixel für Pixel sowie textlich auf Abweichungen prüfen.', mount: mountSecurityTool }
];

export const TOOLS = RAW_TOOLS.map((t) => ({
  ...t,
  categoryLabel: CATEGORY_LABELS[t.category]
}));

export function getToolById(id) {
  return TOOLS.find((t) => t.id === id) || null;
}
