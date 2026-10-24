export const en = {
  'language.title': 'Language', 'language.he': 'עברית', 'language.en': 'English',
  'language.saveError': 'Language changed for this session, but could not be saved. Try again.',
  'common.retry': 'Try again', 'common.signIn': 'Sign in', 'common.loading': 'Loading…',
  'nav.discover': 'Discover', 'nav.account': 'Account',
  'auth.welcome': 'Welcome to Visit', 'auth.intro': 'Sign in or create your account. Your next visit is a few taps away.',
  'auth.phoneAlternative': 'or use your phone', 'auth.phone': 'Phone number',
  'auth.phoneHint': 'Include your country code. We’ll send a six-digit verification code.',
  'auth.code': 'Verification code', 'auth.codeLabel': 'Six-digit verification code',
  'auth.codeSent': 'Enter the code sent to {phone}.', 'auth.verify': 'Verify & continue',
  'auth.changePhone': 'Use a different phone number', 'auth.sendCode': 'Send verification code',
  'auth.smsUnavailable': 'SMS sign-in (not configured yet)', 'auth.email': 'Continue with email',
  'auth.google': 'Continue with Google', 'auth.googleUnavailable': 'Continue with Google (not configured yet)',
  'auth.googleBuild': 'Google sign-in (development build required)',
  'auth.googleLoadFailed': 'Google sign-in could not load. Try another method.',
  'auth.failure': 'Sign-in could not be completed. Please try again.',
  'account.signOut': 'Sign out', 'account.signOutFailed': 'Could not sign out. Check your connection and retry.',
  'account.intro': 'Manage your appointments and provider access.',
  'account.guestIntro': 'Sign in to manage appointments or request provider access.',
  'account.title': 'Your Visit account', 'account.guestHelp': 'Choose a sign-in method to manage appointments or request provider access.',
  'account.loading': 'Loading your account…', 'account.failure': 'Could not load your account details.',
  'account.workspace': 'Provider workspace', 'account.approved': 'Approved provider access',
  'account.switchProvider': 'Switch to provider view', 'account.manage': 'Manage business',
  'account.owner': 'Owner', 'account.manager': 'Manager',
  'account.applicationStatus': 'Provider application status', 'account.pending': 'Approval pending',
  'account.rejected': 'Rejected', 'account.applicationApproved': 'Approved',
  'account.becomeProvider': 'Become a provider',
  'account.applyHelp': 'Submit your business for approval. Provider tools will be available after approval.',
  'account.businessName': 'Business name', 'account.slug': 'Business URL name', 'account.timezone': 'Business timezone',
  'account.timezoneHint': 'Use an IANA timezone such as Asia/Jerusalem or America/New_York.',
  'account.submit': 'Submit for approval', 'account.submitted': 'Your application was submitted and is pending review.',
  'account.submitFailed': 'The request could not be submitted. Please try again.',
  'setup.title': 'Set up your business', 'setup.publish': 'Publish business', 'setup.draft': 'Draft',
  'setup.approved': 'Approved', 'setup.published': 'Ready for bookings',
  'approval.title': 'Provider applications', 'approval.approve': 'Approve', 'approval.reject': 'Reject', 'approval.reason': 'Decision reason',
  'contact.title': 'Complete your contact details', 'contact.name': 'Full name', 'contact.verifyPhone': 'Verify phone number',
  'booking.confirm': 'Confirm appointment', 'booking.cancel': 'Cancel appointment',
  'booking.reschedule': 'Reschedule', 'booking.timezone': 'Business timezone',
  'agenda.title': 'Agenda', 'agenda.manual': 'Add appointment', 'agenda.completed': 'Completed', 'agenda.noShow': 'No-show',
} as const;
export type MessageKey = keyof typeof en;
export type Locale = 'he' | 'en';
export const he: Record<MessageKey, string> = {
  'language.title': 'שפה', 'language.he': 'עברית', 'language.en': 'English',
  'language.saveError': 'השפה הוחלפה להפעלה זו, אך לא נשמרה. אפשר לנסות שוב.',
  'common.retry': 'ניסיון נוסף', 'common.signIn': 'כניסה', 'common.loading': 'בטעינה…',
  'nav.discover': 'חיפוש תורים', 'nav.account': 'חשבון',
  'auth.welcome': 'ברוכים הבאים ל־Visit', 'auth.intro': 'היכנסו או צרו חשבון. התור הבא שלכם במרחק כמה לחיצות.',
  'auth.phoneAlternative': 'או כניסה עם מספר טלפון', 'auth.phone': 'מספר טלפון',
  'auth.phoneHint': 'יש להזין מספר עם קידומת מדינה. נשלח קוד אימות בן שש ספרות.',
  'auth.code': 'קוד אימות', 'auth.codeLabel': 'קוד אימות בן שש ספרות',
  'auth.codeSent': 'הזינו את הקוד שנשלח למספר {phone}.', 'auth.verify': 'אימות והמשך',
  'auth.changePhone': 'שימוש במספר טלפון אחר', 'auth.sendCode': 'שליחת קוד אימות',
  'auth.smsUnavailable': 'כניסה ב־SMS (עדיין לא מוגדר)', 'auth.email': 'המשך עם דואר אלקטרוני',
  'auth.google': 'המשך עם Google', 'auth.googleUnavailable': 'המשך עם Google (עדיין לא מוגדר)',
  'auth.googleBuild': 'כניסה עם Google (נדרשת גרסת פיתוח)',
  'auth.googleLoadFailed': 'לא ניתן לטעון כניסה עם Google. נסו דרך כניסה אחרת.',
  'auth.failure': 'לא ניתן להשלים את הכניסה. נסו שוב.',
  'account.signOut': 'יציאה מהחשבון', 'account.signOutFailed': 'לא ניתן לצאת מהחשבון. בדקו את החיבור ונסו שוב.',
  'account.intro': 'ניהול התורים והגישה לניהול העסק.',
  'account.guestIntro': 'היכנסו לניהול תורים או להגשת בקשה לניהול עסק.',
  'account.title': 'חשבון Visit שלכם', 'account.guestHelp': 'בחרו דרך כניסה לניהול תורים או להגשת בקשה לניהול עסק.',
  'account.loading': 'פרטי החשבון בטעינה…', 'account.failure': 'לא ניתן לטעון את פרטי החשבון.',
  'account.workspace': 'סביבת ניהול העסק', 'account.approved': 'הגישה לניהול העסק אושרה',
  'account.switchProvider': 'מעבר לתצוגת ניהול', 'account.manage': 'ניהול העסק',
  'account.owner': 'בעלים', 'account.manager': 'מנהל',
  'account.applicationStatus': 'מצב הבקשה לניהול עסק', 'account.pending': 'ממתין לאישור',
  'account.rejected': 'הבקשה נדחתה', 'account.applicationApproved': 'הבקשה אושרה',
  'account.becomeProvider': 'פתיחת עסק ב־Visit',
  'account.applyHelp': 'שלחו את פרטי העסק לבדיקה. כלי הניהול יהיו זמינים לאחר האישור.',
  'account.businessName': 'שם העסק', 'account.slug': 'שם העסק בכתובת האתר', 'account.timezone': 'אזור הזמן של העסק',
  'account.timezoneHint': 'יש להשתמש באזור זמן מסוג IANA, למשל Asia/Jerusalem או America/New_York.',
  'account.submit': 'שליחה לאישור', 'account.submitted': 'הבקשה נשלחה וממתינה לבדיקה.',
  'account.submitFailed': 'לא ניתן לשלוח את הבקשה. נסו שוב.',
  'setup.title': 'הגדרת העסק', 'setup.publish': 'פרסום העסק', 'setup.draft': 'טיוטה',
  'setup.approved': 'מאושר', 'setup.published': 'פתוח להזמנת תורים',
  'approval.title': 'בקשות לניהול עסק', 'approval.approve': 'אישור', 'approval.reject': 'דחייה', 'approval.reason': 'נימוק להחלטה',
  'contact.title': 'השלמת פרטי הקשר', 'contact.name': 'שם מלא', 'contact.verifyPhone': 'אימות מספר טלפון',
  'booking.confirm': 'אישור התור', 'booking.cancel': 'ביטול התור',
  'booking.reschedule': 'שינוי מועד', 'booking.timezone': 'אזור הזמן של העסק',
  'agenda.title': 'יומן תורים', 'agenda.manual': 'הוספת תור', 'agenda.completed': 'הושלם', 'agenda.noShow': 'לא הגיע',
};
export const defaultLocale: Locale = 'he';
export const isLocale = (value: unknown): value is Locale => value === 'he' || value === 'en';
export const directionFor = (locale: Locale) => locale === 'he' ? 'rtl' as const : 'ltr' as const;
export function translate(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  return ((locale === 'he' ? he[key] : en[key]) ?? en[key] ?? key).replace(/\{(\w+)\}/g, (token, name: string) => name in values ? String(values[name]) : token);
}
export function isolateLtr(value: string) { return `\u2066${value}\u2069`; }
export function formatAppointment(locale: Locale, instant: string, timezone: string) {
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(instant));
}
export function formatPrice(locale: Locale, minor: number, currency: string) {
  return new Intl.NumberFormat(locale === 'he' ? 'he-IL' : 'en-GB', { style: 'currency', currency }).format(minor / 100);
}
