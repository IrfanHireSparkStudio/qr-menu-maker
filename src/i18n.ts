/**
 * Public-menu language strings (English / Urdu).
 * Only the menu page chrome is translated; restaurant content comes from
 * the database (name_ur / description_ur when the owner filled them in,
 * otherwise the English text is shown).
 */

export type Lang = 'en' | 'ur';

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    menu: 'Menu',
    categories: 'Categories',
    pricesIn: 'Prices in PKR',
    viewOnMap: 'View on Google Maps',
    whatsapp: 'WhatsApp',
    orderNote: 'Show this menu at the counter or call the restaurant to order.',
    poweredBy: 'Powered by QR Menu Maker',
    available: 'Available',
    unavailable: 'Not available today',
    noItems: 'No items yet.',
    noMenu: 'This menu is empty for now. Please check back soon.',
    switchToUrdu: 'اردو',
    switchToEnglish: 'English',
  },
  ur: {
    menu: 'مینیو',
    categories: 'اقسام',
    pricesIn: 'قیمتیں (روپے)',
    viewOnMap: 'گوگل میپس پر دیکھیں',
    whatsapp: 'واٹس ایپ',
    orderNote: 'آرڈر کے لیے یہ مینیو کاؤنٹر پر دکھائیں یا ریسٹورنٹ کو کال کریں۔',
    poweredBy: 'QR Menu Maker کی مدد سے بنایا گیا',
    available: 'دستیاب',
    unavailable: 'آج دستیاب نہیں',
    noItems: 'ابھی کوئی چیز نہیں ہے۔',
    noMenu: 'یہ مینیو ابھی خالی ہے۔ براہ کرم بعد میں دوبارہ دیکھیں۔',
    switchToUrdu: 'اردو',
    switchToEnglish: 'English',
  },
};

export function t(lang: Lang, key: string): string {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}

/** ?lang=ur selects Urdu, anything else is English. */
export function langFromRequest(url: string): Lang {
  return new URL(url).searchParams.get('lang') === 'ur' ? 'ur' : 'en';
}
