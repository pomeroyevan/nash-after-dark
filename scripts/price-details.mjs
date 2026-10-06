import { load } from 'cheerio';

/** Cobra's public event description contains the admission copy, not its empty cost field.
 * Keep advance/door/VIP/promotional wording intact. In particular, @ Door is part
 * of a price and must not terminate it. An empty/zero plugin field is not free.
 */
export function extractCobraPrice(description, cost) {
  const $ = load(String(description ?? ''));
  $('script,style').remove();
  const body = $.text().replace(/\s+/g, ' ').trim();
  const match = /\bTickets?\s*(?:Special)?\s*:\s*(.+?)(?=\s+(?:18|21)\s+and\s+UP\b|\s+ALL\s+AGES\b|\s+Add to calendar\b|$)/i.exec(body);
  if (match) {
    const value = match[1].replace(/\s*@\s*$/, '').trim();
    if (/\$\s*\d/.test(value) && value.length <= 280) {
      return /\bTicket\s+Special\b/i.test(match[0]) ? `Ticket special: ${value}` : value;
    }
  }
  // Cobra uses this standalone token before the date placeholder. Never infer
  // free admission from free drinks, artist biographies, or empty numeric fields.
  if (/^(?:FREE|NO COVER)\s*(?:@|$)/i.test(body)) return 'Free admission';
  const fallback = String(cost ?? '').trim();
  if (/^(?:free|no cover)$/i.test(fallback)) return 'Free admission';
  return /\$\s*\d/.test(fallback) && fallback.length <= 280 ? fallback : undefined;
}
