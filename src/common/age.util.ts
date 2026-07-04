export function computeFullYearsFromBirthDate(birthDate: Date | string | null | undefined): number | null {
  if (birthDate == null) return null;
  const bd = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(bd.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) {
    years -= 1;
  }
  return years;
}
