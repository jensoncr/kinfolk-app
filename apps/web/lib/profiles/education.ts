export function looksLikeEducationInstitution(value: string): boolean {
  return /\b(university|college|school|institute|academy)\b/i.test(value);
}
