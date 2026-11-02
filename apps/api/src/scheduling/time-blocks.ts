// A block covers one staff member, or every staff member when its staffId is null.
export const blocksCovering = (businessId: string, staffId: string, from: Date, until: Date) =>
  ({ businessId, OR: [{ staffId }, { staffId: null }], startsAt: { lt: until }, endsAt: { gt: from } });
