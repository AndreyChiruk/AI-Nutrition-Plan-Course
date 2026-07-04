export function computeAgeFromBirthDate(birthDateStr: string): number | null {
  if (!birthDateStr) return null;
  const bd = new Date(birthDateStr);
  if (Number.isNaN(bd.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) {
    years -= 1;
  }
  return years;
}
