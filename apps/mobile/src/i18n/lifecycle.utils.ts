export const lifecycleEn = {
  'lifecycle.source.MANUAL': 'Manual entry', 'lifecycle.reason.MANUAL_ENTRY': 'Provider entered the customer details', 'lifecycle.reason.MANUAL_CONTACT_EXCEPTION': 'Audited exception for unverified customer contact',
  'lifecycle.history': 'Appointment history', 'lifecycle.show': 'Show audit history', 'lifecycle.hide': 'Hide audit history', 'lifecycle.empty': 'No appointment history yet.', 'lifecycle.failure': 'The appointment could not be updated. Refresh and try again.', 'lifecycle.loadFailed': 'Audit history could not load.',
  'lifecycle.CONFIRMED': 'Scheduled', 'lifecycle.COMPLETED': 'Completed', 'lifecycle.NO_SHOW': 'No-show', 'lifecycle.CANCELLED': 'Cancelled',
  'lifecycle.complete': 'Mark completed', 'lifecycle.noShow': 'Mark no-show', 'lifecycle.cancel': 'Cancel appointment',
  'lifecycle.event.BASELINE': 'Historical baseline', 'lifecycle.event.CREATED': 'Appointment booked', 'lifecycle.event.RESCHEDULED': 'Rescheduled', 'lifecycle.event.CANCELLED': 'Cancelled', 'lifecycle.event.COMPLETED': 'Completed', 'lifecycle.event.NO_SHOW': 'No-show',
  'lifecycle.source.CUSTOMER': 'Customer', 'lifecycle.source.PROVIDER': 'Business manager', 'lifecycle.source.SYSTEM': 'System',
  'lifecycle.reason.LEGACY_BASELINE': 'Earlier changes and actors were not recorded.', 'lifecycle.reason.FINAL_CONSENT': 'Final booking consent', 'lifecycle.reason.CUSTOMER_REQUEST': 'Customer request', 'lifecycle.reason.PROVIDER_REQUEST': 'Business request', 'lifecycle.reason.APPOINTMENT_FINISHED': 'Appointment finished', 'lifecycle.reason.CUSTOMER_ABSENT': 'Customer absent', 'lifecycle.reason.SYSTEM_CHANGE': 'System change',
};
export const lifecycleHe: Record<keyof typeof lifecycleEn, string> = {
  'lifecycle.source.MANUAL': 'הזנה ידנית', 'lifecycle.reason.MANUAL_ENTRY': 'פרטי הלקוח הוזנו על ידי העסק', 'lifecycle.reason.MANUAL_CONTACT_EXCEPTION': 'חריגה מתועדת עבור פרטי קשר שלא אומתו',
  'lifecycle.history': 'היסטוריית תורים', 'lifecycle.show': 'הצגת היסטוריית שינויים', 'lifecycle.hide': 'הסתרת היסטוריית שינויים', 'lifecycle.empty': 'אין עדיין היסטוריית תורים.', 'lifecycle.failure': 'לא הצלחנו לעדכן את התור. רעננו ונסו שוב.', 'lifecycle.loadFailed': 'לא הצלחנו לטעון את היסטוריית השינויים.',
  'lifecycle.CONFIRMED': 'מתוכנן', 'lifecycle.COMPLETED': 'הושלם', 'lifecycle.NO_SHOW': 'לא הגיע', 'lifecycle.CANCELLED': 'בוטל',
  'lifecycle.complete': 'סימון כהושלם', 'lifecycle.noShow': 'סימון כאי־הגעה', 'lifecycle.cancel': 'ביטול התור',
  'lifecycle.event.BASELINE': 'רישום היסטורי התחלתי', 'lifecycle.event.CREATED': 'התור נקבע', 'lifecycle.event.RESCHEDULED': 'מועד התור שונה', 'lifecycle.event.CANCELLED': 'התור בוטל', 'lifecycle.event.COMPLETED': 'התור הושלם', 'lifecycle.event.NO_SHOW': 'אי־הגעה',
  'lifecycle.source.CUSTOMER': 'לקוח', 'lifecycle.source.PROVIDER': 'מנהל העסק', 'lifecycle.source.SYSTEM': 'מערכת',
  'lifecycle.reason.LEGACY_BASELINE': 'שינויים קודמים וזהות מבצעיהם לא תועדו.', 'lifecycle.reason.FINAL_CONSENT': 'אישור סופי להזמנה', 'lifecycle.reason.CUSTOMER_REQUEST': 'לבקשת הלקוח', 'lifecycle.reason.PROVIDER_REQUEST': 'לבקשת העסק', 'lifecycle.reason.APPOINTMENT_FINISHED': 'התור הסתיים', 'lifecycle.reason.CUSTOMER_ABSENT': 'הלקוח לא הגיע', 'lifecycle.reason.SYSTEM_CHANGE': 'שינוי מערכת',
};
